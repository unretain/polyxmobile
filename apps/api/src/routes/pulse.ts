import { Router } from "express";
import { z } from "zod";
// Primary data source: Database (swaps synced from Moralis)
// OHLCV is built from stored swaps - no API calls per request
// Fallback: PumpPortal real-time WebSocket for very new tokens
import { pumpFunService } from "../services/pumpfun";
import { dexScreenerService } from "../services/dexscreener";
import { birdeyeService } from "../services/birdeye";
import { pumpPortalService } from "../services/pumpportal";
import { meteoraService } from "../services/meteora";
import { moralisService } from "../services/moralis";
import { pulseSyncService } from "../services/pulseSync";
import { swapSyncService } from "../services/swapSync";
import { prisma } from "../lib/prisma";
import { PulseCategory } from "@prisma/client";
import { cache } from "../lib/cache";

export const pulseRoutes = Router();

const newPairsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  source: z.enum(["all", "pumpfun", "pumpportal", "meteora", "dexscreener", "trending"]).default("all"),
});

// GET /api/pulse/new-pairs - Get newest token pairs
// ARCHITECTURE:
// - Real-time updates come via WebSocket (PumpPortal -> Socket.io -> Frontend)
// - This endpoint serves INITIAL LOAD data from DB (enriched with Moralis logos/data)
// - DB syncs every 5 seconds from Moralis for enriched data
// - PumpPortal WebSocket provides instant new tokens (sub-second)
pulseRoutes.get("/new-pairs", async (req, res) => {
  try {
    const query = newPairsQuerySchema.parse(req.query);
    const { limit } = query;

    // First: Get real-time tokens from PumpPortal (instant, sub-second)
    const realtimeTokens = pumpPortalService.getRecentNewTokens() as any[];

    // Second: Get enriched tokens from DB (has logos, market cap from Moralis)
    const dbTokens = await prisma.pulseToken.findMany({
      where: { category: PulseCategory.NEW },
      orderBy: { tokenCreatedAt: "desc" },
      take: limit,
    });

    // Create a map of DB tokens for quick lookup
    const dbTokenMap = new Map(dbTokens.map((t) => [t.address, t]));

    // Merge: Use realtime data but enrich with DB data if available
    const mergedTokens: any[] = [];
    const seenAddresses = new Set<string>();

    // Add realtime tokens first (newest)
    for (const rt of realtimeTokens) {
      if (seenAddresses.has(rt.address)) continue;
      seenAddresses.add(rt.address);

      const dbToken = dbTokenMap.get(rt.address);
      mergedTokens.push({
        address: rt.address,
        symbol: rt.symbol,
        name: rt.name,
        logoUri: dbToken?.logoUri || rt.logoUri || rt.image_uri,
        description: rt.description,
        price: rt.price || dbToken?.price || 0,
        priceChange24h: rt.priceChange24h || dbToken?.priceChange24h || 0,
        volume24h: rt.volume24h || dbToken?.volume24h || 0,
        marketCap: rt.marketCap || dbToken?.marketCap || 0,
        liquidity: rt.liquidity || dbToken?.liquidity || 0,
        txCount: rt.txCount || rt.replyCount || 0,
        replyCount: rt.replyCount || 0,
        createdAt: rt.createdAt,
        twitter: rt.twitter,
        telegram: rt.telegram,
        website: rt.website,
        source: "pumpportal",
      });
    }

    // Add DB tokens not in realtime (older tokens with enriched data)
    for (const dbt of dbTokens) {
      if (seenAddresses.has(dbt.address)) continue;
      seenAddresses.add(dbt.address);

      mergedTokens.push({
        address: dbt.address,
        symbol: dbt.symbol,
        name: dbt.name,
        logoUri: dbt.logoUri,
        description: dbt.description,
        price: dbt.price,
        priceChange24h: dbt.priceChange24h,
        volume24h: dbt.volume24h,
        marketCap: dbt.marketCap,
        liquidity: dbt.liquidity,
        txCount: dbt.txCount,
        replyCount: dbt.replyCount,
        createdAt: dbt.tokenCreatedAt?.getTime() || dbt.createdAt.getTime(),
        twitter: dbt.twitter,
        telegram: dbt.telegram,
        website: dbt.website,
        source: "database",
      });
    }

    // Sort by creation time (newest first) and limit
    mergedTokens.sort((a, b) => b.createdAt - a.createdAt);
    const data = mergedTokens.slice(0, limit);

    const response = {
      data,
      total: data.length,
      timestamp: Date.now(),
      sources: ["pumpportal", "database"],
      realtime: pumpPortalService.isConnected(),
    };

    res.json(response);
  } catch (error) {
    console.error("Error fetching new pairs:", error);
    res.status(500).json({ error: "Failed to fetch new pairs" });
  }
});

