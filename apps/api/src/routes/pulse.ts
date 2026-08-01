import { Router } from "express";
import { z } from "zod";
// Primary data source: Database (swaps synced from Moralis)
// OHLCV is built from stored swaps - no API calls per request
import { pumpFunService } from "../services/pumpfun";
import { dexScreenerService } from "../services/dexscreener";
import { birdeyeService } from "../services/birdeye";
import { meteoraService } from "../services/meteora";
import { moralisService } from "../services/moralis";
import { pulseSyncService } from "../services/pulseSync";
import { swapSyncService } from "../services/swapSync";
import { prisma } from "../lib/prisma";
import { PulseCategory } from "@prisma/client";
import { cache } from "../lib/cache";
// Live in-memory gRPC feed — the single source of truth (same as /api/feed/*).
// The legacy DB-backed pulse routes below now serve from this so any frontend
// hitting /api/pulse/* (e.g. polyx.trade) gets live data instead of 500s.
import { getNewPairs, getGraduating, getGraduated, getCandles, getToken, getSolPrice } from "../pulse/feed";
// ClickHouse: durable store of every token/trade the ingestor has seen. Used as
// the preferred source (no 200-cap eviction, survives restarts) with the live
// in-memory feed as fallback, so coins stop randomly dropping.
import * as ch from "../clickhouse/queries";
import { clickhouseEnabled } from "../clickhouse/client";

export const pulseRoutes = Router();

const newPairsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  source: z.enum(["all", "pumpfun", "meteora", "dexscreener", "trending"]).default("all"),
});

// GET /api/pulse/new-pairs - Get newest token pairs
// Data source: Database (enriched with Moralis logos/data)
pulseRoutes.get("/new-pairs", async (req, res) => {
  try {
    const query = newPairsQuerySchema.parse(req.query);
    const { limit } = query;

    if (clickhouseEnabled()) {
      try {
        const chData = await ch.getNewPairs(limit, getSolPrice());
        if (chData.length) return res.json({ data: chData, total: chData.length, timestamp: Date.now(), sources: ["clickhouse"] });
      } catch (e) { console.error("[pulse] CH new-pairs:", (e as Error).message); }
    }
    const data = getNewPairs(limit);
    res.json({ data, total: data.length, timestamp: Date.now(), sources: ["grpc"] });
  } catch (error) {
    console.error("Error fetching new pairs:", error);
    res.status(500).json({ error: "Failed to fetch new pairs" });
  }
});

// GET /api/pulse/graduating - Get coins about to graduate from pump.fun
// "Final Stretch" = Market cap $10K-$69K (approaching graduation threshold)
// Uses DB for enriched data - shows NEWEST tokens first, filters out anything > 1 hour old
pulseRoutes.get("/graduating", async (req, res) => {
  try {
    if (clickhouseEnabled()) {
      try {
        const chData = await ch.getGraduatingPairs(100, getSolPrice());
        if (chData.length) return res.json({ data: chData, total: chData.length, timestamp: Date.now(), sources: ["clickhouse"] });
      } catch (e) { console.error("[pulse] CH graduating:", (e as Error).message); }
    }
    const data = getGraduating(100);
    res.json({ data, total: data.length, timestamp: Date.now(), sources: ["grpc"] });
  } catch (error) {
    console.error("Error fetching graduating coins:", error);
    res.status(500).json({ error: "Failed to fetch graduating coins" });
  }
});

