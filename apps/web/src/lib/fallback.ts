/**
 * Fallback data fetchers using free public APIs (DexScreener).
 * Used when internal API / ClickHouse feed is unavailable.
 * No API keys required — DexScreener's public endpoints are free.
 */

const DEXSCREENER_BASE = "https://api.dexscreener.com";

/** Fetch with timeout + error swallow. */
async function safeFetch(url: string, timeoutMs = 8000): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal, next: { revalidate: 15 } });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Token info
// ---------------------------------------------------------------------------

export interface FallbackToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUri?: string;
  price?: number;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
  liquidity?: number;
}

function mapDexPair(pair: any): FallbackToken {
  return {
    address: pair.baseToken?.address || "",
    symbol: pair.baseToken?.symbol || "???",
    name: pair.baseToken?.name || "Unknown",
    decimals: 9,
    logoUri: pair.info?.imageUrl || undefined,
    price: pair.priceUsd ? parseFloat(pair.priceUsd) : 0,
    priceChange24h: pair.priceChange?.h24 ?? 0,
    volume24h: pair.volume?.h24 ?? 0,
    marketCap: pair.marketCap ?? pair.fdv ?? 0,
    liquidity: pair.liquidity?.usd ?? 0,
  };
}

/** Get token info by address from DexScreener. */
export async function fallbackTokenInfo(address: string): Promise<FallbackToken | null> {
  const data = await safeFetch(`${DEXSCREENER_BASE}/tokens/v1/solana/${address}`);
  if (!data || !Array.isArray(data) || data.length === 0) return null;
  // Pick the pair with highest liquidity
  const sorted = data.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  return mapDexPair(sorted[0]);
}

// ---------------------------------------------------------------------------
// Trending / top tokens list
// ---------------------------------------------------------------------------

/** Get trending Solana tokens from DexScreener. */
export async function fallbackTrendingTokens(limit = 50): Promise<FallbackToken[]> {
  // DexScreener "token boosts" endpoint — shows recently boosted (trending) tokens
  const data = await safeFetch(`${DEXSCREENER_BASE}/token-boosts/top/v1`);
  if (!data || !Array.isArray(data)) return [];

  // Filter to Solana only
  const solTokens = data
    .filter((t: any) => t.chainId === "solana" && t.tokenAddress)
    .slice(0, Math.min(limit, 30));

  if (solTokens.length === 0) return [];

  // Batch-fetch token details (DexScreener allows up to 30 addresses)
  const addresses = solTokens.map((t: any) => t.tokenAddress).join(",");
  const details = await safeFetch(`${DEXSCREENER_BASE}/tokens/v1/solana/${addresses}`);
  if (!details || !Array.isArray(details)) return [];

  // Deduplicate by base token address (pick highest-liquidity pair per token)
  const byAddress = new Map<string, any>();
  for (const pair of details) {
    const addr = pair.baseToken?.address;
    if (!addr) continue;
    const existing = byAddress.get(addr);
    if (!existing || (pair.liquidity?.usd ?? 0) > (existing.liquidity?.usd ?? 0)) {
      byAddress.set(addr, pair);
    }
  }

  return Array.from(byAddress.values()).map(mapDexPair).slice(0, limit);
}

// ---------------------------------------------------------------------------
// OHLCV candles
// ---------------------------------------------------------------------------

export interface FallbackCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Map timeframe strings to DexScreener's /ohlcv format (not available in free tier,
 *  so we synthesize from price data). DexScreener doesn't have a free OHLCV endpoint,
 *  so we use Birdeye's free defi endpoint or generate synthetic candles from the
 *  pair's price history. */

// Use GeckoTerminal (free, no key) for OHLCV
const GECKOTERMINAL_BASE = "https://api.geckoterminal.com/api/v2";

const TIMEFRAME_MAP: Record<string, { gt: string; aggregate: string }> = {
  "1m":  { gt: "minute", aggregate: "1" },
  "1min": { gt: "minute", aggregate: "1" },
  "5m":  { gt: "minute", aggregate: "5" },
  "5min": { gt: "minute", aggregate: "5" },
  "15m": { gt: "minute", aggregate: "15" },
  "1h":  { gt: "hour", aggregate: "1" },
  "4h":  { gt: "hour", aggregate: "4" },
  "1d":  { gt: "day", aggregate: "1" },
  "1w":  { gt: "day", aggregate: "1" },  // week not supported, use day
  "1M":  { gt: "day", aggregate: "1" },  // month not supported, use day
};

/** Get OHLCV candles for a token. Uses GeckoTerminal (free, no key). */
export async function fallbackOHLCV(
  address: string,
  timeframe = "1h",
  limit = 100
): Promise<FallbackCandle[]> {
  // First, find the pool address from DexScreener
  const dexData = await safeFetch(`${DEXSCREENER_BASE}/tokens/v1/solana/${address}`);
  if (!dexData || !Array.isArray(dexData) || dexData.length === 0) return [];

  // Pick the highest-liquidity pair
  const sorted = dexData.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const poolAddress = sorted[0].pairAddress;
  if (!poolAddress) return [];

  const tf = TIMEFRAME_MAP[timeframe] || TIMEFRAME_MAP["1h"];

  // GeckoTerminal OHLCV endpoint (free, no key)
  const url = `${GECKOTERMINAL_BASE}/networks/solana/pools/${poolAddress}/ohlcv/${tf.gt}?aggregate=${tf.aggregate}&limit=${Math.min(limit, 1000)}`;
  const data = await safeFetch(url);

  if (!data?.data?.attributes?.ohlcv_list) return [];

  // GeckoTerminal returns [timestamp, open, high, low, close, volume] arrays, newest first
  const candles: FallbackCandle[] = data.data.attributes.ohlcv_list
    .map((c: number[]) => ({
      timestamp: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
    }))
    .reverse(); // oldest first for charts

  return candles;
}

