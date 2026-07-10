/**
 * DexScreener API for Pump.fun tokens
 * Free, no rate limits, real data
 */

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    h24: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    m5: { buys: number; sells: number };
  };
  volume: { h24: number; h6: number; h1: number; m5: number };
  priceChange: { h24: number; h6: number; h1: number; m5: number };
  liquidity?: { usd: number; base: number; quote: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: { url: string }[];
    socials?: { type: string; url: string }[];
  };
}

// Legacy interface for compatibility
export interface PumpFunCoin {
  mint: string;
  name: string;
  symbol: string;
  description?: string;
  image_uri?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  creator: string;
  created_timestamp: number;
  complete: boolean;
  market_cap?: number;
  usd_market_cap?: number;
  reply_count?: number;
  total_supply?: number;
  virtual_sol_reserves?: number;
}

/**
 * Fetch new Solana tokens from DexScreener
 */
export async function fetchPumpFunNewCoins(limit = 50): Promise<PumpFunCoin[]> {
  try {
    // DexScreener latest tokens on Solana (includes pump.fun)
    const response = await fetch(
      `https://api.dexscreener.com/token-profiles/latest/v1`,
      {
        headers: {
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      throw new Error(`DexScreener API error: ${response.status}`);
    }

    const data = await response.json();

    // Filter for Solana tokens only and map to our format
    const solanaTokens = (data || [])
      .filter((t: any) => t.chainId === "solana")
      .slice(0, limit)
      .map((t: any) => {
        // Extract symbol from description or URL
        const urlParts = t.url?.split("/") || [];
        const pairSlug = urlParts[urlParts.length - 1] || "";

        return {
          mint: t.tokenAddress,
          name: t.description || pairSlug || "Unknown",
          symbol: pairSlug?.slice(0, 6)?.toUpperCase() || t.tokenAddress?.slice(0, 4)?.toUpperCase() || "???",
          image_uri: t.icon,
          twitter: t.links?.find((l: any) => l.label?.toLowerCase() === "twitter" || l.type === "twitter")?.url,
          telegram: t.links?.find((l: any) => l.label?.toLowerCase() === "telegram" || l.type === "telegram")?.url,
          website: t.links?.find((l: any) => l.label?.toLowerCase() === "website" || l.type === "website")?.url,
          creator: "",
          created_timestamp: Date.now(),
          complete: false,
          usd_market_cap: 0,
        };
      });

    return solanaTokens;
  } catch (error) {
    console.error("[DexScreener API] Error fetching tokens:", error);

    // Fallback: try pairs endpoint
    try {
      const pairsResponse = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/solana`,
        {
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (pairsResponse.ok) {
        const pairsData = await pairsResponse.json();
        return mapDexScreenerPairs(pairsData.pairs || [], limit);
      }
    } catch (e) {
      console.error("[DexScreener API] Fallback also failed:", e);
    }

    return [];
  }
}

/**
 * Map DexScreener pairs to our format
 */
function mapDexScreenerPairs(pairs: DexScreenerPair[], limit: number): PumpFunCoin[] {
  return pairs
    .filter(p => p.chainId === "solana")
    .slice(0, limit)
    .map(p => ({
      mint: p.baseToken.address,
      name: p.baseToken.name,
      symbol: p.baseToken.symbol,
      image_uri: p.info?.imageUrl,
      twitter: p.info?.socials?.find(s => s.type === "twitter")?.url,
      telegram: p.info?.socials?.find(s => s.type === "telegram")?.url,
      website: p.info?.websites?.[0]?.url,
      creator: "",
      created_timestamp: p.pairCreatedAt || Date.now(),
      complete: false,
      usd_market_cap: p.marketCap || p.fdv || 0,
      reply_count: (p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0),
    }));
}

/**
 * Fetch trending/graduating tokens from DexScreener
 */
export async function fetchPumpFunGraduating(limit = 20): Promise<PumpFunCoin[]> {
  try {
    // Get trending Solana tokens (high volume = near graduation)
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=solana`,
      {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      throw new Error(`DexScreener API error: ${response.status}`);
    }

    const data = await response.json();
    const pairs: DexScreenerPair[] = data.pairs || [];

    // Filter for high market cap tokens (near graduation threshold)
    return pairs
      .filter(p => p.chainId === "solana" && (p.marketCap || 0) > 30000 && (p.marketCap || 0) < 100000)
      .slice(0, limit)
      .map(p => ({
        mint: p.baseToken.address,
        name: p.baseToken.name,
        symbol: p.baseToken.symbol,
        image_uri: p.info?.imageUrl,
        twitter: p.info?.socials?.find(s => s.type === "twitter")?.url,
        telegram: p.info?.socials?.find(s => s.type === "telegram")?.url,
        website: p.info?.websites?.[0]?.url,
        creator: "",
        created_timestamp: p.pairCreatedAt || Date.now(),
        complete: false,
        usd_market_cap: p.marketCap || p.fdv || 0,
        reply_count: (p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0),
      }));
  } catch (error) {
    console.error("[DexScreener API] Error fetching graduating tokens:", error);
    return [];
  }
}

/**
 * Fetch graduated tokens (high market cap, established)
 */
export async function fetchPumpFunGraduated(limit = 20): Promise<PumpFunCoin[]> {
  try {
    // Get top Solana tokens by volume
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=raydium`,
      {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      throw new Error(`DexScreener API error: ${response.status}`);
    }

    const data = await response.json();
    const pairs: DexScreenerPair[] = data.pairs || [];

    // Filter for graduated tokens (high market cap, on Raydium)
    return pairs
      .filter(p => p.chainId === "solana" && p.dexId === "raydium" && (p.marketCap || 0) > 100000)
      .slice(0, limit)
      .map(p => ({
        mint: p.baseToken.address,
        name: p.baseToken.name,
        symbol: p.baseToken.symbol,
        image_uri: p.info?.imageUrl,
        twitter: p.info?.socials?.find(s => s.type === "twitter")?.url,
        telegram: p.info?.socials?.find(s => s.type === "telegram")?.url,
        website: p.info?.websites?.[0]?.url,
        creator: "",
        created_timestamp: p.pairCreatedAt || Date.now(),
        complete: true,
        usd_market_cap: p.marketCap || p.fdv || 0,
        reply_count: (p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0),
      }));
  } catch (error) {
    console.error("[DexScreener API] Error fetching graduated tokens:", error);
    return [];
  }
}

/**
 * Map PumpFun coin to our API response format
 */
export function mapCoinToResponse(coin: PumpFunCoin) {
  // Calculate progress (graduation at ~$69k market cap)
  const marketCap = coin.usd_market_cap || 0;
  const progress = Math.min(100, (marketCap / 69000) * 100);

  return {
    address: coin.mint,
    symbol: coin.symbol,
    name: coin.name,
    logoUri: coin.image_uri,
    price: marketCap / (coin.total_supply || 1_000_000_000),
    priceChange24h: 0,
    volume24h: 0,
    liquidity: (coin.virtual_sol_reserves || 0) * 150, // Rough SOL price estimate
    marketCap: marketCap,
    txCount: coin.reply_count || 0,
    createdAt: coin.created_timestamp,
    source: "pump.fun",
    description: coin.description,
    twitter: coin.twitter,
    telegram: coin.telegram,
    website: coin.website,
    complete: coin.complete,
    progress: progress,
  };
}
