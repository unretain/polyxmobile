import type { OHLCV, Timeframe, BirdeyeTokenData, BirdeyeOHLCVData } from "@shared/types";

const BIRDEYE_API_URL = "https://public-api.birdeye.so";

class BirdeyeService {
  private get apiKey(): string {
    return process.env.BIRDEYE_API_KEY || "";
  }

  private getHeaders() {
    return {
      "X-API-KEY": this.apiKey,
      "x-chain": "solana",
      "accept": "application/json",
    };
  }

  // Get token market data
  async getTokenData(address: string): Promise<BirdeyeTokenData | null> {
    if (!this.apiKey) {
      throw new Error("BIRDEYE_API_KEY not configured");
    }

    try {
      const response = await fetch(
        `${BIRDEYE_API_URL}/defi/token_overview?address=${address}`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Birdeye API error: ${response.status}`);
      }

      const data = await response.json();
      if (!data.success) {
        return null;
      }

      const tokenData = data.data;

      return {
        address: tokenData.address,
        decimals: tokenData.decimals,
        symbol: tokenData.symbol,
        name: tokenData.name,
        logoURI: tokenData.logoURI,
        liquidity: tokenData.liquidity,
        price: tokenData.price,
        priceChange24h: tokenData.priceChange24hPercent,
        volume24h: tokenData.volume24h,
        // Birdeye uses 'mc' for market cap - fallback to other possible field names
        marketCap: tokenData.mc || tokenData.marketCap || tokenData.realMc,
      };
    } catch (error) {
      console.error("Error fetching Birdeye token data:", error);
      throw error;
    }
  }

  // Get OHLCV data
  async getOHLCV(
    address: string,
    timeframe: Timeframe = "1h",
    options?: { from?: number; to?: number; limit?: number }
  ): Promise<OHLCV[]> {
    if (!this.apiKey) {
      throw new Error("BIRDEYE_API_KEY not configured");
    }

    try {
      // Convert timeframe to Birdeye format
      // Note: Birdeye doesn't support 1w/1M directly - we aggregate from 1d in the route
      const typeMap: Record<Timeframe, string> = {
        "1m": "1m",
        "5m": "5m",
        "15m": "15m",
        "1h": "1H",
        "4h": "4H",
        "1d": "1D",
        "1w": "1D", // Fallback to daily (aggregation handled elsewhere)
        "1M": "1D", // Fallback to daily (aggregation handled elsewhere)
      };

      // Use provided from/to or calculate from limit
      const to = options?.to ?? Math.floor(Date.now() / 1000);
      const limit = options?.limit ?? 100;
      const from = options?.from ?? (to - this.getTimeframeSeconds(timeframe) * limit);

      const response = await fetch(
        `${BIRDEYE_API_URL}/defi/ohlcv?address=${address}&type=${typeMap[timeframe]}&time_from=${from}&time_to=${to}`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Birdeye OHLCV API error: ${response.status}`);
      }

      const data = await response.json();
      if (!data.success || !data.data?.items) {
        throw new Error("No OHLCV data returned from Birdeye");
      }

      // Map, validate, and sort by timestamp to ensure chronological order
      // Filter out invalid data points (null, NaN, 0 prices, etc.)
      const ohlcv = data.data.items
        .map((item: BirdeyeOHLCVData) => ({
          timestamp: item.unixTime * 1000,
          open: item.o,
          high: item.h,
          low: item.l,
          close: item.c,
          volume: item.v || 0,
        }))
        .filter((candle: OHLCV) => {
          // Filter out invalid candles
          const isValid =
            candle.timestamp > 0 &&
            isFinite(candle.open) && candle.open > 0 &&
            isFinite(candle.high) && candle.high > 0 &&
            isFinite(candle.low) && candle.low > 0 &&
            isFinite(candle.close) && candle.close > 0 &&
            candle.high >= candle.low && // High must be >= Low
            candle.high >= candle.open && candle.high >= candle.close && // High must be highest
            candle.low <= candle.open && candle.low <= candle.close; // Low must be lowest
          return isValid;
        });

      // Sort by timestamp ascending (oldest first, newest last)
      const sorted = ohlcv.sort((a: OHLCV, b: OHLCV) => a.timestamp - b.timestamp);

      console.log(`📊 Birdeye OHLCV: ${address} ${timeframe} - ${data.data.items.length} raw, ${sorted.length} valid candles`);

      return sorted;
    } catch (error) {
      console.error("Error fetching Birdeye OHLCV:", error);
      throw error;
    }
  }

  // Get price for multiple tokens
  async getMultiplePrices(addresses: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    if (!this.apiKey) {
      throw new Error("BIRDEYE_API_KEY not configured");
    }

    if (addresses.length === 0) {
      return prices;
    }

    try {
      const response = await fetch(
        `${BIRDEYE_API_URL}/defi/multi_price?list_address=${addresses.join(",")}`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Birdeye multi-price API error: ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.data) {
        for (const [address, info] of Object.entries(data.data)) {
          const priceInfo = info as { value: number };
          prices.set(address, priceInfo.value);
        }
      }
    } catch (error) {
      console.error("Error fetching Birdeye multi-price:", error);
      throw error;
    }

    return prices;
  }

  // Get trending tokens - using the correct endpoint
  async getTopTokens(limit: number = 20): Promise<BirdeyeTokenData[]> {
    if (!this.apiKey) {
      throw new Error("BIRDEYE_API_KEY not configured");
    }

    try {
      // Use token_trending endpoint which is available on free tier
      // Max limit is 20 for this endpoint
      const actualLimit = Math.min(limit, 20);
      const response = await fetch(
        `${BIRDEYE_API_URL}/defi/token_trending?sort_by=volume24hUSD&sort_type=desc&offset=0&limit=${actualLimit}`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Birdeye API response:", errorText);
        throw new Error(`Birdeye token_trending API error: ${response.status}`);
      }

      const data = await response.json();
      if (!data.success || !data.data?.tokens) {
        throw new Error("No token list returned from Birdeye");
      }

      // Map token data from trending endpoint
      const tokens: BirdeyeTokenData[] = data.data.tokens.map((token: any) => ({
        address: token.address,
        decimals: token.decimals || 9,
        symbol: token.symbol,
        name: token.name,
        logoURI: token.logoURI,
        liquidity: token.liquidity || 0,
        price: token.price || 0,
        priceChange24h: token.priceChange24hPercent || 0,
        volume24h: token.volume24hUSD || 0,
        marketCap: token.mc || 0,
      }));

      return tokens;
    } catch (error) {
      console.error("Error fetching Birdeye trending tokens:", error);
      throw error;
    }
  }

  private getTimeframeSeconds(timeframe: Timeframe): number {
    const map: Record<Timeframe, number> = {
      "1m": 60,
      "5m": 300,
      "15m": 900,
      "1h": 3600,
      "4h": 14400,
      "1d": 86400,
      "1w": 604800, // 7 days
      "1M": 2592000, // 30 days
    };
    return map[timeframe];
  }
}

export const birdeyeService = new BirdeyeService();