// GET /api/pulse/graduating - Get coins about to graduate from pump.fun
// "Final Stretch" = Market cap $10K-$69K (approaching graduation threshold)
// Uses DB for enriched data + PumpPortal for real-time updates
// Shows NEWEST tokens first, filters out anything > 1 hour old
pulseRoutes.get("/graduating", async (req, res) => {
  try {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    // Get from DB (enriched with Moralis data)
    // Sort by creation time descending - newest first
    const dbTokens = await prisma.pulseToken.findMany({
      where: {
        category: PulseCategory.GRADUATING,
        tokenCreatedAt: { gte: new Date(oneHourAgo) },
      },
      orderBy: { tokenCreatedAt: "desc" }, // Newest first
    });

    // Get real-time from PumpPortal
    const realtimeTokens = pumpPortalService.getGraduatingTokens() as any[];
    const dbTokenMap = new Map(dbTokens.map((t) => [t.address, t]));

    // Merge tokens
    const mergedTokens: any[] = [];
    const seenAddresses = new Set<string>();

    // Add realtime tokens first (newest)
    for (const rt of realtimeTokens) {
      if (seenAddresses.has(rt.address)) continue;
      const mc = rt.marketCap || 0;
      if (mc < 10000 || mc >= 69000) continue; // Filter to $10K-$69K
      // Filter out tokens older than 1 hour
      if (rt.createdAt && rt.createdAt < oneHourAgo) continue;
      seenAddresses.add(rt.address);

      const dbToken = dbTokenMap.get(rt.address);
      mergedTokens.push({
        address: rt.address,
        symbol: rt.symbol,
        name: rt.name,
        logoUri: dbToken?.logoUri || rt.logoUri || rt.image_uri,
        price: rt.price || dbToken?.price || 0,
        priceChange24h: rt.priceChange24h || dbToken?.priceChange24h || 0,
        volume24h: rt.volume24h || dbToken?.volume24h || 0,
        marketCap: rt.marketCap || dbToken?.marketCap || 0,
        liquidity: rt.liquidity || dbToken?.liquidity || 0,
        bondingProgress: rt.bondingProgress || dbToken?.bondingProgress || 0,
        txCount: rt.txCount || 0,
        createdAt: rt.createdAt,
        source: "pumpportal",
      });
    }

    // Add DB tokens not in realtime (already filtered by query)
    for (const dbt of dbTokens) {
      if (seenAddresses.has(dbt.address)) continue;
      seenAddresses.add(dbt.address);

      mergedTokens.push({
        address: dbt.address,
        symbol: dbt.symbol,
        name: dbt.name,
        logoUri: dbt.logoUri,
        price: dbt.price,
        priceChange24h: dbt.priceChange24h,
        volume24h: dbt.volume24h,
        marketCap: dbt.marketCap,
        liquidity: dbt.liquidity,
        bondingProgress: dbt.bondingProgress || 0,
        txCount: dbt.txCount,
        createdAt: dbt.tokenCreatedAt?.getTime() || dbt.createdAt.getTime(),
        source: "database",
      });
    }

    // Sort by creation time descending - NEWEST first
    mergedTokens.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const response = {
      data: mergedTokens,
      total: mergedTokens.length,
      timestamp: Date.now(),
      sources: ["pumpportal", "database"],
      realtime: pumpPortalService.isConnected(),
    };

    res.json(response);
  } catch (error) {
    console.error("Error fetching graduating coins:", error);
    res.status(500).json({ error: "Failed to fetch graduating coins" });
  }
});

