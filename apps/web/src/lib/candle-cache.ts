import { prisma } from "./prisma";

interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Timeframe to milliseconds
const TIMEFRAME_MS: Record<string, number> = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

// How long before we consider cached data stale and need to fetch fresh
// For historical data (closed candles), we never need to refresh
// For the most recent candle, we need to refresh frequently
const CACHE_STALE_MS: Record<string, number> = {
  "1m": 30 * 1000,      // 30 seconds
  "5m": 60 * 1000,      // 1 minute
  "15m": 2 * 60 * 1000, // 2 minutes
  "1h": 5 * 60 * 1000,  // 5 minutes
  "4h": 10 * 60 * 1000, // 10 minutes
  "1d": 30 * 60 * 1000, // 30 minutes
};

export class CandleCacheService {
  // Get cached candles for a token, returns what we have
  async getCachedCandles(
    tokenAddress: string,
    timeframe: string,
    fromTimestamp: number,
    toTimestamp: number
  ): Promise<OHLCV[]> {
    const candles = await prisma.candleCache.findMany({
      where: {
        tokenAddress,
        timeframe,
        timestamp: {
          gte: new Date(fromTimestamp),
          lte: new Date(toTimestamp),
        },
      },
      orderBy: { timestamp: "asc" },
    });

    return candles.map((c) => ({
      timestamp: c.timestamp.getTime(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
  }

  // Get the most recent cached candle timestamp for a token
  async getLatestCachedTimestamp(
    tokenAddress: string,
    timeframe: string
  ): Promise<number | null> {
    const latest = await prisma.candleCache.findFirst({
      where: { tokenAddress, timeframe },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true, updatedAt: true },
    });

    if (!latest) return null;
    return latest.timestamp.getTime();
  }

  // Check if we need to fetch fresh data
  async needsFreshData(
    tokenAddress: string,
    timeframe: string,
    toTimestamp: number
  ): Promise<{ needsFetch: boolean; fetchFrom: number | null }> {
    const latestCached = await this.getLatestCachedTimestamp(tokenAddress, timeframe);
    const intervalMs = TIMEFRAME_MS[timeframe] || 60 * 60 * 1000;
    const staleMs = CACHE_STALE_MS[timeframe] || 5 * 60 * 1000;

    // No cached data at all
    if (!latestCached) {
      return { needsFetch: true, fetchFrom: null };
    }

    const now = Date.now();
    const timeSinceLastCandle = now - latestCached;

    // If the last cached candle is more than 2 intervals old, we need fresh data
    if (timeSinceLastCandle > intervalMs * 2) {
      return { needsFetch: true, fetchFrom: latestCached };
    }

    // Check if the most recent candle was updated recently enough
    const latestRecord = await prisma.candleCache.findFirst({
      where: { tokenAddress, timeframe },
      orderBy: { timestamp: "desc" },
      select: { updatedAt: true },
    });

    if (latestRecord) {
      const timeSinceUpdate = now - latestRecord.updatedAt.getTime();
      if (timeSinceUpdate > staleMs) {
        // Need to refresh the most recent candle
        return { needsFetch: true, fetchFrom: latestCached - intervalMs };
      }
    }

    return { needsFetch: false, fetchFrom: null };
  }

  // Store candles in the cache
  async storeCandles(
    tokenAddress: string,
    timeframe: string,
    candles: OHLCV[]
  ): Promise<void> {
    if (candles.length === 0) return;

    // Use upsert for each candle (batch would be more efficient but this is safer)
    const upsertPromises = candles.map((candle) =>
      prisma.candleCache.upsert({
        where: {
          tokenAddress_timeframe_timestamp: {
            tokenAddress,
            timeframe,
            timestamp: new Date(candle.timestamp),
          },
        },
        update: {
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
        create: {
          tokenAddress,
          timeframe,
          timestamp: new Date(candle.timestamp),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
      })
    );

    // Process in batches of 100 to avoid overwhelming the database
    const batchSize = 100;
    for (let i = 0; i < upsertPromises.length; i += batchSize) {
      await Promise.all(upsertPromises.slice(i, i + batchSize));
    }
  }

  // Clean up old candles (run periodically)
  async cleanupOldCandles(maxAgeMs: number = 90 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const result = await prisma.candleCache.deleteMany({
      where: {
        timestamp: { lt: cutoff },
      },
    });
    return result.count;
  }
}

export const candleCacheService = new CandleCacheService();
