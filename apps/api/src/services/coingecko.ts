/**
 * CoinGecko API Service
 * Free API for supply data (circulating_supply, total_supply, max_supply)
 * Rate limit: 10-30 calls/minute on free tier
 * Docs: https://docs.coingecko.com/reference/coins-markets
 */

const COINGECKO_API_URL = "https://api.coingecko.com/api/v3";

// Map Solana token addresses to CoinGecko IDs
// CoinGecko uses their own IDs, not contract addresses for main coins
const SOLANA_TOKEN_TO_COINGECKO_ID: Record<string, string> = {
  // Native SOL (wrapped)
  "So11111111111111111111111111111111111111112": "solana",
  // USDC
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "usd-coin",
  // USDT
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "tether",
  // Raydium
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": "raydium",
  // Bonk
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": "bonk",
  // Jupiter
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN": "jupiter-exchange-solana",
  // Marinade staked SOL
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So": "msol",
  // Jito staked SOL
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn": "jito-staked-sol",
  // Pyth Network
  "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3": "pyth-network",
  // Render
  "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof": "render-token",
  // Wormhole
  "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ": "wormhole",
  // Helium
  "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux": "helium",
  // Dogwifhat
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm": "dogwifcoin",
  // Popcat
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr": "popcat",
  // Ethereum (wormhole wrapped)
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": "ethereum",
};

export interface CoinGeckoSupplyData {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
  circulating_supply: number | null;
  total_supply: number | null;
  max_supply: number | null;
  price_change_percentage_24h: number;
}

class CoinGeckoService {
  private cache: Map<string, { data: CoinGeckoSupplyData; timestamp: number }> = new Map();
  private CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

  /**
   * Get CoinGecko ID from Solana token address
   */
  getCoinGeckoId(address: string): string | null {
    return SOLANA_TOKEN_TO_COINGECKO_ID[address] || null;
  }

  /**
   * Get supply data for a token by CoinGecko ID
   */
  async getSupplyData(coinId: string): Promise<CoinGeckoSupplyData | null> {
    // Check cache first
    const cached = this.cache.get(coinId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      const response = await fetch(
        `${COINGECKO_API_URL}/coins/markets?vs_currency=usd&ids=${coinId}&order=market_cap_desc&per_page=1&page=1&sparkline=false`,
        {
          headers: {
            accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        if (response.status === 429) {
          console.warn("CoinGecko rate limit hit");
        }
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json();
      if (!data || data.length === 0) {
        return null;
      }

      const coinData = data[0] as CoinGeckoSupplyData;

      // Cache the result
      this.cache.set(coinId, { data: coinData, timestamp: Date.now() });

      return coinData;
    } catch (error) {
      console.error("Error fetching CoinGecko supply data:", error);
      return null;
    }
  }

  /**
   * Get supply data for a Solana token by address
   */
  async getSupplyDataByAddress(address: string): Promise<{
    totalSupply: number | null;
    maxSupply: number | null;
    circulatingSupply: number | null;
  } | null> {
    const coinId = this.getCoinGeckoId(address);
    if (!coinId) {
      console.log(`No CoinGecko mapping for address: ${address}`);
      return null;
    }

    const data = await this.getSupplyData(coinId);
    if (!data) {
      return null;
    }

    return {
      totalSupply: data.total_supply,
      maxSupply: data.max_supply,
      circulatingSupply: data.circulating_supply,
    };
  }

  /**
   * Get full market data for multiple coins at once
   */
  async getMultipleCoinsData(coinIds: string[]): Promise<CoinGeckoSupplyData[]> {
    if (coinIds.length === 0) return [];

    try {
      const response = await fetch(
        `${COINGECKO_API_URL}/coins/markets?vs_currency=usd&ids=${coinIds.join(",")}&order=market_cap_desc&per_page=100&page=1&sparkline=false`,
        {
          headers: {
            accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json();

      // Cache each coin
      for (const coin of data) {
        this.cache.set(coin.id, { data: coin, timestamp: Date.now() });
      }

      return data;
    } catch (error) {
      console.error("Error fetching CoinGecko multiple coins data:", error);
      return [];
    }
  }
}

export const coinGeckoService = new CoinGeckoService();
