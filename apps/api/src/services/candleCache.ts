import { prisma } from "../lib/prisma";

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
  "1min": 60 * 1000,
  "1m": 60 * 1000,
  "5min": 5 * 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

// How long before the most recent cached candle is considered stale
const CACHE_STALE_MS: Record<string, number> = {
  "1min": 30 * 1000,
  "1m": 30 * 1000,
  "5min": 60 * 1000,
  "5m": 60 * 1000,
  "15m": 2 * 60 * 1000,
  "1h": 5 * 60 * 1000,
  "4h": 10 * 60 * 1000,
  "1d": 30 * 60 * 1000,
};

// Normalize timeframe names
function normalizeTimeframe(tf: string): string {
  if (tf === "1min") return "1m";
  if (tf === "5min") return "5m";
  return tf;
}

class CandleCacheService {
  // Get cached candles for a token within a time range
  async getCachedCandles(
    tokenAddress: string,
    timeframe: string,
    fromTimestamp: number,
    toTimestamp: number
  ): Promise<OHLCV[]> {
    const normalizedTf = normalizeTimeframe(timeframe);
    const candles = await prisma.candleCache.findMany({
      where: {
        tokenAddress,
        timeframe: normalizedTf,
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

  // Get the latest cached candle timestamp
  async getLatestCachedTimestamp(
    tokenAddress: string,
    timeframe: string
  ): Promise<number | null> {
    const normalizedTf = normalizeTimeframe(timeframe);
    const latest = await prisma.candleCache.findFirst({
      where: { tokenAddress, timeframe: normalizedTf },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    });

    return latest ? latest.timestamp.getTime() : null;
  }

  // Check if we need to fetch fresh data from external API
  async shouldFetchFresh(
    tokenAddress: string,
    timeframe: string,
    requestedToTimestamp: number
  ): Promise<{ shouldFetch: boolean; fetchFromTimestamp: number | null }> {
    const normalizedTf = normalizeTimeframe(timeframe);
    const latestCached = await this.getLatestCachedTimestamp(tokenAddress, normalizedTf);
    const intervalMs = TIMEFRAME_MS[normalizedTf] || 60 * 60 * 1000;
    const staleMs = CACHE_STALE_MS[normalizedTf] || 5 * 60 * 1000;

    // No cached data - need full fetch
    if (!latestCached) {
      return { shouldFetch: true, fetchFromTimestamp: null };
    }

    const now = Date.now();
    const timeSinceLastCandle = now - latestCached;

    // If the last cached candle is more than 2 intervals old, fetch from there
    if (timeSinceLastCandle > intervalMs * 2) {
      console.log(`[candleCache] Cache is ${Math.round(timeSinceLastCandle / 1000 / 60)}min old, fetching fresh from ${new Date(latestCached).toISOString()}`);
      return { shouldFetch: true, fetchFromTimestamp: latestCached };
    }

    // Check if the most recent candle was updated recently
    const latestRecord = await prisma.candleCache.findFirst({
      where: { tokenAddress, timeframe: normalizedTf },
      orderBy: { timestamp: "desc" },
      select: { updatedAt: true },
    });

    if (latestRecord) {
      const timeSinceUpdate = now - latestRecord.updatedAt.getTime();
      if (timeSinceUpdate > staleMs) {
        // Need to refresh the most recent candle
        console.log(`[candleCache] Most recent candle is ${Math.round(timeSinceUpdate / 1000)}s old, refreshing`);
        return { shouldFetch: true, fetchFromTimestamp: latestCached - intervalMs };
      }
    }

    console.log(`[candleCache] Cache is fresh, no fetch needed`);
    return { shouldFetch: false, fetchFromTimestamp: null };
  }

  // Store candles in the cache
  async storeCandles(
    tokenAddress: string,
    timeframe: string,
    candles: OHLCV[]
  ): Promise<void> {
    if (candles.length === 0) return;

    const normalizedTf = normalizeTimeframe(timeframe);
    console.log(`[candleCache] Storing ${candles.length} candles for ${tokenAddress.substring(0, 8)}... (${normalizedTf})`);

    // Batch upserts in chunks
    const batchSize = 100;
    for (let i = 0; i < candles.length; i += batchSize) {
      const batch = candles.slice(i, i + batchSize);
      await Promise.all(
        batch.map((candle) =>
          prisma.candleCache.upsert({
            where: {
              tokenAddress_timeframe_timestamp: {
                tokenAddress,
                timeframe: normalizedTf,
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
              timeframe: normalizedTf,
              timestamp: new Date(candle.timestamp),
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
            },
          })
        )
      );
    }
  }

  // Get candles, using cache when possible, fetching fresh when needed
  async getCandles(
    tokenAddress: string,
    timeframe: string,
    fromTimestamp: number,
    toTimestamp: number,
    fetchFn: (from: number, to: number) => Promise<OHLCV[]>
  ): Promise<OHLCV[]> {
    const normalizedTf = normalizeTimeframe(timeframe);

    // Check if we should fetch fresh data
    const { shouldFetch, fetchFromTimestamp } = await this.shouldFetchFresh(
      tokenAddress,
      normalizedTf,
      toTimestamp
    );

    if (shouldFetch) {
      // Determine what range to fetch
      const fetchFrom = fetchFromTimestamp || fromTimestamp;

      try {
        // Fetch fresh candles
        const freshCandles = await fetchFn(fetchFrom, toTimestamp);

        if (freshCandles.length > 0) {
          // Store in cache (async, don't block response)
          this.storeCandles(tokenAddress, normalizedTf, freshCandles).catch((e) =>
            console.error("[candleCache] Failed to store candles:", e)
          );
        }

        // If we only fetched partial data, merge with cached data
        if (fetchFromTimestamp) {
          const cachedCandles = await this.getCachedCandles(
            tokenAddress,
            normalizedTf,
            fromTimestamp,
            fetchFromTimestamp - 1
          );

          // Merge and deduplicate by timestamp
          const allCandles = [...cachedCandles, ...freshCandles];
          const uniqueByTimestamp = new Map<number, OHLCV>();
          for (const c of allCandles) {
            uniqueByTimestamp.set(c.timestamp, c);
          }
          return Array.from(uniqueByTimestamp.values()).sort(
            (a, b) => a.timestamp - b.timestamp
          );
        }

        return freshCandles;
      } catch (error) {
        console.error("[candleCache] Fetch failed, falling back to cache:", error);
        // Fall back to cache if fetch fails
        return this.getCachedCandles(tokenAddress, normalizedTf, fromTimestamp, toTimestamp);
      }
    }

    // Use cached data
    return this.getCachedCandles(tokenAddress, normalizedTf, fromTimestamp, toTimestamp);
  }
}

export const candleCacheService = new CandleCacheService();
