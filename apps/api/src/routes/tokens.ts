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

// Popular tokens to always include (beyond Birdeye trending limit of 20)
const POPULAR_TOKENS = [
  // Major tokens
  { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6 },
  { address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "Tether USD", decimals: 6 },
  { address: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", symbol: "WETH", name: "Wrapped Ether", decimals: 8 },
  { address: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", symbol: "mSOL", name: "Marinade staked SOL", decimals: 9 },
  { address: "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj", symbol: "stSOL", name: "Lido Staked SOL", decimals: 9 },
  { address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", decimals: 5 },
  { address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", decimals: 6 },
  { address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat", decimals: 6 },
  { address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", symbol: "PYTH", name: "Pyth Network", decimals: 6 },
  { address: "RLBxxFkseAZ4RgJH3Sqn8jXxhmGoz9jWxDNJMh8pL7a", symbol: "RLB", name: "Rollbit Coin", decimals: 2 },
  // Meme tokens
  { address: "A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump", symbol: "FWOG", name: "Fwog", decimals: 6 },
  { address: "ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY", symbol: "MOODENG", name: "Moo Deng", decimals: 6 },
  { address: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82", symbol: "BOME", name: "Book of Meme", decimals: 6 },
  { address: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7", symbol: "DRIFT", name: "Drift", decimals: 6 },
  { address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", symbol: "RAY", name: "Raydium", decimals: 6 },
  { address: "SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt", symbol: "SRM", name: "Serum", decimals: 6 },
  { address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE", symbol: "ORCA", name: "Orca", decimals: 6 },
  { address: "MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey", symbol: "MNDE", name: "Marinade", decimals: 9 },
  { address: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5", symbol: "MEW", name: "cat in a dogs world", decimals: 5 },
  { address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", symbol: "POPCAT", name: "Popcat", decimals: 9 },
];

// Sync tokens from Birdeye to database
async function syncTokensFromBirdeye() {
  console.log("📊 Syncing tokens from Birdeye...");
  try {
    const topTokens = await birdeyeService.getTopTokens(100);

    for (const token of topTokens) {
      await prisma.token.upsert({
        where: { address: token.address },
        update: {
          price: token.price,
          priceChange24h: token.priceChange24h,
          volume24h: token.volume24h,
          marketCap: token.marketCap,
          liquidity: token.liquidity,
          logoUri: token.logoURI,
        },
        create: {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          logoUri: token.logoURI,
          price: token.price,
          priceChange24h: token.priceChange24h,
          volume24h: token.volume24h,
          marketCap: token.marketCap,
          liquidity: token.liquidity,
        },
      });
    }

    // Always add/update SOL
    try {
      const solPrice = await solPriceService.getPrice();
      // SOL market cap: ~$60B, volume: ~$2B daily (rough estimates)
      const solMarketCap = solPrice * 400_000_000; // ~400M circulating supply
      await prisma.token.upsert({
        where: { address: SOL_ADDRESS },
        update: {
          price: solPrice,
          volume24h: 2_000_000_000, // Placeholder high volume to rank it well
        },
        create: {
          address: SOL_ADDRESS,
          symbol: "SOL",
          name: "Solana",
          decimals: 9,
          logoUri: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
          price: solPrice,
          priceChange24h: 0,
          volume24h: 2_000_000_000,
          marketCap: solMarketCap,
        },
      });
      console.log(`✅ Added/updated SOL token at $${solPrice.toFixed(2)}`);
    } catch (solError) {
      console.error("Failed to add SOL token:", solError);
    }

    // Add popular tokens with fresh data from Birdeye
    console.log("📊 Adding popular tokens...");
    let addedPopular = 0;
    for (const token of POPULAR_TOKENS) {
      try {
        // Try to get fresh data from Birdeye
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
          addedPopular++;
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
          addedPopular++;
        }
      } catch (err) {
        // Continue with other tokens if one fails
        console.warn(`Failed to add ${token.symbol}:`, err instanceof Error ? err.message : err);
      }
    }
    console.log(`✅ Added/updated ${addedPopular} popular tokens`);

    console.log(`✅ Synced ${topTokens.length} trending + ${addedPopular} popular tokens`);
    return topTokens.length + addedPopular;
  } catch (error) {
    console.error("Error syncing tokens from Birdeye:", error);
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

    // Check if database is empty, if so try to sync from Birdeye
    const count = await prisma.token.count();
    if (count === 0) {
      try {
        await syncTokensFromBirdeye();
      } catch (syncError) {
        console.warn("Failed to sync from Birdeye, adding fallback SOL token:", syncError);
        // Add at least SOL as a fallback so the app isn't completely empty
        try {
          const solPrice = await solPriceService.getPrice();
          await prisma.token.upsert({
            where: { address: SOL_ADDRESS },
            update: { price: solPrice },
            create: {
              address: SOL_ADDRESS,
              symbol: "SOL",
              name: "Solana",
              decimals: 9,
              logoUri: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
              price: solPrice,
              priceChange24h: 0,
              volume24h: 2_000_000_000,
              marketCap: solPrice * 400_000_000,
            },
          });
        } catch (solError) {
          console.error("Failed to add fallback SOL token:", solError);
        }
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
    const synced = await syncTokensFromBirdeye();
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
