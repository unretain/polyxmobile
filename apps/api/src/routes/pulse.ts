import { Router } from "express";
import { z } from "zod";
// Primary data source: Moralis (pump.fun endpoints + OHLCV)
// Fallback: PumpPortal real-time WebSocket for very new tokens
import { pumpFunService } from "../services/pumpfun";
import { dexScreenerService } from "../services/dexscreener";
import { birdeyeService } from "../services/birdeye";
import { pumpPortalService } from "../services/pumpportal";
import { meteoraService } from "../services/meteora";
import { moralisService } from "../services/moralis";
import { pulseSyncService } from "../services/pulseSync";
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
// "Final Stretch" = Market cap $15K-$69K (approaching graduation threshold)
// Uses DB for enriched data + PumpPortal for real-time updates
pulseRoutes.get("/graduating", async (req, res) => {
  try {
    // Get from DB (enriched with Moralis data)
    const dbTokens = await prisma.pulseToken.findMany({
      where: { category: PulseCategory.GRADUATING },
      orderBy: { bondingProgress: "asc" }, // Lowest progress first
    });

    // Get real-time from PumpPortal
    const realtimeTokens = pumpPortalService.getGraduatingTokens() as any[];
    const dbTokenMap = new Map(dbTokens.map((t) => [t.address, t]));

    // Merge tokens
    const mergedTokens: any[] = [];
    const seenAddresses = new Set<string>();

    // Add realtime tokens first
    for (const rt of realtimeTokens) {
      if (seenAddresses.has(rt.address)) continue;
      const mc = rt.marketCap || 0;
      if (mc < 10000 || mc >= 69000) continue; // Filter to $10K-$69K
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

    // Add DB tokens not in realtime
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

    // Sort by bonding progress ascending
    mergedTokens.sort((a, b) => (a.bondingProgress || 0) - (b.bondingProgress || 0));

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
pulseRoutes.get("/graduated", async (req, res) => {
  try {
    // Get from DB (enriched with Moralis data)
    const dbTokens = await prisma.pulseToken.findMany({
      where: { category: PulseCategory.GRADUATED },
      orderBy: { graduatedAt: "desc" },
      take: 50,
    });

    // Get real-time from PumpPortal
    const realtimeTokens = pumpPortalService.getMigratedTokens() as any[];
    const dbTokenMap = new Map(dbTokens.map((t) => [t.address, t]));

    // Merge tokens
    const mergedTokens: any[] = [];
    const seenAddresses = new Set<string>();

    // Add realtime tokens first (newest migrations)
    for (const rt of realtimeTokens) {
      if (seenAddresses.has(rt.address)) continue;
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

    // Add DB tokens not in realtime
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
pulseRoutes.get("/token/:address", async (req, res) => {
  try {
    const { address } = req.params;

    // First check PumpPortal cache for real-time token data
    const realtimeTokens = pumpPortalService.getRecentNewTokens();
    let tokenData: any = realtimeTokens.find((t: any) => t.address === address);

    if (!tokenData) {
      // Check graduating tokens
      const graduatingTokens = pumpPortalService.getGraduatingTokens();
      tokenData = graduatingTokens.find((t: any) => t.address === address);
    }

    if (!tokenData) {
      // Check migrated tokens
      const migratedTokens = pumpPortalService.getMigratedTokens();
      tokenData = migratedTokens.find((t: any) => t.address === address);
    }

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
// PRIMARY SOURCE: Moralis pairs OHLCV API (1min candles by default)
// FALLBACK: PumpPortal real-time trade tracking, then Moralis swap history
pulseRoutes.get("/ohlcv/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const timeframe = (req.query.timeframe as string) || "1min";
    const fromDate = req.query.fromDate ? parseInt(req.query.fromDate as string, 10) : undefined;
    const toDate = req.query.toDate ? parseInt(req.query.toDate as string, 10) : undefined;

    // Check cache first (30 seconds TTL to prevent rate limiting)
    // Include date range in cache key for different timeframe requests
    const cacheKey = `pulse:ohlcv:${address}:${timeframe}:${fromDate || ""}:${toDate || ""}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      const cachedData = JSON.parse(cached);
      console.log(`📊 [Cache HIT] ${timeframe} for ${address}: ${cachedData.data?.length || 0} candles`);
      return res.json(cachedData);
    }
    console.log(`📊 [Cache MISS] ${timeframe} for ${address}`);

    let source = "moralis";
    let ohlcv: any[] = [];

    // Always subscribe to PumpPortal trades for real-time updates
    pumpPortalService.subscribeTokenTrades([address]);

    // For 1s timeframe: Use per-trade candles (one candle per swap) like pump.fun
    // This shows every individual trade as its own candle for maximum detail
    if (timeframe === "1s") {
      console.log(`📊 [1s] Fetching per-trade candles for ${address}`);
      try {
        // Build per-trade candles from swap history (up to 2000 trades)
        // perTrade=true creates one candle per swap, just like pump.fun's native chart
        ohlcv = await moralisService.getOHLCVFromSwaps(address, 0, 2000, true);
        console.log(`📊 [1s] Got ${ohlcv.length} per-trade candles from swaps`);
        if (ohlcv.length > 0) {
          source = "moralis-swaps-pertrade";
          console.log(`📊 Built ${ohlcv.length} per-trade candles from Moralis swaps for ${address}`);
        }
      } catch (swapError: any) {
        console.warn(`📊 [1s] Moralis swap OHLCV failed for ${address}:`, swapError.message);
      }

      // If swaps didn't return enough, also check PumpPortal for real-time data
      if (ohlcv.length < 10) {
        const pumpPortalOhlcv = pumpPortalService.getTokenOHLCV(address);
        if (pumpPortalOhlcv.length > ohlcv.length) {
          ohlcv = pumpPortalOhlcv;
          source = "pumpportal-realtime";
          console.log(`📊 Got ${ohlcv.length} real-time 1s candles from PumpPortal for ${address}`);
        }
      }
    }

    // For non-1s timeframes: Use Moralis OHLCV API (proper candlestick data from pairs)
    if (timeframe !== "1s" && ohlcv.length < 5) {
      try {
        const moralisOhlcv = await moralisService.getOHLCV(address, timeframe as any, {
          fromDate,
          toDate,
        });
        if (moralisOhlcv.length > ohlcv.length) {
          ohlcv = moralisOhlcv;
          source = "moralis";
          console.log(`📊 Got ${ohlcv.length} ${timeframe} candles from Moralis OHLCV for ${address}`);
        }
      } catch (moralisError: any) {
        // Expected for very new tokens without trading pairs yet
        if (!moralisError.message?.includes("No trading pairs")) {
          console.warn(`Moralis OHLCV failed for ${address}:`, moralisError.message);
        }
      }
    }

    // FALLBACK: Try building OHLCV from swaps for non-1s timeframes if we have nothing
    if (ohlcv.length === 0) {
      try {
        ohlcv = await moralisService.getOHLCVFromSwaps(address, 60000, 300); // 1-minute candles
        if (ohlcv.length > 0) {
          source = "moralis-swaps";
          console.log(`📊 Built ${ohlcv.length} candles from Moralis swaps for ${address}`);
        }
      } catch (swapError) {
        console.warn(`Moralis swap OHLCV failed for ${address}`);
      }
    }

    // FALLBACK 3: Generate flat candles from current price (shows at least something)
    if (ohlcv.length === 0) {
      try {
        const priceData = await moralisService.getTokenPrice(address);
        if (priceData && priceData.usdPrice > 0) {
          const now = Date.now();
          const startTime = Math.floor(now / 60000) * 60000; // Round to minute

          // Create 60 minutes of flat candles
          ohlcv = [];
          for (let i = 59; i >= 0; i--) {
            ohlcv.push({
              timestamp: startTime - (i * 60000),
              open: priceData.usdPrice,
              high: priceData.usdPrice,
              low: priceData.usdPrice,
              close: priceData.usdPrice,
              volume: 0,
            });
          }
          source = "moralis-price";
          console.log(`📊 Generated flat OHLCV for ${address} from price: $${priceData.usdPrice}`);
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

    // Cache based on source - shorter for real-time PumpPortal data
    // PumpPortal real-time: 2 seconds (allow frequent polling for live updates)
    // Moralis: 30 seconds to prevent rate limiting
    // No data: 5 seconds (retry faster)
    const isRealtimeSource = source.includes("pumpportal");
    const cacheTTL = isRealtimeSource ? 2 : (ohlcv.length > 0 ? 30 : 5);
    await cache.set(cacheKey, JSON.stringify(response), cacheTTL);

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
// SOURCE: Moralis swaps API
pulseRoutes.get("/trades/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    // Check cache first (10 second TTL)
    const cacheKey = `pulse:trades:${address}:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const { swaps, cursor } = await moralisService.getTokenSwaps(address, {
      order: "DESC",
      limit,
    });

    // Format swaps for frontend display
    // Moralis swap structure: bought = what wallet received, sold = what wallet paid
    // transactionType: "buy" = wallet bought the token, "sell" = wallet sold the token
    const trades = swaps.map((swap) => {
      // Use transactionType directly from Moralis
      const isBuy = swap.transactionType === "buy";

      // For a buy: bought = the token, sold = SOL/quote
      // For a sell: sold = the token, bought = SOL/quote
      const tokenSide = isBuy ? swap.bought : swap.sold;
      const quoteSide = isBuy ? swap.sold : swap.bought;

      return {
        txHash: swap.transactionHash,
        timestamp: new Date(swap.blockTimestamp).getTime(),
        type: isBuy ? "buy" : "sell",
        wallet: swap.walletAddress,
        tokenAmount: tokenSide?.amount,
        tokenAmountUsd: tokenSide?.usdAmount,
        tokenSymbol: tokenSide?.symbol,
        otherAmount: quoteSide?.amount,
        otherSymbol: quoteSide?.symbol,
        otherAmountUsd: quoteSide?.usdAmount,
        priceUsd: tokenSide?.usdPrice,
        totalValueUsd: swap.totalValueUsd,
        pairLabel: swap.pairLabel,
        exchangeName: swap.exchangeName,
      };
    });

    const response = {
      address,
      trades,
      total: trades.length,
      cursor,
      timestamp: Date.now(),
      source: "moralis",
    };

    await cache.set(cacheKey, JSON.stringify(response), 10);
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
// SOURCE: Moralis pair stats API
pulseRoutes.get("/stats/:address", async (req, res) => {
  try {
    const { address } = req.params;

    // Check cache first (30 second TTL)
    const cacheKey = `pulse:stats:${address}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Fetch token data, stats, and pairs in parallel
    const [tokenData, tokenStats, pairs] = await Promise.all([
      moralisService.getTokenData(address),
      moralisService.getTokenStats(address),
      moralisService.getTokenPairs(address),
    ]);

    const mainPair = pairs?.find((p) => !p.inactivePair) || pairs?.[0];

    let volume24h = mainPair?.volume24hrUsd || tokenData?.volume24h || 0;

    // If volume is still 0, try DexScreener
    if (volume24h === 0) {
      try {
        const dexPairs = await dexScreenerService.getTokenPairs(address);
        if (dexPairs.length > 0) {
          const dexVolume = dexPairs[0].volume?.h24 || 0;
          if (dexVolume > 0) {
            volume24h = dexVolume;
            console.log(`📈 Stats enriched volume24h from DexScreener: $${dexVolume.toLocaleString()}`);
          }
        }
      } catch (err) {
        console.log(`Could not enrich stats volume from DexScreener for ${address}`);
      }
    }

    const response = {
      address,
      price: tokenData?.price || 0,
      priceChange24h: tokenData?.priceChange24h || 0,
      marketCap: tokenData?.marketCap || 0,
      liquidity: mainPair?.liquidityUsd || tokenData?.liquidity || 0,
      volume24h,
      stats: tokenStats || {},
      exchange: mainPair?.exchangeName || "Unknown",
      pairAddress: mainPair?.pairAddress,
      timestamp: Date.now(),
      source: "moralis",
    };

    await cache.set(cacheKey, JSON.stringify(response), 30);
    res.json(response);
  } catch (error) {
    console.error("Error fetching token stats:", error);
    res.status(500).json({ error: "Failed to fetch token stats" });
  }
});
