import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { jupiterService } from "../services/jupiter";
import { birdeyeService } from "../services/birdeye";
import { geckoTerminalService } from "../services/geckoterminal";
import { pumpPortalService } from "../services/pumpportal";
import { coinGeckoService } from "../services/coingecko";
import { solPriceService } from "../services/solPrice";
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
  // AI
  { address: "Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs", symbol: "GRASS", name: "Grass", decimals: 9 },
  // Meme
  { address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", decimals: 5 },
  { address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat", decimals: 6 },
  { address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", symbol: "POPCAT", name: "Popcat", decimals: 9 },
  // DeFi
  { address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", decimals: 6 },
  { address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", symbol: "RAY", name: "Raydium", decimals: 6 },
  { address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE", symbol: "ORCA", name: "Orca", decimals: 6 },
  { address: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7", symbol: "DRIFT", name: "Drift", decimals: 6 },
  { address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", symbol: "PYTH", name: "Pyth Network", decimals: 6 },
];

// Track if initial sync has run (to avoid running multiple times per server start)
let initialSyncComplete = false;

// Sync ONLY curated dashboard tokens - deletes all others
async function syncDashboardTokens() {
  console.log("📊 Syncing curated dashboard tokens...");
  try {
    // Get the addresses we want to keep
    const allowedAddresses = DASHBOARD_TOKENS.map(t => t.address);

    // Delete ALL tokens that are not in our curated list
    const deleted = await prisma.token.deleteMany({
      where: {
        address: {
          notIn: allowedAddresses,
        },
      },
    });
    console.log(`🗑️ Deleted ${deleted.count} tokens not in curated list`);

    // Add/update only the curated tokens with fresh data from Birdeye
    let added = 0;
    for (const token of DASHBOARD_TOKENS) {
      try {
        const freshData = await birdeyeService.getTokenData(token.address);

        if (freshData) {
          await prisma.token.upsert({
            where: { address: token.address },
            update: {
              price: freshData.price,
              priceChange24h: freshData.priceChange24h,
              volume24h: freshData.volume24h,
              marketCap: freshData.marketCap,
              liquidity: freshData.liquidity,
              logoUri: freshData.logoURI,
            },
            create: {
              address: token.address,
              symbol: freshData.symbol || token.symbol,
              name: freshData.name || token.name,
              decimals: freshData.decimals || token.decimals,
              logoUri: freshData.logoURI,
              price: freshData.price,
              priceChange24h: freshData.priceChange24h,
              volume24h: freshData.volume24h,
              marketCap: freshData.marketCap,
              liquidity: freshData.liquidity,
            },
          });
          added++;
          console.log(`✅ Added ${token.symbol}`);
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
          console.log(`✅ Added ${token.symbol} (no Birdeye data)`);
        }
      } catch (err) {
        console.warn(`Failed to add ${token.symbol}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`✅ Dashboard now has exactly ${added} curated tokens`);
    return added;
  } catch (error) {
    console.error("Error syncing dashboard tokens:", error);
    throw error;
  }
}

// GET /api/tokens - List all tokens
tokenRoutes.get("/", async (req, res) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const { page, limit, sort, order, search } = query;

    // Try cache first
    const cacheKey = `tokens:list:${JSON.stringify(query)}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Sync curated tokens on first request after server start
    if (!initialSyncComplete) {
      console.log("🔄 Initial token sync needed...");
      try {
        await syncDashboardTokens();
        initialSyncComplete = true;
        console.log("✅ Initial token sync complete");
      } catch (syncError) {
        console.warn("Failed to sync tokens:", syncError);
        initialSyncComplete = true; // Don't retry on every request
      }
    }

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

    // Cache for 30 seconds
    await cache.set(cacheKey, JSON.stringify(response), 30);

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

    // Try cache first (short 30s cache for fresh data)
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

    // Cache for 30 seconds (shorter for fresh market data)
    await cache.set(cacheKey, JSON.stringify(token), 30);

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
    const { timeframe, from, to, limit } = query;

    // Try cache first
    const cacheKey = `ohlcv:${address}:${timeframe}:${from}:${to}:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    let ohlcv;

    // For 1s timeframe, use PumpPortal real-time data (for new pump.fun tokens)
    if (timeframe === "1s") {
      const pumpPortalOHLCV = pumpPortalService.getTokenOHLCV(address);
      if (pumpPortalOHLCV && pumpPortalOHLCV.length > 0) {
        console.log(`📊 Serving PumpPortal 1s OHLCV for ${address} (${pumpPortalOHLCV.length} candles)`);
        ohlcv = pumpPortalOHLCV.slice(-limit);
      } else {
        ohlcv = [];
      }
    }
    // For weekly timeframe, fetch daily candles and aggregate them
    else if (timeframe === "1w") {
      // Fetch daily candles and aggregate to weekly
      // For full history, we make multiple requests paginating backwards
      const allDailyCandles: any[] = [];
      let currentTo = to || Math.floor(Date.now() / 1000);

      // Check if this is an "all time" request (from=0 or not specified)
      const isAllTime = !from || from === 0;

      // Make up to 20 requests to get more history for "all time"
      const maxRequests = isAllTime ? 20 : 10;

      for (let i = 0; i < maxRequests; i++) {
        try {
          // For "all time", go back 1000 days from currentTo each request
          // For specific range, use the provided from
          const requestFrom = isAllTime
            ? currentTo - (1000 * 86400)  // 1000 days back
            : from;

          const dailyCandles = await birdeyeService.getOHLCV(address, "1d", {
            from: requestFrom,
            to: currentTo,
            limit: 1000,
          });

          if (dailyCandles.length === 0) break;

          // Prepend candles (older candles go first)
          allDailyCandles.unshift(...dailyCandles);

          // Move to before the oldest candle we got
          // Timestamp is in milliseconds from birdeye service
          const oldestTimestamp = dailyCandles[0]?.timestamp;
          if (!oldestTimestamp) break;

          // If we got less than 1000 candles, we've reached the beginning
          if (dailyCandles.length < 1000) {
            console.log(`Reached beginning of history at ${new Date(oldestTimestamp).toISOString()}`);
            break;
          }

          // Convert to seconds for next request
          currentTo = Math.floor(oldestTimestamp / 1000) - 1;

          // If specific from was requested and we've passed it, stop
          if (!isAllTime && currentTo <= from) break;
        } catch (err) {
          // If request fails (e.g., no more history), stop fetching
          console.log("Stopped fetching history:", err);
          break;
        }
      }

      // Remove duplicates and sort by timestamp
      const uniqueCandles = Array.from(
        new Map(allDailyCandles.map(c => [c.timestamp, c])).values()
      ).sort((a, b) => a.timestamp - b.timestamp);

      // Aggregate to weekly
      ohlcv = aggregateToWeekly(uniqueCandles);

      // Apply limit if specified
      if (limit && ohlcv.length > limit) {
        ohlcv = ohlcv.slice(-limit);
      }
    }
    // For monthly timeframe, fetch daily candles and aggregate them
    else if (timeframe === "1M") {
      // Fetch daily candles and aggregate to monthly
      const allDailyCandles: any[] = [];
      let currentTo = to || Math.floor(Date.now() / 1000);

      // Check if this is an "all time" request (from=0 or not specified)
      const isAllTime = !from || from === 0;

      // Make up to 20 requests to get full history
      const maxRequests = isAllTime ? 20 : 10;

      for (let i = 0; i < maxRequests; i++) {
        try {
          const requestFrom = isAllTime
            ? currentTo - (1000 * 86400)  // 1000 days back
            : from;

          const dailyCandles = await birdeyeService.getOHLCV(address, "1d", {
            from: requestFrom,
            to: currentTo,
            limit: 1000,
          });

          if (dailyCandles.length === 0) break;

          allDailyCandles.unshift(...dailyCandles);

          const oldestTimestamp = dailyCandles[0]?.timestamp;
          if (!oldestTimestamp) break;

          if (dailyCandles.length < 1000) {
            console.log(`Reached beginning of history at ${new Date(oldestTimestamp).toISOString()}`);
            break;
          }

          currentTo = Math.floor(oldestTimestamp / 1000) - 1;

          if (!isAllTime && currentTo <= from) break;
        } catch (err) {
          console.log("Stopped fetching history:", err);
          break;
        }
      }

      // Remove duplicates and sort by timestamp
      const uniqueCandles = Array.from(
        new Map(allDailyCandles.map(c => [c.timestamp, c])).values()
      ).sort((a, b) => a.timestamp - b.timestamp);

      // Aggregate to monthly
      ohlcv = aggregateToMonthly(uniqueCandles);

      // Apply limit if specified
      if (limit && ohlcv.length > limit) {
        ohlcv = ohlcv.slice(-limit);
      }
    } else {
      // Use Birdeye for main dashboard tokens (established tokens with history)
      // Pulse tokens use /api/pulse/ohlcv endpoint which goes to PumpPortal
      try {
        ohlcv = await birdeyeService.getOHLCV(address, timeframe, { from, to, limit });
      } catch (birdeyeError) {
        // Birdeye failed (rate limit, etc.) - return empty array instead of 500
        console.warn(`Birdeye OHLCV failed for ${address}:`, birdeyeError instanceof Error ? birdeyeError.message : birdeyeError);
        ohlcv = [];
      }
    }

    // Cache for 15 seconds (shorter for real-time data), longer for weekly/monthly
    // Don't cache PumpPortal data as it updates in real-time
    const isPumpPortalData = ohlcv?.length > 0 && ohlcv[0]?.timestamp > Date.now() - 300000;
    const cacheDuration = (timeframe === "1w" || timeframe === "1M") ? 60 : (isPumpPortalData ? 2 : 15);
    await cache.set(cacheKey, JSON.stringify(ohlcv), cacheDuration);

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
