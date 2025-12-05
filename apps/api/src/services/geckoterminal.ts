import type { OHLCV, Timeframe } from "@shared/types";

const GECKOTERMINAL_API_URL = "https://api.geckoterminal.com/api/v2";

interface GeckoTerminalPool {
  id: string;
  type: string;
  attributes: {
    address: string;
    name: string;
    base_token_price_usd: string;
    reserve_in_usd: string;
    volume_usd: {
      h24: string;
    };
    price_change_percentage: {
      h24: string;
    };
  };
  relationships: {
    base_token: {
      data: {
        id: string;
      };
    };
  };
}

interface GeckoTerminalOHLCVResponse {
  data: {
    attributes: {
      ohlcv_list: number[][];
    };
  };
}

interface GeckoTerminalPoolsResponse {
  data: GeckoTerminalPool[];
}

class GeckoTerminalService {
  private getHeaders() {
    return {
      accept: "application/json",
    };
  }

  // Get the main pool for a token (highest liquidity)
  async getMainPool(tokenAddress: string): Promise<string | null> {
    try {
      const response = await fetch(
        `${GECKOTERMINAL_API_URL}/networks/solana/tokens/${tokenAddress}/pools?page=1`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        console.error(`GeckoTerminal pools API error: ${response.status}`);
        return null;
      }

      const data: GeckoTerminalPoolsResponse = await response.json();
      if (!data.data || data.data.length === 0) {
        return null;
      }

      // Return the first pool (highest liquidity by default)
      return data.data[0].attributes.address;
    } catch (error) {
      console.error("Error fetching GeckoTerminal pool:", error);
      return null;
    }
  }

  // Get OHLCV data for a token
  async getOHLCV(
    tokenAddress: string,
    timeframe: Timeframe = "1h",
    limit: number = 100
  ): Promise<OHLCV[]> {
    try {
      // First get the main pool for this token
      const poolAddress = await this.getMainPool(tokenAddress);
      if (!poolAddress) {
        console.error(`No pool found for token ${tokenAddress}`);
        return [];
      }

      // Map timeframe to GeckoTerminal format
      const timeframeMap: Record<Timeframe, { type: string; aggregate: number }> = {
        "1m": { type: "minute", aggregate: 1 },
        "5m": { type: "minute", aggregate: 5 },
        "15m": { type: "minute", aggregate: 15 },
        "1h": { type: "hour", aggregate: 1 },
        "4h": { type: "hour", aggregate: 4 },
        "1d": { type: "day", aggregate: 1 },
        "1w": { type: "day", aggregate: 7 },
        "1M": { type: "day", aggregate: 30 },
      };

      const { type, aggregate } = timeframeMap[timeframe];

      const response = await fetch(
        `${GECKOTERMINAL_API_URL}/networks/solana/pools/${poolAddress}/ohlcv/${type}?aggregate=${aggregate}&limit=${limit}`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        console.error(`GeckoTerminal OHLCV API error: ${response.status}`);
        return [];
      }

      const data: GeckoTerminalOHLCVResponse = await response.json();
      if (!data.data?.attributes?.ohlcv_list) {
        return [];
      }

      // Convert GeckoTerminal format [timestamp, open, high, low, close, volume] to our format
      return data.data.attributes.ohlcv_list.map((item) => ({
        timestamp: item[0] * 1000, // Convert to milliseconds
        open: item[1],
        high: item[2],
        low: item[3],
        close: item[4],
        volume: item[5],
      }));
    } catch (error) {
      console.error("Error fetching GeckoTerminal OHLCV:", error);
      return [];
    }
  }
}

export const geckoTerminalService = new GeckoTerminalService();
