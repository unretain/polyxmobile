// Pump.fun API Service
// pump.fun is the main launchpad for Solana memecoins

const PUMPFUN_API_URL = "https://frontend-api.pump.fun";

export interface PumpFunCoin {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  image_uri: string;
  metadata_uri: string;
  twitter?: string;
  telegram?: string;
  bonding_curve: string;
  associated_bonding_curve: string;
  creator: string;
  created_timestamp: number;
  raydium_pool?: string;
  complete: boolean;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  total_supply: number;
  website?: string;
  show_name: boolean;
  king_of_the_hill_timestamp?: number;
  market_cap: number;
  reply_count: number;
  last_reply?: number;
  nsfw: boolean;
  market_id?: string;
  inverted?: boolean;
  usd_market_cap: number;
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
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  creator?: string;
  complete?: boolean;
  replyCount?: number;
}

class PumpFunService {
  // Get newest coins from pump.fun
  async getNewCoins(limit: number = 50, offset: number = 0): Promise<NewPairToken[]> {
    try {
      const response = await fetch(
        `${PUMPFUN_API_URL}/coins?offset=${offset}&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`,
        {
          headers: {
            accept: "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Pump.fun API error: ${response.status}`);
      }

      const coins: PumpFunCoin[] = await response.json();
      return coins.map((coin) => this.mapCoinToToken(coin));
    } catch (error) {
      console.error("Error fetching Pump.fun new coins:", error);
      return [];
    }
  }

  // Get king of the hill coins (trending/top)
  async getKingOfHillCoins(limit: number = 50): Promise<NewPairToken[]> {
    try {
      const response = await fetch(
        `${PUMPFUN_API_URL}/coins/king-of-the-hill?includeNsfw=false`,
        {
          headers: {
            accept: "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Pump.fun API error: ${response.status}`);
      }

      const coins: PumpFunCoin[] = await response.json();
      return coins.slice(0, limit).map((coin) => this.mapCoinToToken(coin));
    } catch (error) {
      console.error("Error fetching Pump.fun king of hill coins:", error);
      return [];
    }
  }

  // Get coins about to graduate (almost complete bonding curve)
  async getGraduatingCoins(limit: number = 50): Promise<NewPairToken[]> {
    try {
      const response = await fetch(
        `${PUMPFUN_API_URL}/coins?offset=0&limit=${limit}&sort=market_cap&order=DESC&includeNsfw=false`,
        {
          headers: {
            accept: "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Pump.fun API error: ${response.status}`);
      }

      const coins: PumpFunCoin[] = await response.json();

      // Filter coins that are close to graduating (high market cap but not complete)
      const graduatingCoins = coins.filter(
        (coin) => !coin.complete && coin.usd_market_cap > 10000
      );

      return graduatingCoins.map((coin) => this.mapCoinToToken(coin));
    } catch (error) {
      console.error("Error fetching Pump.fun graduating coins:", error);
      return [];
    }
  }

  // Get graduated coins (migrated to Raydium)
  async getGraduatedCoins(limit: number = 50): Promise<NewPairToken[]> {
    try {
      const response = await fetch(
        `${PUMPFUN_API_URL}/coins?offset=0&limit=${limit}&sort=market_cap&order=DESC&includeNsfw=false`,
        {
          headers: {
            accept: "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Pump.fun API error: ${response.status}`);
      }

      const coins: PumpFunCoin[] = await response.json();

      // Filter coins that have completed and have raydium pool
      const graduatedCoins = coins.filter(
        (coin) => coin.complete && coin.raydium_pool
      );

      return graduatedCoins.map((coin) => this.mapCoinToToken(coin));
    } catch (error) {
      console.error("Error fetching Pump.fun graduated coins:", error);
      return [];
    }
  }

  // Get specific coin data
  async getCoin(mintAddress: string): Promise<NewPairToken | null> {
    try {
      const response = await fetch(`${PUMPFUN_API_URL}/coins/${mintAddress}`, {
        headers: {
          accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!response.ok) {
        return null;
      }

      const coin: PumpFunCoin = await response.json();
      return this.mapCoinToToken(coin);
    } catch (error) {
      console.error("Error fetching Pump.fun coin:", error);
      return null;
    }
  }

  private mapCoinToToken(coin: PumpFunCoin): NewPairToken {
    // Calculate price from bonding curve reserves
    const price =
      coin.virtual_sol_reserves && coin.virtual_token_reserves
        ? (coin.virtual_sol_reserves / coin.virtual_token_reserves) * 150 // Approximate SOL price
        : 0;

    return {
      address: coin.mint,
      symbol: coin.symbol,
      name: coin.name,
      logoUri: coin.image_uri,
      price,
      priceChange24h: 0, // Pump.fun doesn't provide this directly
      volume24h: 0, // Would need to calculate from trades
      liquidity: (coin.virtual_sol_reserves / 1e9) * 150, // Convert lamports to USD
      marketCap: coin.usd_market_cap || coin.market_cap,
      txCount: coin.reply_count || 0,
      createdAt: coin.created_timestamp,
      source: coin.complete ? "pump.fun (graduated)" : "pump.fun",
      description: coin.description,
      twitter: coin.twitter,
      telegram: coin.telegram,
      website: coin.website,
      creator: coin.creator,
      complete: coin.complete,
      replyCount: coin.reply_count,
    };
  }
}

export const pumpFunService = new PumpFunService();
