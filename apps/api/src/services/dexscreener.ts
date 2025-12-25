// DexScreener API - Free, no API key needed
// Docs: https://docs.dexscreener.com/api/reference

const DEXSCREENER_API_URL = "https://api.dexscreener.com";

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
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  info?: {
    imageUrl?: string;
    websites?: { url: string }[];
    socials?: { type: string; url: string }[];
  };
}

export interface NewPairToken {
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
  pairAddress?: string;
  dexId?: string;
}

class DexScreenerService {
  // Get latest token profiles (new tokens with info)
  async getLatestTokenProfiles(): Promise<NewPairToken[]> {
    try {
      const response = await fetch(`${DEXSCREENER_API_URL}/token-profiles/latest/v1`, {
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`DexScreener API error: ${response.status}`);
      }

      const data = await response.json();

      // Filter for Solana tokens
      const solanaTokens = (data || [])
        .filter((token: any) => token.chainId === "solana")
        .map((token: any) => ({
          address: token.tokenAddress,
          symbol: token.symbol || "???",
          name: token.description || token.symbol || "Unknown",
          logoUri: token.icon,
          price: 0,
          priceChange24h: 0,
          volume24h: 0,
          liquidity: 0,
          marketCap: 0,
          txCount: 0,
          createdAt: Date.now(),
          source: "dexscreener",
        }));

      return solanaTokens;
    } catch (error) {
      console.error("Error fetching DexScreener token profiles:", error);
      return [];
    }
  }

  // Get boosted tokens (promoted/trending)
  async getBoostedTokens(): Promise<NewPairToken[]> {
    try {
      const response = await fetch(`${DEXSCREENER_API_URL}/token-boosts/latest/v1`, {
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`DexScreener API error: ${response.status}`);
      }

      const data = await response.json();

      // Filter for Solana tokens
      const solanaTokens = (data || [])
        .filter((token: any) => token.chainId === "solana")
        .map((token: any) => ({
          address: token.tokenAddress,
          symbol: token.symbol || "???",
          name: token.name || token.symbol || "Unknown",
          logoUri: token.icon,
          price: 0,
          priceChange24h: 0,
          volume24h: 0,
          liquidity: 0,
          marketCap: 0,
          txCount: token.totalAmount || 0,
          createdAt: Date.now(),
          source: "boosted",
        }));

      return solanaTokens;
    } catch (error) {
      console.error("Error fetching DexScreener boosted tokens:", error);
      return [];
    }
  }

  // Search for new Solana pairs
  async searchNewPairs(query: string = "pump"): Promise<NewPairToken[]> {
    try {
      const response = await fetch(
        `${DEXSCREENER_API_URL}/latest/dex/search?q=${encodeURIComponent(query)}`,
        { headers: { accept: "application/json" } }
      );

      if (!response.ok) {
        throw new Error(`DexScreener API error: ${response.status}`);
      }

      const data = await response.json();
      const pairs: DexScreenerPair[] = data.pairs || [];

      // Filter for Solana pairs and map to our format
      return pairs
        .filter((pair) => pair.chainId === "solana")
        .map((pair) => this.mapPairToToken(pair));
    } catch (error) {
      console.error("Error searching DexScreener pairs:", error);
      return [];
    }
  }

  // Get pairs for a specific token
  async getTokenPairs(tokenAddress: string): Promise<DexScreenerPair[]> {
    try {
      const response = await fetch(
        `${DEXSCREENER_API_URL}/latest/dex/tokens/${tokenAddress}`,
        { headers: { accept: "application/json" } }
      );

      if (!response.ok) {
        throw new Error(`DexScreener API error: ${response.status}`);
      }

      const data = await response.json();
      return (data.pairs || []).filter((pair: DexScreenerPair) => pair.chainId === "solana");
    } catch (error) {
      console.error("Error fetching token pairs:", error);
      return [];
    }
  }

  // Get new pairs from Raydium (main Solana DEX)
  async getNewSolanaPairs(): Promise<NewPairToken[]> {
    try {
      // Search for recent pairs on Raydium
      const response = await fetch(
        `${DEXSCREENER_API_URL}/latest/dex/pairs/solana`,
        { headers: { accept: "application/json" } }
      );

      if (!response.ok) {
        // This endpoint might not exist, try alternative
        return this.searchNewPairs("");
      }

      const data = await response.json();
      const pairs: DexScreenerPair[] = data.pairs || [];

      return pairs.map((pair) => this.mapPairToToken(pair));
    } catch (error) {
      console.error("Error fetching new Solana pairs:", error);
      return [];
    }
  }

  private mapPairToToken(pair: DexScreenerPair): NewPairToken {
    const txCount24h =
      (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);

    return {
      address: pair.baseToken.address,
      symbol: pair.baseToken.symbol,
      name: pair.baseToken.name,
      logoUri: pair.info?.imageUrl,
      price: parseFloat(pair.priceUsd) || 0,
      priceChange24h: pair.priceChange?.h24 || 0,
      volume24h: pair.volume?.h24 || 0,
      liquidity: pair.liquidity?.usd || 0,
      marketCap: pair.marketCap || pair.fdv || 0,
      txCount: txCount24h,
      createdAt: pair.pairCreatedAt || Date.now(),
      source: pair.dexId || "unknown",
      pairAddress: pair.pairAddress,
      dexId: pair.dexId,
    };
  }

  // Get token data in Birdeye-compatible format (for replacing Birdeye calls)
  async getTokenData(tokenAddress: string): Promise<{
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI: string | null;
    price: number;
    priceChange24h: number;
    volume24h: number;
    liquidity: number;
    marketCap: number;
  } | null> {
    try {
      const pairs = await this.getTokenPairs(tokenAddress);
      if (pairs.length === 0) return null;

      const pair = pairs[0];
      return {
        address: pair.baseToken.address,
        symbol: pair.baseToken.symbol,
        name: pair.baseToken.name,
        decimals: 6, // Default for Solana tokens
        logoURI: pair.info?.imageUrl || null,
        price: parseFloat(pair.priceUsd) || 0,
        priceChange24h: pair.priceChange?.h24 || 0,
        volume24h: pair.volume?.h24 || 0,
        liquidity: pair.liquidity?.usd || 0,
        marketCap: pair.marketCap || pair.fdv || 0,
      };
    } catch (error) {
      console.error("Error fetching token data from DexScreener:", error);
      return null;
    }
  }
}

export const dexScreenerService = new DexScreenerService();