// GET /api/pulse/graduated - Get coins that graduated to Raydium/PumpSwap
// Uses DB for enriched data + PumpPortal for real-time migrations
// Shows NEWEST tokens first, filters out anything > 1 hour old
pulseRoutes.get("/graduated", async (req, res) => {
  try {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    console.log(`[Graduated] Fetching graduated tokens (max 1hr old)...`);

    // Get from DB (enriched with Moralis data) - only tokens from last 1 hour
    const dbTokens = await prisma.pulseToken.findMany({
      where: {
        category: PulseCategory.GRADUATED,
        OR: [
          { graduatedAt: { gte: new Date(oneHourAgo) } },
          { tokenCreatedAt: { gte: new Date(oneHourAgo) } },
        ],
      },
      orderBy: { graduatedAt: "desc" },
      take: 50,
    });
    console.log(`[Graduated] DB returned ${dbTokens.length} tokens`);

    // Log first DB token for debugging
    if (dbTokens.length > 0) {
      const sample = dbTokens[0];
      console.log(`[Graduated] Sample DB token: ${sample.symbol} MC=$${sample.marketCap}, Vol=$${sample.volume24h}`);
    }

    // Get real-time from PumpPortal (only returns tokens with actual data now)
    const realtimeTokens = pumpPortalService.getMigratedTokens() as any[];
    console.log(`[Graduated] PumpPortal returned ${realtimeTokens.length} tokens with data`);

    const dbTokenMap = new Map(dbTokens.map((t) => [t.address, t]));

    // Merge tokens
    const mergedTokens: any[] = [];
    const seenAddresses = new Set<string>();

    // Add realtime tokens first (newest migrations) - only if they have valid data
    for (const rt of realtimeTokens) {
      if (seenAddresses.has(rt.address)) continue;
      // Skip tokens with 0 market cap - they need enrichment
      if (!rt.marketCap || rt.marketCap === 0) continue;
      // Filter out tokens older than 1 hour
      if (rt.createdAt && rt.createdAt < oneHourAgo) continue;

      seenAddresses.add(rt.address);
      const dbToken = dbTokenMap.get(rt.address);
      mergedTokens.push({
        address: rt.address,
        symbol: rt.symbol,
        name: rt.name,
        logoUri: dbToken?.logoUri || rt.logoUri,
        price: rt.price || dbToken?.price || 0,
        priceChange24h: rt.priceChange24h || dbToken?.priceChange24h || 0,
        volume24h: rt.volume24h || dbToken?.volume24h || 0,
        marketCap: rt.marketCap || dbToken?.marketCap || 0,
        liquidity: rt.liquidity || dbToken?.liquidity || 0,
        txCount: rt.txCount || 0,
        createdAt: rt.createdAt,
        complete: true,
        pool: rt.pool,
        source: "pumpportal",
      });
    }

    // Add DB tokens not in realtime - prefer DB data which is enriched
    for (const dbt of dbTokens) {
      if (seenAddresses.has(dbt.address)) continue;
      seenAddresses.add(dbt.address);

      mergedTokens.push({
        address: dbt.address,
        symbol: dbt.symbol,
        name: dbt.name,
        logoUri: dbt.logoUri,
        price: dbt.price,
        priceChange24h: dbt.priceChange24h,
        volume24h: dbt.volume24h,
        marketCap: dbt.marketCap,
        liquidity: dbt.liquidity,
        txCount: dbt.txCount,
        createdAt: dbt.tokenCreatedAt?.getTime() || dbt.createdAt.getTime(),
        graduatedAt: dbt.graduatedAt?.getTime(),
        complete: true,
        source: "database",
      });
    }

    // Sort by graduated time (most recent first) then by market cap
    mergedTokens.sort((a, b) => {
      const aTime = a.graduatedAt || a.createdAt || 0;
      const bTime = b.graduatedAt || b.createdAt || 0;
      return bTime - aTime;
    });

    const response = {
      data: mergedTokens,
      total: mergedTokens.length,
      timestamp: Date.now(),
      sources: ["pumpportal", "database"],
      realtime: pumpPortalService.isConnected(),
    };

    res.json(response);
  } catch (error) {
    console.error("Error fetching graduated coins:", error);
    res.status(500).json({ error: "Failed to fetch graduated coins" });
  }
});