// GET /api/pulse/graduated - Get coins that graduated to Raydium/PumpSwap
// Uses DB for enriched data - shows NEWEST tokens first, filters out anything > 1 hour old
pulseRoutes.get("/graduated", async (req, res) => {
  try {
    if (clickhouseEnabled()) {
      try {
        const chData = await ch.getGraduatedPairs(50, getSolPrice());
        if (chData.length) return res.json({ data: chData, total: chData.length, timestamp: Date.now(), sources: ["clickhouse"] });
      } catch (e) { console.error("[pulse] CH graduated:", (e as Error).message); }
    }
    const data = getGraduated(50);
    res.json({ data, total: data.length, timestamp: Date.now(), sources: ["grpc"] });
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

// POST /api/pulse/sync/reset - Clear all swap data and immediately re-sync ALL Pulse tokens
// This forces a fresh re-sync of all token swaps from Moralis with ENTIRE history
pulseRoutes.post("/sync/reset", async (req, res) => {
  try {
    console.log("[Reset] === FULL RESET AND RESYNC STARTING ===");
    const startTime = Date.now();

    // Step 1: Delete all token swaps
    const deletedSwaps = await prisma.tokenSwap.deleteMany({});
    console.log(`[Reset] Step 1: Deleted ${deletedSwaps.count} swaps`);

    // Step 2: Delete all sync statuses
    const deletedStatuses = await prisma.tokenSyncStatus.deleteMany({});
    console.log(`[Reset] Step 2: Deleted ${deletedStatuses.count} sync statuses`);

    // Step 3: Get ALL current Pulse tokens (new, graduating, graduated)
    const allPulseTokens = await prisma.pulseToken.findMany({
      select: { address: true, symbol: true },
      orderBy: { marketCap: "desc" },
    });
    console.log(`[Reset] Step 3: Found ${allPulseTokens.length} Pulse tokens to sync`);

    // Step 4: Sync ENTIRE swap history for each token from Moralis
    // Do this in parallel batches to speed it up
    let totalSynced = 0;
    let totalSwaps = 0;
    const batchSize = 5; // Sync 5 tokens at a time to avoid rate limits

    for (let i = 0; i < allPulseTokens.length; i += batchSize) {
      const batch = allPulseTokens.slice(i, i + batchSize);
      console.log(`[Reset] Syncing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allPulseTokens.length / batchSize)} (${batch.map(t => t.symbol).join(", ")})`);

      const results = await Promise.allSettled(
        batch.map(async (token) => {
          try {
            const result = await swapSyncService.syncHistoricalSwaps(token.address);
            return { symbol: token.symbol, ...result };
          } catch (err) {
            console.error(`[Reset] Failed to sync ${token.symbol}:`, err);
            return { symbol: token.symbol, synced: false, count: 0 };
          }
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value.synced) {
          totalSynced++;
          totalSwaps += result.value.count;
        }
      }

      // Small delay between batches to avoid hitting rate limits
      if (i + batchSize < allPulseTokens.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Reset] === COMPLETE: ${totalSynced}/${allPulseTokens.length} tokens synced, ${totalSwaps} total swaps in ${duration}ms ===`);

    res.json({
      success: true,
      deletedSwaps: deletedSwaps.count,
      deletedStatuses: deletedStatuses.count,
      tokensFound: allPulseTokens.length,
      tokensSynced: totalSynced,
      totalSwaps,
      durationMs: duration,
      message: `Reset complete. Synced ${totalSynced} tokens with ${totalSwaps} total swaps.`,
    });
  } catch (error) {
    console.error("Error resetting swap data:", error);
    res.status(500).json({ error: "Failed to reset swap data" });
  }
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

// GET /api/pulse/token/:address - Get enriched token data from multiple sources
// PRIORITY: 1. Database (free), 2. In-memory caches (free), 3. External APIs (costly - ONLY if not in DB)
// IMPORTANT: No duplicate API calls - use DB first, only call APIs once if needed
pulseRoutes.get("/token/:address", async (req, res) => {
  try {
    const { address } = req.params;
    let tokenData: any = null;

    // 0. Live in-memory feed (freshest), then ClickHouse (durable). Same data every
    // user sees, and it covers coins evicted from memory — no stale DB / paid API call.
    const live = getToken(address);
    if (live) return res.json({ ...live, source: "grpc" });
    if (clickhouseEnabled()) {
      try {
        const chTok = await ch.getTokenData(address, getSolPrice());
        if (chTok) return res.json({ ...chTok, source: "clickhouse" });
      } catch (e) { console.error("[pulse] CH token:", (e as Error).message); }
    }

    // 1. FIRST: Check database (free, no API call).
    // Guarded: if the DB is unavailable, fall through to external APIs instead
    // of failing the whole request.
    let dbToken = null;
    try {
      dbToken = await prisma.pulseToken.findUnique({
        where: { address },
      });
    } catch (dbErr) {
      console.warn(`[pulse/token] DB unavailable, using external APIs for ${address}`);
    }
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

      // If we have DB data, return it immediately - don't make any API calls
      // The sync service keeps this data fresh

      // Only enrich logo from cache if missing (no API call)
      if (!tokenData.logoUri) {
        const moralisLogo = moralisService.getCachedLogo(address);
        if (moralisLogo) {
          tokenData.logoUri = moralisLogo;
        } else {
          // Trigger async fetch for next time (non-blocking)
          moralisService.prefetchLogo(address);
        }
      }

      return res.json(tokenData);
    }

    // 2. Token NOT in DB - fetch from external APIs (ONE call each, cached for DB)
    // This only happens for tokens not yet synced by pulseSync
    console.log(`⚠️ Token ${address} not in DB, fetching from APIs...`);

    // Try pump.fun API first (for memecoins) - SINGLE CALL
    const pumpFunData = await pumpFunService.getCoin(address);
    if (pumpFunData) {
      tokenData = pumpFunData;
      tokenData.source = "pumpfun";
    }

    if (!tokenData) {
      // Try Moralis API - SINGLE CALL
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
      // Try DexScreener as fallback - SINGLE CALL
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
      // Try Birdeye as final fallback - SINGLE CALL
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

    // CACHE in database so we don't call APIs again for this token
    prisma.pulseToken.upsert({
      where: { address },
      create: {
        address,
        symbol: tokenData.symbol || address.slice(0, 6),
        name: tokenData.name || tokenData.symbol || "Unknown",
        logoUri: tokenData.logoUri,
        description: tokenData.description,
        price: tokenData.price || 0,
        priceChange24h: tokenData.priceChange24h || 0,
        volume24h: tokenData.volume24h || 0,
        liquidity: tokenData.liquidity || 0,
        marketCap: tokenData.marketCap || 0,
        twitter: tokenData.twitter,
        telegram: tokenData.telegram,
        website: tokenData.website,
      },
      update: {
        price: tokenData.price || 0,
        priceChange24h: tokenData.priceChange24h || 0,
        volume24h: tokenData.volume24h || 0,
        liquidity: tokenData.liquidity || 0,
        marketCap: tokenData.marketCap || 0,
        logoUri: tokenData.logoUri,
        twitter: tokenData.twitter,
        telegram: tokenData.telegram,
        website: tokenData.website,
      },
    }).catch((err) => console.log("Failed to cache token:", err));

    // Enrich with Moralis logo if not present (from cache only)
    if (!tokenData.logoUri) {
      const moralisLogo = moralisService.getCachedLogo(address);
      if (moralisLogo) {
        tokenData.logoUri = moralisLogo;
      } else {
        // Trigger async fetch for next time (non-blocking)
        moralisService.prefetchLogo(address);
      }
    }

    res.json(tokenData);
  } catch (error) {
    console.error("Error fetching token data:", error);
    res.status(500).json({ error: "Failed to fetch token data" });
  }
});

// GET /api/pulse/ohlcv/:address - Get OHLCV candlestick data
// SOURCE: Database (swaps synced from Moralis, then built into candles)
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

    // Serve from the live in-memory gRPC candles (same source as /api/feed/ohlcv).
    // The old swapSyncService/Moralis DB path is dead and 500'd.
    const intervalMap: Record<string, number> = {
      "1s": 1000, "1min": 60000, "5min": 300000, "15min": 900000,
      "30min": 1800000, "1h": 3600000, "4h": 14400000, "12h": 43200000,
      "1d": 86400000, "1w": 604800000, "1M": 2592000000,
    };
    const intervalSec = Math.max(1, Math.round((intervalMap[timeframe] || 60000) / 1000));
    // Fine tier is 250ms; pull a wide window (~5 min = 1200 candles) so the chart
    // shows real history like Axiom, not just the last 100s.
    let ohlcv = getCandles(address, intervalSec, intervalSec <= 1 ? 1200 : 100);
    let source = "grpc";
    // In-memory fine candles get wiped on restart and don't rebuild for coins that
    // stopped trading. Fall back to CH's durable 1m candles (USD, matching getCandles)
    // for ANY timeframe so the chart shows history instead of "No chart data". Sub-
    // minute views get 1m bars — coarse but present. getSolPrice() -> USD scale.
    if (ohlcv.length === 0 && clickhouseEnabled()) {
      try {
        // Build fine candles straight from the durable trade history (down to 1s),
        // NOT the coarse 1m aggregate — so a wiped/stopped coin still shows detailed
        // candles like Axiom instead of a dozen fat 1m blocks.
        const chData = await ch.getTradeCandles(address, intervalSec, 600, getSolPrice());
        if (chData.length) { ohlcv = chData; source = "clickhouse"; }
      } catch (e) { console.error("[pulse] CH ohlcv:", (e as Error).message); }
    }

    const response = {
      address,
      timeframe,
      data: ohlcv,
      timestamp: Date.now(),
      source,
    };

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

    // Trades come from ClickHouse (durable, survives restarts). The old
    // prisma.tokenSwap path queried a dead DB and always returned empty.
    let trades: any[] = [];
    if (clickhouseEnabled()) {
      const chTrades = await ch.getTrades(address, limit, getSolPrice());
      trades = chTrades.map((t: any) => ({
        txHash: "",
        timestamp: t.timestamp,
        type: t.type,
        wallet: t.wallet,
        tokenAmount: t.tokenAmount,
        tokenAmountUsd: t.totalValueUsd,
        tokenSymbol: "",
        otherAmount: t.otherAmount,
        otherSymbol: t.otherSymbol,
        otherAmountUsd: t.totalValueUsd,
        priceUsd: t.priceUsd,
        totalValueUsd: t.totalValueUsd,
      }));
    }

    const response = { address, trades, total: trades.length, timestamp: Date.now(), source: "clickhouse" };
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
