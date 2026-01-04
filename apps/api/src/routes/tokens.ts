import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { jupiterService } from "../services/jupiter";
import { birdeyeService } from "../services/birdeye";
import { geckoTerminalService } from "../services/geckoterminal";
// PumpPortal removed - using Moralis for all swap data
import { coinGeckoService } from "../services/coingecko";
import { solPriceService } from "../services/solPrice";
import { candleCacheService } from "../services/candleCache";
import { cache } from "../lib/cache";

export const tokenRoutes = Router();

// Query params schema
const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
  sort: z.enum(["marketCap", "volume24h", "priceChange24h", "createdAt"]).default("volume24h"),
  order: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().optional(),
});

const ohlcvQuerySchema = z.object({
  timeframe: z.enum(["1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"]).default("1h"),
  from: z.coerce.number().optional(),
  to: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(1000).default(500),
  cacheOnly: z.coerce.boolean().optional().default(false), // If true, only read from DB cache, never fetch from Birdeye
});

// Helper to aggregate daily candles into weekly
function aggregateToWeekly(dailyCandles: any[]): any[] {
  if (dailyCandles.length === 0) return [];

  const weeklyCandles: any[] = [];
  let currentWeek: any[] = [];
  let weekStart = 0;

  for (const candle of dailyCandles) {
    const candleTime = candle.timestamp;
    const dayOfWeek = new Date(candleTime).getUTCDay(); // 0 = Sunday

    // Start new week on Sunday or if first candle
    if (currentWeek.length === 0) {
      weekStart = candleTime;
      currentWeek.push(candle);
    } else if (dayOfWeek === 0 && currentWeek.length > 0) {
      // It's Sunday - close current week and start new one
      weeklyCandles.push({
        timestamp: currentWeek[0].timestamp,
        open: currentWeek[0].open,
        high: Math.max(...currentWeek.map((c: any) => c.high)),
        low: Math.min(...currentWeek.map((c: any) => c.low)),
        close: currentWeek[currentWeek.length - 1].close,
        volume: currentWeek.reduce((sum: number, c: any) => sum + c.volume, 0),
      });
      currentWeek = [candle];
      weekStart = candleTime;
    } else {
      currentWeek.push(candle);
    }
  }

  // Don't forget the last week
  if (currentWeek.length > 0) {
    weeklyCandles.push({
      timestamp: currentWeek[0].timestamp,
      open: currentWeek[0].open,
      high: Math.max(...currentWeek.map((c: any) => c.high)),
      low: Math.min(...currentWeek.map((c: any) => c.low)),
      close: currentWeek[currentWeek.length - 1].close,
      volume: currentWeek.reduce((sum: number, c: any) => sum + c.volume, 0),
    });
  }

  return weeklyCandles;
}

// Helper to aggregate daily candles into monthly
function aggregateToMonthly(dailyCandles: any[]): any[] {
  if (dailyCandles.length === 0) return [];

  const monthlyCandles: any[] = [];
  let currentMonth: any[] = [];
  let currentMonthKey = "";

  for (const candle of dailyCandles) {
    const date = new Date(candle.timestamp);
    const monthKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;

    if (currentMonth.length === 0) {
      currentMonthKey = monthKey;
      currentMonth.push(candle);
    } else if (monthKey !== currentMonthKey) {
      // New month - close current month and start new one
      monthlyCandles.push({
        timestamp: currentMonth[0].timestamp,
        open: currentMonth[0].open,
        high: Math.max(...currentMonth.map((c: any) => c.high)),
        low: Math.min(...currentMonth.map((c: any) => c.low)),
        close: currentMonth[currentMonth.length - 1].close,
        volume: currentMonth.reduce((sum: number, c: any) => sum + c.volume, 0),
      });
      currentMonth = [candle];
      currentMonthKey = monthKey;
    } else {
      currentMonth.push(candle);
    }
  }

  // Don't forget the last month
  if (currentMonth.length > 0) {
    monthlyCandles.push({
      timestamp: currentMonth[0].timestamp,
      open: currentMonth[0].open,
      high: Math.max(...currentMonth.map((c: any) => c.high)),
      low: Math.min(...currentMonth.map((c: any) => c.low)),
      close: currentMonth[currentMonth.length - 1].close,
      volume: currentMonth.reduce((sum: number, c: any) => sum + c.volume, 0),
    });
  }

  return monthlyCandles;
}