// POST /api/pulse/sync - Manually trigger sync (for testing/admin)
pulseRoutes.post("/sync", async (req, res) => {
  try {
    const result = await pulseSyncService.sync();
    res.json({
      success: true,
      ...result,
      status: pulseSyncService.getStatus(),
    });
  } catch (error) {
    console.error("Error syncing pulse tokens:", error);
    res.status(500).json({ error: "Failed to sync pulse tokens" });
  }
});

// GET /api/pulse/sync/status - Get sync status
pulseRoutes.get("/sync/status", async (req, res) => {
  res.json(pulseSyncService.getStatus());
});

// GET /api/pulse/king - Get king of the hill coins
pulseRoutes.get("/king", async (req, res) => {
  try {
    const cacheKey = "pulse:king";
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const tokens = await pumpFunService.getKingOfHillCoins(50);

    const response = {
      data: tokens,
      total: tokens.length,
      timestamp: Date.now(),
      source: "pumpfun",
    };

    await cache.set(cacheKey, JSON.stringify(response), 10);
    res.json(response);
  } catch (error) {
    console.error("Error fetching king of hill coins:", error);
    res.status(500).json({ error: "Failed to fetch king of hill coins" });
  }
});

// GET /api/pulse/realtime/:address - Get real-time OHLCV data
pulseRoutes.get("/realtime/:address", async (req, res) => {
  try {
    const { address } = req.params;

    const to = Math.floor(Date.now() / 1000);
    const from = to - 600; // Last 10 minutes

    const ohlcv = await birdeyeService.getOHLCV(address, "1m", {
      from,
      to,
      limit: 100,
    });

    res.json({
      address,
      timeframe: "1m",
      data: ohlcv,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Error fetching realtime data:", error);
    res.status(500).json({ error: "Failed to fetch realtime data" });
  }
});

// GET /api/pulse/token/:address - Get enriched token data from multiple sources
// PRIORITY: 1. Database (free), 2. In-memory caches (free), 3. External APIs (costly)
pulseRoutes.get("/token/:address", async (req, res) => {
  try {
    const { address } = req.params;
    let tokenData: any = null;

    // 1. FIRST: Check database (free, no API call)
    const dbToken = await prisma.pulseToken.findUnique({
      where: { address },
    });
    if (dbToken) {
      tokenData = {
        address: dbToken.address,
        symbol: dbToken.symbol,
        name: dbToken.name,
        logoUri: dbToken.logoUri,
        description: dbToken.description,
        price: dbToken.price,
        priceChange24h: dbToken.priceChange24h,
        volume24h: dbToken.volume24h,
        liquidity: dbToken.liquidity,
        marketCap: dbToken.marketCap,
        txCount: dbToken.txCount,
        twitter: dbToken.twitter,
        telegram: dbToken.telegram,
        website: dbToken.website,
        createdAt: dbToken.tokenCreatedAt?.getTime() || dbToken.createdAt.getTime(),
        source: "database",
      };
      console.log(`📦 Got token data from database for ${address}`);
    }

    // 2. Check PumpPortal in-memory cache (free, no API call)
    if (!tokenData) {
      const realtimeTokens = pumpPortalService.getRecentNewTokens();
      tokenData = realtimeTokens.find((t: any) => t.address === address);
    }

    if (!tokenData) {
      const graduatingTokens = pumpPortalService.getGraduatingTokens();
      tokenData = graduatingTokens.find((t: any) => t.address === address);
    }

    if (!tokenData) {
      const migratedTokens = pumpPortalService.getMigratedTokens();
      tokenData = migratedTokens.find((t: any) => t.address === address);
    }

    // 3. External APIs (costly - only for tokens not in DB or cache)
    if (!tokenData) {
      // Try pump.fun API (for memecoins)
      tokenData = await pumpFunService.getCoin(address);
    }

    if (!tokenData) {
      // Try Moralis API as primary source (reliable for pump.fun tokens with market cap)
      try {
        const moralisData = await moralisService.getTokenData(address);
        if (moralisData) {
          tokenData = {
            address: moralisData.address,
            symbol: moralisData.symbol,
            name: moralisData.name,
            logoUri: moralisData.logoURI,
            price: moralisData.price,
            priceChange24h: moralisData.priceChange24h,
            volume24h: moralisData.volume24h,
            liquidity: moralisData.liquidity,
            marketCap: moralisData.marketCap,
            txCount: 0,
            createdAt: Date.now(),
            source: "moralis",
          };
          console.log(`📦 Got token data from Moralis for ${address}`);
        }
      } catch (err) {
        console.error("Moralis token fetch error:", err);
      }
    }

    if (!tokenData) {
      // Try DexScreener as fallback
      const pairs = await dexScreenerService.getTokenPairs(address);
      if (pairs.length > 0) {
        const pair = pairs[0];
        tokenData = {
          address: pair.baseToken.address,
          symbol: pair.baseToken.symbol,
          name: pair.baseToken.name,
          logoUri: pair.info?.imageUrl,
          price: parseFloat(pair.priceUsd) || 0,
          priceChange24h: pair.priceChange?.h24 || 0,
          volume24h: pair.volume?.h24 || 0,
          liquidity: pair.liquidity?.usd || 0,
          marketCap: pair.marketCap || pair.fdv || 0,
          txCount: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
          createdAt: pair.pairCreatedAt || Date.now(),
          source: "dexscreener",
        };
      }
    }

    if (!tokenData) {
      // Try Birdeye as final fallback
      try {
        const birdeyeData = await birdeyeService.getTokenData(address);
        if (birdeyeData) {
          tokenData = {
            address: birdeyeData.address,
            symbol: birdeyeData.symbol,
            name: birdeyeData.name,
            logoUri: birdeyeData.logoURI,
            price: birdeyeData.price,
            priceChange24h: birdeyeData.priceChange24h,
            volume24h: birdeyeData.volume24h,
            liquidity: birdeyeData.liquidity,
            marketCap: birdeyeData.marketCap,
            txCount: 0,
            createdAt: Date.now(),
            source: "birdeye",
          };
        }
      } catch (err) {
        console.error("Birdeye token fetch error:", err);
      }
    }

    if (!tokenData) {
      return res.status(404).json({ error: "Token not found" });
    }

    // Enrich with Moralis logo if not present
    if (!tokenData.logoUri) {
      const moralisLogo = moralisService.getCachedLogo(address);
      if (moralisLogo) {
        tokenData.logoUri = moralisLogo;
      } else {
        // Trigger async fetch for next time
        moralisService.prefetchLogo(address);
      }
    }

    // Enrich with pump.fun social links if not present
    if (!tokenData.twitter && !tokenData.website && !tokenData.telegram) {
      try {
        const pumpFunData = await pumpFunService.getCoin(address);
        if (pumpFunData) {
          tokenData.twitter = pumpFunData.twitter || tokenData.twitter;
          tokenData.website = pumpFunData.website || tokenData.website;
          tokenData.telegram = pumpFunData.telegram || tokenData.telegram;
          tokenData.description = pumpFunData.description || tokenData.description;
          // Also use pump.fun logo if we don't have one
          if (!tokenData.logoUri && pumpFunData.logoUri) {
            tokenData.logoUri = pumpFunData.logoUri;
          }
        }
      } catch (err) {
        // Silently fail - social links are optional
        console.log(`Could not enrich with pump.fun social links for ${address}`);
      }
    }

    // Enrich with volume from DexScreener if volume24h is 0 or missing
    if (!tokenData.volume24h || tokenData.volume24h === 0) {
      try {
        const pairs = await dexScreenerService.getTokenPairs(address);
        if (pairs.length > 0) {
          const pair = pairs[0];
          const dexVolume = pair.volume?.h24 || 0;
          if (dexVolume > 0) {
            tokenData.volume24h = dexVolume;
            console.log(`📈 Enriched volume24h from DexScreener: $${dexVolume.toLocaleString()}`);
          }
        }
      } catch (err) {
        console.log(`Could not enrich volume from DexScreener for ${address}`);
      }
    }

    res.json(tokenData);
  } catch (error) {
    console.error("Error fetching token data:", error);
    res.status(500).json({ error: "Failed to fetch token data" });
  }
});

// GET /api/pulse/ohlcv/:address - Get OHLCV candlestick data
// PRIMARY SOURCE: Database (swaps synced from Moralis, then built into candles)
// FALLBACK: PumpPortal real-time trade tracking for very new tokens
// NO PER-REQUEST API CALLS - all data comes from DB
pulseRoutes.get("/ohlcv/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const timeframe = (req.query.timeframe as string) || "1min";

    // Check cache first (5 seconds TTL - DB reads are fast)
    const cacheKey = `pulse:ohlcv:${address}:${timeframe}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      const cachedData = JSON.parse(cached);
      console.log(`📊 [Cache HIT] ${timeframe} for ${address}: ${cachedData.data?.length || 0} candles`);
      return res.json(cachedData);
    }

    let source = "database";
    let ohlcv: any[] = [];

    // Always subscribe to PumpPortal trades for real-time updates
    pumpPortalService.subscribeTokenTrades([address]);

    // Map timeframe to interval in milliseconds
    // 1s = 1000ms (1 second candles, same logic as 1min just smaller interval)
    const intervalMap: Record<string, number> = {
      "1s": 1000,
      "1min": 60000,
      "5min": 300000,
      "15min": 900000,
      "30min": 1800000,
      "1h": 3600000,
      "4h": 14400000,
      "1d": 86400000,
    };
    const intervalMs = intervalMap[timeframe] || 60000;

    console.log(`📊 [OHLCV] Getting ${timeframe} candles from DB for ${address}`);
    const startTime = Date.now();

    // Get OHLCV from database (syncs from Moralis if not yet synced)
    ohlcv = await swapSyncService.getOHLCV(address, intervalMs);
    const elapsed = Date.now() - startTime;
    console.log(`📊 [OHLCV] Got ${ohlcv.length} candles from DB in ${elapsed}ms`);

    if (ohlcv.length > 0) {
      const firstTs = new Date(ohlcv[0].timestamp).toISOString();
      const lastTs = new Date(ohlcv[ohlcv.length - 1].timestamp).toISOString();
      console.log(`📊 [OHLCV] Candle range: ${firstTs} to ${lastTs}`);
    }

    // If DB has very few candles, also check PumpPortal for real-time data
    // (very new tokens may not have swaps synced yet)
    if (ohlcv.length < 10) {
      const pumpPortalOhlcv = pumpPortalService.getTokenOHLCV(address);
      console.log(`📊 [OHLCV] PumpPortal fallback: ${pumpPortalOhlcv.length} candles`);
      if (pumpPortalOhlcv.length > ohlcv.length) {
        ohlcv = pumpPortalOhlcv;
        source = "pumpportal-realtime";
      }
    }

    // Last resort: Generate flat candles from current price
    if (ohlcv.length === 0) {
      try {
        // Check DB for token price first
        const dbToken = await prisma.pulseToken.findUnique({
          where: { address },
          select: { price: true },
        });

        const price = dbToken?.price || 0;
        if (price > 0) {
          const nowMs = Date.now();
          const startTime = Math.floor(nowMs / 60000) * 60000;
          ohlcv = [];
          for (let i = 59; i >= 0; i--) {
            ohlcv.push({
              timestamp: startTime - (i * 60000),
              open: price,
              high: price,
              low: price,
              close: price,
              volume: 0,
            });
          }
          source = "database-price";
          console.log(`📊 Generated flat OHLCV from DB price: $${price}`);
        }
      } catch (priceError) {
        console.warn(`Failed to get price for ${address}`);
      }
    }

    const response = {
      address,
      timeframe,
      data: ohlcv,
      timestamp: Date.now(),
      source,
      realtime: pumpPortalService.isConnected(),
    };

    console.log(`📊 [OHLCV] FINAL RESPONSE for ${address} ${timeframe}: ${ohlcv.length} candles from ${source}`);

    // Cache for 5 seconds (DB reads are fast, keep data fresh)
    await cache.set(cacheKey, JSON.stringify(response), 5);

    res.json(response);
  } catch (error) {
    console.error("Error fetching pulse OHLCV:", error);
    res.status(500).json({ error: "Failed to fetch OHLCV data" });
  }
});

// GET /api/pulse/image/:address - Get token logo URL from Moralis
// Returns CDN-hosted image URL for reliable image loading
pulseRoutes.get("/image/:address", async (req, res) => {
  try {
    const { address } = req.params;

    // Check cache first
    let logoUrl: string | null | undefined = moralisService.getCachedLogo(address);

    if (!logoUrl) {
      // Fetch from Moralis
      logoUrl = await moralisService.getTokenLogo(address);
    }

    if (logoUrl) {
      // Return the logo URL - frontend can use this directly
      res.json({ address, logoUrl });
    } else {
      // No logo found
      res.status(404).json({ error: "Logo not found" });
    }
  } catch (error) {
    console.error("Error fetching token logo:", error);
    res.status(500).json({ error: "Failed to fetch token logo" });
  }
});

// GET /api/pulse/metadata/:address - Get full token metadata from Moralis
pulseRoutes.get("/metadata/:address", async (req, res) => {
  try {
    const { address } = req.params;

    const metadata = await moralisService.getTokenMetadata(address);

    if (metadata) {
      res.json(metadata);
    } else {
      res.status(404).json({ error: "Metadata not found" });
    }
  } catch (error) {
    console.error("Error fetching token metadata:", error);
    res.status(500).json({ error: "Failed to fetch token metadata" });
  }
});

// GET /api/pulse/trades/:address - Get recent trades/swaps for a token
// SOURCE: Database (synced from Moralis) - no API calls per request
pulseRoutes.get("/trades/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    // Check cache first (5 second TTL - DB reads are fast)
    const cacheKey = `pulse:trades:${address}:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Ensure swaps are synced for this token
    const syncStatus = await swapSyncService.getSyncStatus(address);
    if (!syncStatus?.swapsSynced) {
      // Sync in background, return empty for now
      swapSyncService.syncHistoricalSwaps(address).catch(() => {});
    }

    // Get trades from database
    const dbTrades = await prisma.tokenSwap.findMany({
      where: { tokenAddress: address },
      orderBy: { timestamp: "desc" },
      take: limit,
    });

    // Get token info for symbol
    const tokenInfo = await prisma.pulseToken.findUnique({
      where: { address },
      select: { symbol: true },
    });

    const trades = dbTrades.map((swap) => ({
      txHash: swap.txHash,
      timestamp: swap.timestamp.getTime(),
      type: swap.type,
      wallet: swap.walletAddress,
      tokenAmount: swap.tokenAmount.toString(),
      tokenAmountUsd: swap.totalValueUsd,
      tokenSymbol: tokenInfo?.symbol || "???",
      otherAmount: swap.solAmount.toString(),
      otherSymbol: "SOL",
      otherAmountUsd: swap.solAmount * (swap.priceUsd > 0 ? swap.totalValueUsd / (swap.tokenAmount * swap.priceUsd) : 200),
      priceUsd: swap.priceUsd,
      totalValueUsd: swap.totalValueUsd,
    }));

    const response = {
      address,
      trades,
      total: trades.length,
      timestamp: Date.now(),
      source: "database",
    };

    await cache.set(cacheKey, JSON.stringify(response), 5);
    res.json(response);
  } catch (error) {
    console.error("Error fetching trades:", error);
    res.status(500).json({ error: "Failed to fetch trades" });
  }
});

