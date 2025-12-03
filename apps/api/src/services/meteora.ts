// Meteora DLMM API Service
// https://dlmm-api.meteora.ag/swagger-ui/
// Rate limit: 30 RPS

import { solPriceService } from "./solPrice";

const METEORA_API_URL = "https://dlmm-api.meteora.ag";

export interface MeteoraPair {
  address: string;
  name: string;
  mint_x: string;
  mint_y: string;
  reserve_x: string;
  reserve_y: string;
  reserve_x_amount: number;
  reserve_y_amount: number;
  bin_step: number;
  base_fee_percentage: string;
  max_fee_percentage: string;
  protocol_fee_percentage: string;
  liquidity: string;
  reward_mint_x: string;
  reward_mint_y: string;
  fees_24h: number;
  today_fees: number;
  trade_volume_24h: number;
  cumulative_trade_volume: string;
  cumulative_fee_volume: string;
  current_price: number;
  apr: number;
  apy: number;
  farm_apr: number;
  farm_apy: number;
  hide: boolean;
  created_at?: string;
}

export interface MeteoraNewPairToken {
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
  pairAddress: string;
  baseToken: string;
  quoteToken: string;
}

// Known token metadata cache
const TOKEN_METADATA_CACHE = new Map<string, { symbol: string; name: string; logoUri?: string }>();

// SOL mint address
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

class MeteoraService {
  private lastFetchTime = 0;
  private cachedPairs: MeteoraPair[] = [];
  private cacheExpiry = 10000; // 10 seconds

  // Get all DLMM pairs
  async getAllPairs(): Promise<MeteoraPair[]> {
    const now = Date.now();
    if (this.cachedPairs.length > 0 && now - this.lastFetchTime < this.cacheExpiry) {
      return this.cachedPairs;
    }

    try {
      const response = await fetch(`${METEORA_API_URL}/pair/all`, {
        headers: {
          accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Meteora API error: ${response.status}`);
      }

      const pairs: MeteoraPair[] = await response.json();
      this.cachedPairs = pairs;
      this.lastFetchTime = now;

      return pairs;
    } catch (error) {
      console.error("Error fetching Meteora pairs:", error);
      return this.cachedPairs; // Return cached data on error
    }
  }

  // Get newest pairs (sorted by creation time or volume)
  async getNewPairs(limit: number = 50): Promise<MeteoraNewPairToken[]> {
    try {
      const pairs = await this.getAllPairs();

      // Filter for pairs with SOL or USDC as quote token (most likely new memecoins)
      const memecoinPairs = pairs.filter(
        (pair) =>
          (pair.mint_y === SOL_MINT || pair.mint_y === USDC_MINT) &&
          !pair.hide &&
          pair.liquidity &&
          parseFloat(pair.liquidity) > 100 // Minimum liquidity
      );

      // Sort by trade volume (proxy for "newness" and activity)
      // In production, you'd want to track created_at timestamps
      const sortedPairs = memecoinPairs
        .sort((a, b) => b.trade_volume_24h - a.trade_volume_24h)
        .slice(0, limit);

      return sortedPairs.map((pair) => this.mapPairToToken(pair));
    } catch (error) {
      console.error("Error fetching Meteora new pairs:", error);
      return [];
    }
  }

  // Get pair by address
  async getPair(pairAddress: string): Promise<MeteoraPair | null> {
    try {
      const response = await fetch(`${METEORA_API_URL}/pair/${pairAddress}`, {
        headers: {
          accept: "application/json",
        },
      });

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error("Error fetching Meteora pair:", error);
      return null;
    }
  }

  // Get pairs with pagination (for scanning new ones)
  async getPairsWithPagination(
    page: number = 0,
    limit: number = 50,
    sortBy: string = "trade_volume_24h"
  ): Promise<MeteoraPair[]> {
    try {
      const response = await fetch(
        `${METEORA_API_URL}/pair/all_with_pagination?page=${page}&limit=${limit}&sort_key=${sortBy}&order_by=desc`,
        {
          headers: {
            accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Meteora API error: ${response.status}`);
      }

      const data = await response.json();
      return data.pairs || data;
    } catch (error) {
      console.error("Error fetching Meteora pairs with pagination:", error);
      return [];
    }
  }

  // Map Meteora pair to our token format
  private mapPairToToken(pair: MeteoraPair): MeteoraNewPairToken {
    // Parse the pair name to get token symbols
    const [symbolX, symbolY] = pair.name.split("-");

    // The base token (mint_x) is the memecoin, quote token (mint_y) is SOL/USDC
    const isQuoteSOL = pair.mint_y === SOL_MINT;

    // Get real SOL price from Jupiter API
    const solPrice = solPriceService.getPriceSync();

    // Calculate USD values
    const liquidityUsd = parseFloat(pair.liquidity) || 0;
    const volumeUsd = pair.trade_volume_24h || 0;

    // Price in USD
    let priceUsd = pair.current_price || 0;
    if (isQuoteSOL) {
      priceUsd = priceUsd * solPrice;
    }

    return {
      address: pair.mint_x,
      symbol: symbolX || "???",
      name: pair.name,
      logoUri: undefined, // Meteora API doesn't provide logos
      price: priceUsd,
      priceChange24h: 0, // Not provided by Meteora
      volume24h: volumeUsd,
      liquidity: liquidityUsd,
      marketCap: 0, // Would need to calculate from supply
      txCount: 0,
      createdAt: pair.created_at ? new Date(pair.created_at).getTime() : Date.now(),
      source: "meteora",
      pairAddress: pair.address,
      baseToken: pair.mint_x,
      quoteToken: pair.mint_y,
    };
  }

  // Poll for new pairs (call this periodically)
  async pollNewPairs(
    onNewPair: (pair: MeteoraNewPairToken) => void,
    intervalMs: number = 5000
  ): Promise<() => void> {
    const knownPairs = new Set<string>();

    // Initialize with current pairs
    const initialPairs = await this.getAllPairs();
    initialPairs.forEach((p) => knownPairs.add(p.address));

    const interval = setInterval(async () => {
      try {
        const pairs = await this.getAllPairs();

        for (const pair of pairs) {
          if (!knownPairs.has(pair.address)) {
            knownPairs.add(pair.address);
            const token = this.mapPairToToken(pair);
            onNewPair(token);
          }
        }
      } catch (error) {
        console.error("Error polling Meteora pairs:", error);
      }
    }, intervalMs);

    // Return cleanup function
    return () => clearInterval(interval);
  }
}

export const meteoraService = new MeteoraService();