// Native SOL token address (wrapped SOL)
const SOL_ADDRESS = "So11111111111111111111111111111111111111112";

// Curated tokens list - ONLY these tokens will appear on dashboard
const DASHBOARD_TOKENS = [
  // Core
  { address: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", decimals: 9 },
  { address: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", symbol: "JitoSOL", name: "Jito Staked SOL", decimals: 9 },
  { address: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", symbol: "WETH", name: "Wrapped Ether", decimals: 8 },
  { address: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", symbol: "WBTC", name: "Wrapped BTC (Wormhole)", decimals: 8 },
  { address: "FUAfBo2jgks6gB4Z4LfZkqSZgzNucisEHqnNebaRxM1P", symbol: "ZEC", name: "Zcash", decimals: 8 },
  { address: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", symbol: "PUMP", name: "Pump", decimals: 6 },
  // Political/Trending
  { address: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", symbol: "TRUMP", name: "Official Trump", decimals: 6 },
  // Meme
  { address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", decimals: 5 },
  { address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat", decimals: 6 },
  { address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", symbol: "POPCAT", name: "Popcat", decimals: 9 },
  // DeFi
  { address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", decimals: 6 },
  { address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", symbol: "RAY", name: "Raydium", decimals: 6 },
];

// Track if initial sync has run (to avoid running multiple times per server start)
let initialSyncComplete = false;
let metadataSynced = false; // Only fetch metadata ONCE per server start
let dashboardSyncTimer: NodeJS.Timeout | null = null;
const DASHBOARD_SYNC_INTERVAL = 60000; // 60 seconds for price updates

// Start background sync for dashboard tokens
export function startDashboardTokenSync() {
  if (dashboardSyncTimer) return;

  console.log("[Dashboard] Starting background token sync every 60s");

  // Sync immediately (includes one-time metadata fetch)
  syncDashboardTokens().then(() => {
    initialSyncComplete = true;
  }).catch(console.error);

  // Then sync every 60 seconds for price updates only
  dashboardSyncTimer = setInterval(() => {
    syncDashboardTokens().catch(console.error);
  }, DASHBOARD_SYNC_INTERVAL);
}

// Sync ONLY curated dashboard tokens
// METADATA: Only fetched ONCE per server start (logos, names never change)
// PRICES: Fetched every 60 seconds
async function syncDashboardTokens() {
  console.log("📊 Syncing curated dashboard tokens...");
  try {
    // Get the addresses we want to keep
    const allowedAddresses = DASHBOARD_TOKENS.map(t => t.address);

    // Delete ALL tokens that are not in our curated list (only on first run)
    if (!metadataSynced) {
      const deleted = await prisma.token.deleteMany({
        where: {
          address: {
            notIn: allowedAddresses,
          },
        },
      });
      if (deleted.count > 0) {
        console.log(`🗑️ Deleted ${deleted.count} tokens not in curated list`);
      }
    }

    // Check which tokens need metadata (only fetch once)
    const existingTokens = await prisma.token.findMany({
      where: { address: { in: allowedAddresses } },
      select: { address: true, logoUri: true },
    });
    const existingMap = new Map(existingTokens.map(t => [t.address, t]));

    let added = 0;
    for (const token of DASHBOARD_TOKENS) {
      try {
        const existing = existingMap.get(token.address);
        const needsMetadata = !metadataSynced && (!existing || !existing.logoUri);

        if (needsMetadata) {
          // Fetch full data from Birdeye (includes metadata) - only once
          const freshData = await birdeyeService.getTokenData(token.address);

          if (freshData) {
            console.log(`📈 ${token.symbol}: price=$${freshData.price?.toFixed(6)}, mc=$${freshData.marketCap?.toLocaleString()}`);
            await prisma.token.upsert({
              where: { address: token.address },
              update: {
                price: freshData.price || 0,
                priceChange24h: freshData.priceChange24h || 0,
                volume24h: freshData.volume24h || 0,
                marketCap: freshData.marketCap || 0,
                liquidity: freshData.liquidity || 0,
                logoUri: freshData.logoURI,
              },
              create: {
                address: token.address,
                symbol: freshData.symbol || token.symbol,
                name: freshData.name || token.name,
                decimals: freshData.decimals || token.decimals,
                logoUri: freshData.logoURI,
                price: freshData.price || 0,
                priceChange24h: freshData.priceChange24h || 0,
                volume24h: freshData.volume24h || 0,
                marketCap: freshData.marketCap || 0,
                liquidity: freshData.liquidity || 0,
              },
            });
            added++;
          } else {
            // Add with basic info if Birdeye doesn't have data
            await prisma.token.upsert({
              where: { address: token.address },
              update: {},
              create: {
                address: token.address,
                symbol: token.symbol,
                name: token.name,
                decimals: token.decimals,
                price: 0,
                volume24h: 0,
                marketCap: 0,
              },
            });
            added++;
          }
        } else {
          // Just update prices - use Birdeye price endpoint (cheaper than full token data)
          const freshData = await birdeyeService.getTokenData(token.address);
          if (freshData) {
            await prisma.token.update({
              where: { address: token.address },
              data: {
                price: freshData.price || 0,
                priceChange24h: freshData.priceChange24h || 0,
                volume24h: freshData.volume24h || 0,
                marketCap: freshData.marketCap || 0,
                liquidity: freshData.liquidity || 0,
              },
            });
          }
        }
      } catch (err) {
        console.warn(`Failed to sync ${token.symbol}:`, err instanceof Error ? err.message : err);
      }
    }

    // Mark metadata as synced after first run
    if (!metadataSynced) {
      metadataSynced = true;
      console.log(`✅ Dashboard metadata synced for ${DASHBOARD_TOKENS.length} tokens`);

      // On first sync, also populate OHLCV cache for all dashboard tokens
      // This runs in background so dashboard loads instantly
      syncDashboardOHLCV().catch(console.error);
    }

    if (added > 0) {
      console.log(`✅ Added ${added} new tokens`);
    }
    return added;
  } catch (error) {
    console.error("Error syncing dashboard tokens:", error);
    throw error;
  }
}

// Timeframe configurations for OHLCV sync
// Historical data is fetched ONCE, then only live candles are refreshed
const OHLCV_TIMEFRAMES = [
  { tf: "1m", rangeMs: 7 * 24 * 60 * 60 * 1000, intervalMs: 60 * 1000 },           // 7 days
  { tf: "5m", rangeMs: 30 * 24 * 60 * 60 * 1000, intervalMs: 5 * 60 * 1000 },       // 30 days
  { tf: "15m", rangeMs: 90 * 24 * 60 * 60 * 1000, intervalMs: 15 * 60 * 1000 },     // 90 days
  { tf: "1h", rangeMs: 2 * 365 * 24 * 60 * 60 * 1000, intervalMs: 60 * 60 * 1000 }, // 2 years
  { tf: "4h", rangeMs: 3 * 365 * 24 * 60 * 60 * 1000, intervalMs: 4 * 60 * 60 * 1000 }, // 3 years
  { tf: "1d", rangeMs: 5 * 365 * 24 * 60 * 60 * 1000, intervalMs: 24 * 60 * 60 * 1000 }, // 5 years
];

let ohlcvSyncTimer: NodeJS.Timeout | null = null;
let historicalSyncComplete = false;
const LIVE_CANDLE_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Background sync for OHLCV data
// PRINCIPLE: Historical data is IMMUTABLE - fetch once, cache forever
// Only refresh LIVE (current) candles every 5 minutes
async function syncDashboardOHLCV() {
  console.log("📊 Starting background OHLCV cache population...");

  // On first run, fetch ALL historical data for all timeframes
  if (!historicalSyncComplete) {
    await syncHistoricalOHLCV();
    historicalSyncComplete = true;

    // Start periodic live candle refresh
    if (!ohlcvSyncTimer) {
      console.log(`[OHLCV-Sync] Starting live candle refresh every ${LIVE_CANDLE_REFRESH_INTERVAL / 1000}s`);
      ohlcvSyncTimer = setInterval(() => {
        refreshLiveCandles().catch(console.error);
      }, LIVE_CANDLE_REFRESH_INTERVAL);
    }
  }
}

// One-time fetch of ALL historical data for all tokens and timeframes
async function syncHistoricalOHLCV() {
  console.log("📊 [OHLCV-Sync] Fetching ALL historical data (one-time)...");
  const now = Date.now();

  for (const token of DASHBOARD_TOKENS) {
    for (const { tf, rangeMs, intervalMs } of OHLCV_TIMEFRAMES) {
      try {
        const fromMs = now - rangeMs;

        // Check if we already have enough cached data
        const cached = await candleCacheService.getCachedCandles(token.address, tf, fromMs, now);
        const expectedCandles = Math.floor(rangeMs / intervalMs);

        // Only fetch if cache is less than 50% complete
        if (cached.length < expectedCandles * 0.5) {
          console.log(`[OHLCV-Sync] ${token.symbol} ${tf}: Only ${cached.length}/${expectedCandles} candles, fetching...`);

          const fromSec = Math.floor(fromMs / 1000);
          const toSec = Math.floor(now / 1000);
          const candles = await birdeyeService.getOHLCV(token.address, tf as any, { from: fromSec, to: toSec });

          if (candles.length > 0) {
            await candleCacheService.storeCandles(token.address, tf, candles);
            console.log(`[OHLCV-Sync] ${token.symbol} ${tf}: Cached ${candles.length} candles`);
          }

          // Rate limit: 500ms between Birdeye API calls
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          console.log(`[OHLCV-Sync] ${token.symbol} ${tf}: Cache OK (${cached.length}/${expectedCandles})`);
        }
      } catch (err) {
        console.warn(`[OHLCV-Sync] ${token.symbol} ${tf} failed:`, err instanceof Error ? err.message : err);
      }
    }
  }

  console.log("✅ Historical OHLCV sync complete");
}

// Periodic refresh of LIVE candles only (every 5 min)
// Only fetches the current candle + maybe the previous one (if it just closed)
async function refreshLiveCandles() {
  console.log("🔄 [OHLCV-Sync] Refreshing live candles...");
  const now = Date.now();

  for (const token of DASHBOARD_TOKENS) {
    // Only refresh 1m and 5m live candles (most useful for dashboard)
    // Larger timeframes change slowly, don't need frequent refresh
    for (const tf of ["1m", "5m"] as const) {
      try {
        const intervalMs = tf === "1m" ? 60 * 1000 : 5 * 60 * 1000;

        // Fetch just the last 2 candles (current + previous in case it just closed)
        const fromMs = now - (2 * intervalMs);
        const fromSec = Math.floor(fromMs / 1000);
        const toSec = Math.floor(now / 1000);

        const candles = await birdeyeService.getOHLCV(token.address, tf, { from: fromSec, to: toSec });

        if (candles.length > 0) {
          await candleCacheService.storeCandles(token.address, tf, candles);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        // Silent fail for live candle refresh - not critical
      }
    }
  }

  console.log("✅ Live candle refresh complete");
}

// GET /api/tokens - List all tokens from DATABASE
// Background sync keeps DB updated every 30 seconds
// All users read from same cached DB data = massive reduction in external API calls
tokenRoutes.get("/", async (req, res) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const { page, limit, sort, order, search } = query;

    const where = search
      ? {
          OR: [
            { symbol: { contains: search, mode: "insensitive" as const } },
            { name: { contains: search, mode: "insensitive" as const } },
            { address: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [tokens, total] = await Promise.all([
      prisma.token.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.token.count({ where }),
    ]);

    const response = {
      data: tokens,
      total,
      page,
      limit,
      hasMore: page * limit < total,
    };

    res.json(response);
  } catch (error) {
    console.error("Error fetching tokens:", error);
    res.status(500).json({ error: "Failed to fetch tokens" });
  }
});

// POST /api/tokens/sync - Force sync tokens from Birdeye
tokenRoutes.post("/sync", async (req, res) => {
  try {
    const synced = await syncDashboardTokens();
    res.json({ success: true, synced });
  } catch (error) {
    console.error("Error syncing tokens:", error);
    res.status(500).json({ error: "Failed to sync tokens" });
  }
});

// GET /api/tokens/:address - Get single token
// Always fetches fresh data from Birdeye to ensure accurate market data
tokenRoutes.get("/:address", async (req, res) => {
  try {
    const { address } = req.params;

    // Try cache first (2 min cache to reduce Birdeye calls)
    const cacheKey = `tokens:${address}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Always try to fetch fresh data from Birdeye first
    const birdeyeData = await birdeyeService.getTokenData(address);

    let token;

    if (birdeyeData) {
      // Upsert token with fresh Birdeye data
      token = await prisma.token.upsert({
        where: { address },
        update: {
          price: birdeyeData.price,
          priceChange24h: birdeyeData.priceChange24h,
          volume24h: birdeyeData.volume24h,
          marketCap: birdeyeData.marketCap,
          liquidity: birdeyeData.liquidity,
          logoUri: birdeyeData.logoURI,
        },
        create: {
          address: birdeyeData.address,
          symbol: birdeyeData.symbol,
          name: birdeyeData.name,
          decimals: birdeyeData.decimals,
          logoUri: birdeyeData.logoURI,
          price: birdeyeData.price,
          priceChange24h: birdeyeData.priceChange24h,
          volume24h: birdeyeData.volume24h,
          marketCap: birdeyeData.marketCap,
          liquidity: birdeyeData.liquidity,
        },
      });
    } else {
      // Fallback to DB if Birdeye fails
      token = await prisma.token.findUnique({
        where: { address },
      });
    }

    if (!token) {
      return res.status(404).json({ error: "Token not found" });
    }

    // Cache for 2 minutes to reduce Birdeye API calls
    await cache.set(cacheKey, JSON.stringify(token), 120);

    res.json(token);
  } catch (error) {
    console.error("Error fetching token:", error);
    res.status(500).json({ error: "Failed to fetch token" });
  }
});

// GET /api/tokens/:address/ohlcv - Get OHLCV data
tokenRoutes.get("/:address/ohlcv", async (req, res) => {
  try {
    const { address } = req.params;
    const query = ohlcvQuerySchema.parse(req.query);
    const { timeframe, from, to, limit, cacheOnly } = query;

    // NOTE: No Redis cache here - candleCacheService handles DB caching
    // cacheOnly=true means only read from DB, never fetch from Birdeye (for dashboard previews)

    let ohlcv;

    // For 1s timeframe, return empty - not supported without PumpPortal
    if (timeframe === "1s") {
      ohlcv = [];
    }
    // For weekly timeframe, first check DB cache (pre-aggregated), then fall back to aggregating daily candles
    else if (timeframe === "1w") {
      const now = Date.now();
      const toMs = to ? to * 1000 : now;
      const fromMs = from && from > 0 ? from * 1000 : now - (5 * 365 * 24 * 60 * 60 * 1000); // 5 years default

      console.log(`[OHLCV] 1w request for ${address.substring(0, 8)}...: from=${from} (${new Date(fromMs).toISOString()}), to=${to} (${new Date(toMs).toISOString()})`);

      // First try to get pre-aggregated weekly candles from DB cache
      const cachedWeekly = await candleCacheService.getCachedCandles(address, "1w", fromMs, toMs);

      console.log(`[OHLCV] 1w cache query returned ${cachedWeekly.length} candles for ${address.substring(0, 8)}...`);
      if (cachedWeekly.length > 0) {
        console.log(`[OHLCV] 1w first candle: ${new Date(cachedWeekly[0].timestamp).toISOString()}, last: ${new Date(cachedWeekly[cachedWeekly.length-1].timestamp).toISOString()}`);
      }

      if (cachedWeekly.length > 0) {
        console.log(`[OHLCV] Serving ${address.substring(0, 8)}... 1w from DB cache (${cachedWeekly.length} candles)`);
        ohlcv = cachedWeekly;
      } else {
        // Fallback: fetch daily candles and aggregate to weekly
        console.log(`[OHLCV] No 1w cache for ${address.substring(0, 8)}..., aggregating from daily`);
        // Use 5 years of daily data for proper weekly aggregation
        const requestFrom = from && from > 0 ? from : Math.floor(now / 1000) - (5 * 365 * 86400);
        const requestTo = to || Math.floor(now / 1000);

        const dailyCandles = await birdeyeService.getOHLCV(address, "1d", {
          from: requestFrom,
          to: requestTo,
          limit: 2000, // Need ~1825 days for 5 years
        });

        const uniqueCandles = Array.from(
          new Map((dailyCandles || []).map(c => [c.timestamp, c])).values()
        ).sort((a, b) => a.timestamp - b.timestamp);

        ohlcv = aggregateToWeekly(uniqueCandles);
      }

      // Apply limit if specified
      if (limit && ohlcv.length > limit) {
        ohlcv = ohlcv.slice(-limit);
      }
    }
    // For monthly timeframe, first check DB cache (pre-aggregated), then fall back to aggregating daily candles
    else if (timeframe === "1M") {
      const now = Date.now();
      const toMs = to ? to * 1000 : now;
      const fromMs = from && from > 0 ? from * 1000 : now - (5 * 365 * 24 * 60 * 60 * 1000); // 5 years default

      console.log(`[OHLCV] 1M request for ${address.substring(0, 8)}...: from=${from} (${new Date(fromMs).toISOString()}), to=${to} (${new Date(toMs).toISOString()})`);

      // First try to get pre-aggregated monthly candles from DB cache
      const cachedMonthly = await candleCacheService.getCachedCandles(address, "1M", fromMs, toMs);

      console.log(`[OHLCV] 1M cache query returned ${cachedMonthly.length} candles for ${address.substring(0, 8)}...`);
      if (cachedMonthly.length > 0) {
        console.log(`[OHLCV] 1M first candle: ${new Date(cachedMonthly[0].timestamp).toISOString()}, last: ${new Date(cachedMonthly[cachedMonthly.length-1].timestamp).toISOString()}`);
      }

      if (cachedMonthly.length > 0) {
        console.log(`[OHLCV] Serving ${address.substring(0, 8)}... 1M from DB cache (${cachedMonthly.length} candles)`);
        ohlcv = cachedMonthly;
      } else {
        // Fallback: fetch daily candles and aggregate to monthly
        console.log(`[OHLCV] No 1M cache for ${address.substring(0, 8)}..., aggregating from daily`);
        // Use 5 years of daily data for proper monthly aggregation
        const requestFrom = from && from > 0 ? from : Math.floor(now / 1000) - (5 * 365 * 86400);
        const requestTo = to || Math.floor(now / 1000);

        const dailyCandles = await birdeyeService.getOHLCV(address, "1d", {
          from: requestFrom,
          to: requestTo,
          limit: 2000, // Need ~1825 days for 5 years
        });

        const uniqueCandles = (dailyCandles || []).sort((a: any, b: any) => a.timestamp - b.timestamp);
        ohlcv = aggregateToMonthly(uniqueCandles);
      }

      // Apply limit if specified
      if (limit && ohlcv.length > limit) {
        ohlcv = ohlcv.slice(-limit);
      }
    } else {
      // Use Birdeye for main dashboard tokens (established tokens with history)
      // Now with database caching to reduce Birdeye API calls
      const now = Date.now();
      const toMs = (to ? to * 1000 : now);

      // If no 'from' provided, fetch ALL historical data (max ranges)
      let fromMs: number;
      if (from && from > 0) {
        fromMs = from * 1000;
      } else {
        // Default to ALL available history for each timeframe
        // These are generous ranges - Birdeye will return whatever data exists
        const defaultRanges: Record<string, number> = {
          "1m": 7 * 24 * 60 * 60 * 1000,         // 7 days for 1m (10080 candles max)
          "5m": 30 * 24 * 60 * 60 * 1000,        // 30 days for 5m (8640 candles max)
          "15m": 90 * 24 * 60 * 60 * 1000,       // 90 days for 15m (8640 candles max)
          "1h": 2 * 365 * 24 * 60 * 60 * 1000,   // 2 years for 1h
          "4h": 3 * 365 * 24 * 60 * 60 * 1000,   // 3 years for 4h
          "1d": 5 * 365 * 24 * 60 * 60 * 1000,   // 5 years for 1d
        };
        const range = defaultRanges[timeframe] || 365 * 24 * 60 * 60 * 1000;
        fromMs = now - range;
      }

      // cacheOnly mode: Just read from DB, don't fetch from Birdeye
      // Used for dashboard previews - instant response, no API calls
      if (cacheOnly) {
        ohlcv = await candleCacheService.getCachedCandles(address, timeframe, fromMs, toMs);
        console.log(`[OHLCV] Cache-only: ${address.substring(0, 8)}... ${timeframe} - ${ohlcv.length} candles from DB`);
      } else {
        // Full mode: Check cache, fetch from Birdeye if needed
        try {
          ohlcv = await candleCacheService.getCandles(
            address,
            timeframe,
            fromMs,
            toMs,
            async (fetchFromMs, fetchToMs) => {
              const fetchFromSec = Math.floor(fetchFromMs / 1000);
              const fetchToSec = Math.floor(fetchToMs / 1000);
              console.log(`[OHLCV] Fetching from Birdeye: ${address.substring(0, 8)}... ${timeframe}`);
              return birdeyeService.getOHLCV(address, timeframe, {
                from: fetchFromSec,
                to: fetchToSec,
                limit,
              });
            }
          );
        } catch (birdeyeError) {
          console.warn(`OHLCV failed for ${address}:`, birdeyeError instanceof Error ? birdeyeError.message : birdeyeError);
          ohlcv = [];
        }
      }
    }

    // NOTE: No Redis caching - DB candleCacheService handles it
    res.json(ohlcv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error fetching OHLCV:", message);
    res.status(500).json({ error: "Failed to fetch OHLCV data" });
  }
});

// GET /api/tokens/:address/supply - Get supply data from CoinGecko
// Only works for major tokens that have CoinGecko listings
tokenRoutes.get("/:address/supply", async (req, res) => {
  try {
    const { address } = req.params;

    // Try cache first (5 minute TTL)
    const cacheKey = `supply:${address}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Get supply data from CoinGecko
    const supplyData = await coinGeckoService.getSupplyDataByAddress(address);

    if (!supplyData) {
      // Return null values if token not found in CoinGecko
      const fallback = {
        totalSupply: null,
        maxSupply: null,
        circulatingSupply: null,
        source: "none",
      };
      return res.json(fallback);
    }

    const response = {
      ...supplyData,
      source: "coingecko",
    };

    // Cache for 5 minutes
    await cache.set(cacheKey, JSON.stringify(response), 300);

    res.json(response);
  } catch (error) {
    console.error("Error fetching supply data:", error);
    res.status(500).json({ error: "Failed to fetch supply data" });
  }
});