// GET /api/pulse/holders/:address - Get holder stats and top holders
// SOURCE: Moralis holders API
pulseRoutes.get("/holders/:address", async (req, res) => {
  try {
    const { address } = req.params;

    // Check cache first (60 second TTL - holder data changes slower)
    const cacheKey = `pulse:holders:${address}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Fetch holder stats and top holders in parallel
    const [stats, topHolders] = await Promise.all([
      moralisService.getHolderStats(address),
      moralisService.getTopHolders(address, 20),
    ]);

    const response = {
      address,
      stats: stats || {
        totalHolders: 0,
        holderChange: {},
      },
      topHolders: topHolders.map((h) => ({
        address: h.ownerAddress,
        balance: h.balanceFormatted,
        percentOfSupply: h.percentageRelativeToTotalSupply,
        usdValue: h.usdValue ? parseFloat(h.usdValue) : undefined,
      })),
      timestamp: Date.now(),
      source: "moralis",
    };

    await cache.set(cacheKey, JSON.stringify(response), 60);
    res.json(response);
  } catch (error) {
    console.error("Error fetching holders:", error);
    res.status(500).json({ error: "Failed to fetch holders" });
  }
});

// GET /api/pulse/stats/:address - Get token trading stats/analytics
// SOURCE: Database (PulseToken table) - no API calls per request
pulseRoutes.get("/stats/:address", async (req, res) => {
  try {
    const { address } = req.params;

    // Check cache first (5 second TTL - DB reads are fast)
    const cacheKey = `pulse:stats:${address}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Get from database first
    const dbToken = await prisma.pulseToken.findUnique({
      where: { address },
    });

    if (dbToken) {
      // Calculate 24h volume from trades in DB
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const volume24hResult = await prisma.tokenSwap.aggregate({
        where: {
          tokenAddress: address,
          timestamp: { gte: oneDayAgo },
        },
        _sum: { totalValueUsd: true },
      });

      const response = {
        address,
        price: dbToken.price,
        priceChange24h: dbToken.priceChange24h,
        marketCap: dbToken.marketCap,
        liquidity: dbToken.liquidity,
        volume24h: volume24hResult._sum.totalValueUsd || dbToken.volume24h || 0,
        stats: {
          txCount: dbToken.txCount,
        },
        timestamp: Date.now(),
        source: "database",
      };

      await cache.set(cacheKey, JSON.stringify(response), 5);
      return res.json(response);
    }

    // Token not in DB - return empty stats
    // The pulseSync should add it eventually
    const response = {
      address,
      price: 0,
      priceChange24h: 0,
      marketCap: 0,
      liquidity: 0,
      volume24h: 0,
      stats: {},
      timestamp: Date.now(),
      source: "not-found",
    };

    res.json(response);
  } catch (error) {
    console.error("Error fetching token stats:", error);
    res.status(500).json({ error: "Failed to fetch token stats" });
  }
});