// ---------------------------------------------------------------------------
// Pulse-like data (new/graduating/graduated memecoins)
// ---------------------------------------------------------------------------

export interface FallbackPulseToken {
  address: string;
  symbol: string;
  name: string;
  logoUri?: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  txCount: number;
  createdAt: number;
  source: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  complete?: boolean;
  replyCount?: number;
  ohlcv: any[];
  progress?: number;
  marketCapSol?: number;
  feesPaidSol?: number;
  buys?: number;
  sells?: number;
}

function mapDexPairToPulse(pair: any, category: string): FallbackPulseToken {
  const createdAt = pair.pairCreatedAt ? new Date(pair.pairCreatedAt).getTime() : Date.now();
  return {
    address: pair.baseToken?.address || "",
    symbol: pair.baseToken?.symbol || "???",
    name: pair.baseToken?.name || "Unknown",
    logoUri: pair.info?.imageUrl || undefined,
    price: pair.priceUsd ? parseFloat(pair.priceUsd) : 0,
    priceChange24h: pair.priceChange?.h24 ?? 0,
    volume24h: pair.volume?.h24 ?? 0,
    liquidity: pair.liquidity?.usd ?? 0,
    marketCap: pair.marketCap ?? pair.fdv ?? 0,
    txCount: (pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0),
    createdAt,
    source: "dexscreener",
    description: pair.info?.description,
    twitter: pair.info?.socials?.find((s: any) => s.type === "twitter")?.url,
    telegram: pair.info?.socials?.find((s: any) => s.type === "telegram")?.url,
    website: pair.info?.websites?.[0]?.url,
    complete: category === "graduated",
    ohlcv: [],
    buys: pair.txns?.h24?.buys ?? 0,
    sells: pair.txns?.h24?.sells ?? 0,
  };
}

/** Fetch latest Solana pairs from DexScreener for "new pairs". */
export async function fallbackNewPairs(limit = 50): Promise<FallbackPulseToken[]> {
  // Latest pairs on Solana
  const data = await safeFetch(`${DEXSCREENER_BASE}/latest/dex/pairs/solana`);
  if (!data?.pairs || !Array.isArray(data.pairs)) return [];

  return data.pairs
    .filter((p: any) => p.baseToken?.address && p.liquidity?.usd > 100)
    .slice(0, limit)
    .map((p: any) => mapDexPairToPulse(p, "new"));
}

/** Fetch trending Solana tokens for "graduating" (high momentum memecoins). */
export async function fallbackGraduating(limit = 20): Promise<FallbackPulseToken[]> {
  // Use token boosts as proxy for "graduating" (high activity tokens)
  const data = await safeFetch(`${DEXSCREENER_BASE}/token-boosts/top/v1`);
  if (!data || !Array.isArray(data)) return [];

  const solTokens = data
    .filter((t: any) => t.chainId === "solana" && t.tokenAddress)
    .slice(0, Math.min(limit, 30));

  if (solTokens.length === 0) return [];

  const addresses = solTokens.map((t: any) => t.tokenAddress).join(",");
  const details = await safeFetch(`${DEXSCREENER_BASE}/tokens/v1/solana/${addresses}`);
  if (!details || !Array.isArray(details)) return [];

  // Deduplicate by token address
  const byAddress = new Map<string, any>();
  for (const pair of details) {
    const addr = pair.baseToken?.address;
    if (!addr) continue;
    const existing = byAddress.get(addr);
    if (!existing || (pair.liquidity?.usd ?? 0) > (existing.liquidity?.usd ?? 0)) {
      byAddress.set(addr, pair);
    }
  }

  return Array.from(byAddress.values())
    .map((p) => {
      const t = mapDexPairToPulse(p, "graduating");
      // Estimate progress based on market cap (pump.fun graduation ~$60-80k)
      t.progress = Math.min(100, ((t.marketCap || 0) / 70000) * 100);
      return t;
    })
    .slice(0, limit);
}

/** Fetch graduated tokens — higher market cap Solana memecoins. */
export async function fallbackGraduated(limit = 50): Promise<FallbackPulseToken[]> {
  // Search for Solana tokens sorted by volume (recently active = likely graduated)
  const data = await safeFetch(`${DEXSCREENER_BASE}/token-profiles/latest/v1`);
  if (!data || !Array.isArray(data)) return [];

  const solTokens = data
    .filter((t: any) => t.chainId === "solana" && t.tokenAddress)
    .slice(0, Math.min(limit, 30));

  if (solTokens.length === 0) return [];

  const addresses = solTokens.map((t: any) => t.tokenAddress).join(",");
  const details = await safeFetch(`${DEXSCREENER_BASE}/tokens/v1/solana/${addresses}`);
  if (!details || !Array.isArray(details)) return [];

  const byAddress = new Map<string, any>();
  for (const pair of details) {
    const addr = pair.baseToken?.address;
    if (!addr) continue;
    const existing = byAddress.get(addr);
    if (!existing || (pair.liquidity?.usd ?? 0) > (existing.liquidity?.usd ?? 0)) {
      byAddress.set(addr, pair);
    }
  }

  return Array.from(byAddress.values())
    .map((p) => mapDexPairToPulse(p, "graduated"))
    .slice(0, limit);
}
