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

// How often to refresh the CURRENT (live) candle only
// Historical candles NEVER need refreshing - they're immutable
const LIVE_CANDLE_REFRESH_MS: Record<string, number> = {
  "1min": 30 * 1000,    // Refresh live 1m candle every 30s
  "1m": 30 * 1000,
  "5min": 60 * 1000,    // Refresh live 5m candle every 60s
  "5m": 60 * 1000,
  "15m": 2 * 60 * 1000, // Refresh live 15m candle every 2m
  "1h": 5 * 60 * 1000,  // Refresh live 1h candle every 5m
  "4h": 5 * 60 * 1000,  // Refresh live 4h candle every 5m
  "1d": 10 * 60 * 1000, // Refresh live 1d candle every 10m
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

    return candles.map((c: { timestamp: Date; open: number; high: number; low: number; close: number; volume: number }) => ({
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
  // PRINCIPLE: Historical candles are IMMUTABLE - never refetch them
  // Only fetch: (1) missing historical data, (2) the LIVE candle that's still forming
  async shouldFetchFresh(
    tokenAddress: string,
    timeframe: string,
    requestedToTimestamp: number
  ): Promise<{ shouldFetch: boolean; fetchFromTimestamp: number | null; onlyLiveCandle: boolean }> {
    const normalizedTf = normalizeTimeframe(timeframe);
    const latestCached = await this.getLatestCachedTimestamp(tokenAddress, normalizedTf);
    const intervalMs = TIMEFRAME_MS[normalizedTf] || 60 * 60 * 1000;
    const liveRefreshMs = LIVE_CANDLE_REFRESH_MS[normalizedTf] || 60 * 1000;

    // No cached data at all - need full fetch
    if (!latestCached) {
      console.log(`[candleCache] No cache for ${tokenAddress.substring(0, 8)}... ${normalizedTf}, need full fetch`);
      return { shouldFetch: true, fetchFromTimestamp: null, onlyLiveCandle: false };
    }

    const now = Date.now();

    // Calculate the current candle's start time (the "live" candle that's still forming)
    const currentCandleStart = Math.floor(now / intervalMs) * intervalMs;

    // Check if we have ALL historical candles up to (but not including) the current live candle
    // If latestCached >= currentCandleStart - intervalMs, we have all historical data
    const hasAllHistorical = latestCached >= currentCandleStart - intervalMs;

    if (!hasAllHistorical) {
      // We're missing some historical candles - fetch from where we left off
      console.log(`[candleCache] Missing historical candles for ${tokenAddress.substring(0, 8)}... ${normalizedTf}, fetching from ${new Date(latestCached).toISOString()}`);
      return { shouldFetch: true, fetchFromTimestamp: latestCached, onlyLiveCandle: false };
    }

    // We have all historical data - only need to refresh the LIVE candle
    // Check when we last updated the live candle
    const latestRecord = await prisma.candleCache.findFirst({
      where: { tokenAddress, timeframe: normalizedTf },
      orderBy: { timestamp: "desc" },
      select: { updatedAt: true, timestamp: true },
    });

    if (latestRecord) {
      const timeSinceUpdate = now - latestRecord.updatedAt.getTime();

      // Only refresh if enough time has passed
      if (timeSinceUpdate > liveRefreshMs) {
        console.log(`[candleCache] Refreshing live candle for ${tokenAddress.substring(0, 8)}... ${normalizedTf} (last update ${Math.round(timeSinceUpdate / 1000)}s ago)`);
        // Only fetch the current candle and maybe the previous one (in case it just closed)
        return { shouldFetch: true, fetchFromTimestamp: currentCandleStart - intervalMs, onlyLiveCandle: true };
      }
    }

    console.log(`[candleCache] Cache is complete and fresh for ${tokenAddress.substring(0, 8)}... ${normalizedTf}`);
    return { shouldFetch: false, fetchFromTimestamp: null, onlyLiveCandle: false };
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

  // Get the oldest cached candle timestamp
  async getOldestCachedTimestamp(
    tokenAddress: string,
    timeframe: string
  ): Promise<number | null> {
    const normalizedTf = normalizeTimeframe(timeframe);
    const oldest = await prisma.candleCache.findFirst({
      where: { tokenAddress, timeframe: normalizedTf },
      orderBy: { timestamp: "asc" },
      select: { timestamp: true },
    });

    return oldest ? oldest.timestamp.getTime() : null;
  }

  // Get candles, using cache when possible, fetching fresh when needed
  // OPTIMIZED: Only fetches NEW data - historical candles are cached permanently
  async getCandles(
    tokenAddress: string,
    timeframe: string,
    fromTimestamp: number,
    toTimestamp: number,
    fetchFn: (from: number, to: number) => Promise<OHLCV[]>
  ): Promise<OHLCV[]> {
    const normalizedTf = normalizeTimeframe(timeframe);
    const intervalMs = TIMEFRAME_MS[normalizedTf] || 60 * 60 * 1000;

    // Check if we should fetch fresh data
    const { shouldFetch, fetchFromTimestamp, onlyLiveCandle } = await this.shouldFetchFresh(
      tokenAddress,
      normalizedTf,
      toTimestamp
    );

    // Also check if we need historical data OLDER than what's cached
    const oldestCached = await this.getOldestCachedTimestamp(tokenAddress, normalizedTf);
    const needsOlderHistoricalFetch = oldestCached !== null && fromTimestamp < oldestCached;

    // Get cached candles first - this is our foundation
    const cachedCandles = await this.getCachedCandles(
      tokenAddress,
      normalizedTf,
      fromTimestamp,
      toTimestamp
    );

    // Calculate expected number of candles for the requested range
    const expectedCandles = Math.floor((toTimestamp - fromTimestamp) / intervalMs);

    // Force full fetch if we have way fewer candles than expected (indicates incomplete cache)
    // Use 50% threshold - if we have less than half what we expect, cache is incomplete
    const cacheIsIncomplete = cachedCandles.length < expectedCandles * 0.5;

    console.log(`[candleCache] ${tokenAddress.substring(0, 8)}... ${normalizedTf}: have ${cachedCandles.length} candles, expected ~${expectedCandles}, incomplete: ${cacheIsIncomplete}, shouldFetch: ${shouldFetch}, onlyLive: ${onlyLiveCandle}`);

    if (cacheIsIncomplete) {
      console.log(`[candleCache] Cache incomplete for ${tokenAddress.substring(0, 8)}... ${normalizedTf}: have ${cachedCandles.length}, need ${Math.floor(expectedCandles * 0.5)}+`);
    }

    // If we only need the live candle and we have cached data, just update that
    // BUT only if we don't need older historical data AND cache isn't incomplete
    if (onlyLiveCandle && cachedCandles.length > 0 && shouldFetch && fetchFromTimestamp && !needsOlderHistoricalFetch && !cacheIsIncomplete) {
      try {
        const now = Date.now();
        console.log(`[candleCache] Fetching ONLY live candle for ${tokenAddress.substring(0, 8)}... ${normalizedTf}`);
        const liveCandles = await fetchFn(fetchFromTimestamp, now);

        if (liveCandles.length > 0) {
          // Store just the live candle(s)
          this.storeCandles(tokenAddress, normalizedTf, liveCandles).catch((e) =>
            console.error("[candleCache] Failed to store live candle:", e)
          );

          // Merge: cached historical + fresh live candles
          const uniqueByTimestamp = new Map<number, OHLCV>();
          for (const c of cachedCandles) {
            uniqueByTimestamp.set(c.timestamp, c);
          }
          // Live candles override cached ones (they're more recent)
          for (const c of liveCandles) {
            uniqueByTimestamp.set(c.timestamp, c);
          }
          return Array.from(uniqueByTimestamp.values()).sort((a, b) => a.timestamp - b.timestamp);
        }
      } catch (error) {
        console.error("[candleCache] Live candle fetch failed, using cache:", error);
      }
      return cachedCandles;
    }

    // Need to fetch data (either no cache, missing historical, missing recent, or incomplete cache)
    if (shouldFetch || needsOlderHistoricalFetch || cachedCandles.length === 0 || cacheIsIncomplete) {
      let fetchFrom: number;
      let fetchTo = toTimestamp;

      if (cachedCandles.length === 0 && !oldestCached) {
        // No cache at all - fetch full range
        fetchFrom = fromTimestamp;
      } else if (cacheIsIncomplete || needsOlderHistoricalFetch) {
        // Cache is incomplete or we need older data - fetch full range
        // This will get complete historical data and fill any gaps
        fetchFrom = fromTimestamp;
        fetchTo = toTimestamp;
        console.log(`[candleCache] Full re-fetch for ${tokenAddress.substring(0, 8)}... ${normalizedTf} (incomplete: ${cacheIsIncomplete}, needsOlder: ${needsOlderHistoricalFetch})`);
      } else {
        // Need recent data - fetch from where cache ends
        fetchFrom = fetchFromTimestamp || fromTimestamp;
      }

      try {
        console.log(`[candleCache] Fetching ${tokenAddress.substring(0, 8)}... ${normalizedTf} from ${new Date(fetchFrom).toISOString()} to ${new Date(fetchTo).toISOString()}`);
        const freshCandles = await fetchFn(fetchFrom, fetchTo);

        if (freshCandles.length > 0) {
          // Store in cache (async, don't block response)
          this.storeCandles(tokenAddress, normalizedTf, freshCandles).catch((e) =>
            console.error("[candleCache] Failed to store candles:", e)
          );
        }

        // Merge cached + fresh, deduplicate by timestamp
        const allCandles = [...cachedCandles, ...freshCandles];
        const uniqueByTimestamp = new Map<number, OHLCV>();
        for (const c of allCandles) {
          uniqueByTimestamp.set(c.timestamp, c);
        }
        return Array.from(uniqueByTimestamp.values()).sort((a, b) => a.timestamp - b.timestamp);
      } catch (error) {
        console.error("[candleCache] Fetch failed, falling back to cache:", error);
        return cachedCandles;
      }
    }

    // Cache is complete and fresh - serve directly
    // But double-check we actually have enough candles!
    if (cacheIsIncomplete) {
      console.log(`[candleCache] WARNING: Serving incomplete cache for ${tokenAddress.substring(0, 8)}... ${normalizedTf} (${cachedCandles.length}/${expectedCandles} candles) - this shouldn't happen!`);
    } else {
      console.log(`[candleCache] Serving ${tokenAddress.substring(0, 8)}... ${normalizedTf} from cache (${cachedCandles.length} candles)`);
    }
    return cachedCandles;
  }
}

export const candleCacheService = new CandleCacheService();
