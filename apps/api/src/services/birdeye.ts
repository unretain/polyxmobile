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
      console.warn("BIRDEYE_API_KEY not configured");
      return null;
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

  // Get OHLCV data with automatic chunked fetching for large time ranges
  // Birdeye API returns limited candles per request, so we chunk requests
  async getOHLCV(
    address: string,
    timeframe: Timeframe = "1h",
    options?: { from?: number; to?: number; limit?: number }
  ): Promise<OHLCV[]> {
    if (!this.apiKey) {
      console.warn("BIRDEYE_API_KEY not configured - returning empty OHLCV");
      return [];
    }

    try {
      // Convert timeframe to Birdeye format
      const typeMap: Record<Timeframe, string> = {
        "1m": "1m",
        "5m": "5m",
        "15m": "15m",
        "1h": "1H",
        "4h": "4H",
        "1d": "1D",
        "1w": "1D",
        "1M": "1D",
      };

      const to = options?.to ?? Math.floor(Date.now() / 1000);
      const limit = options?.limit ?? 100;
      const from = options?.from ?? (to - this.getTimeframeSeconds(timeframe) * limit);

      // Birdeye typically returns ~1000 candles max per request
      // Calculate how many candles we need based on the time range
      const timeframeSeconds = this.getTimeframeSeconds(timeframe);
      const totalSecondsRequested = to - from;
      const estimatedCandlesNeeded = Math.ceil(totalSecondsRequested / timeframeSeconds);

      // If we need more than ~500 candles, use chunked fetching
      // Birdeye seems to limit around 1000 per request, but we'll be conservative
      const CHUNK_SIZE_CANDLES = 500;
      const CHUNK_SIZE_SECONDS = CHUNK_SIZE_CANDLES * timeframeSeconds;

      let allCandles: OHLCV[] = [];

      if (estimatedCandlesNeeded <= CHUNK_SIZE_CANDLES) {
        // Small request - single fetch
        allCandles = await this.fetchOHLCVChunk(address, typeMap[timeframe], from, to);
      } else {
        // Large request - chunked fetching from oldest to newest
        console.log(`📊 Birdeye chunked fetch: ${address.substring(0, 8)}... ${timeframe} needs ~${estimatedCandlesNeeded} candles, using chunks`);

        let currentFrom = from;
        let chunkCount = 0;
        const maxChunks = 20; // Safety limit to prevent infinite loops

        while (currentFrom < to && chunkCount < maxChunks) {
          const currentTo = Math.min(currentFrom + CHUNK_SIZE_SECONDS, to);

          try {
            const chunk = await this.fetchOHLCVChunk(address, typeMap[timeframe], currentFrom, currentTo);

            if (chunk.length === 0) {
              // No data in this chunk, move forward
              currentFrom = currentTo;
              chunkCount++;
              continue;
            }

            allCandles.push(...chunk);

            // Move to next chunk (use last candle timestamp + 1 interval to avoid duplicates)
            const lastTimestamp = chunk[chunk.length - 1].timestamp / 1000; // Convert back to seconds
            currentFrom = Math.max(currentTo, lastTimestamp + timeframeSeconds);
            chunkCount++;

            // Small delay to be nice to the API
            if (chunkCount < maxChunks && currentFrom < to) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } catch (chunkError) {
            console.warn(`Chunk ${chunkCount} failed, continuing...`, chunkError);
            currentFrom = currentTo;
            chunkCount++;
          }
        }

        console.log(`📊 Birdeye chunked fetch complete: ${chunkCount} chunks, ${allCandles.length} total candles`);
      }

      // Deduplicate by timestamp
      const uniqueByTimestamp = new Map<number, OHLCV>();
      for (const candle of allCandles) {
        uniqueByTimestamp.set(candle.timestamp, candle);
      }
      let sorted = Array.from(uniqueByTimestamp.values()).sort((a, b) => a.timestamp - b.timestamp);

      // Filter out extreme price outliers
      if (sorted.length > 5) {
        const closePrices = sorted.map((c: OHLCV) => c.close).sort((a: number, b: number) => a - b);
        const medianPrice = closePrices[Math.floor(closePrices.length / 2)];
        const maxReasonablePrice = medianPrice * 100;
        const minReasonablePrice = medianPrice / 100;

        const beforeFilter = sorted.length;
        sorted = sorted.filter((candle: OHLCV) =>
          candle.high <= maxReasonablePrice &&
          candle.low >= minReasonablePrice
        );

        if (sorted.length < beforeFilter) {
          console.log(`⚠️ Filtered ${beforeFilter - sorted.length} outlier candles`);
        }
      }

      console.log(`📊 Birdeye OHLCV: ${address.substring(0, 8)}... ${timeframe} - ${sorted.length} valid candles`);

      return sorted;
    } catch (error) {
      console.error("Error fetching Birdeye OHLCV:", error);
      throw error;
    }
  }

  // Fetch a single chunk of OHLCV data
  private async fetchOHLCVChunk(
    address: string,
    birdeyeType: string,
    from: number,
    to: number
  ): Promise<OHLCV[]> {
    const response = await fetch(
      `${BIRDEYE_API_URL}/defi/ohlcv?address=${address}&type=${birdeyeType}&time_from=${from}&time_to=${to}`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      throw new Error(`Birdeye OHLCV API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.success || !data.data?.items) {
      return [];
    }

    // Map and validate candles
    return data.data.items
      .map((item: BirdeyeOHLCVData) => ({
        timestamp: item.unixTime * 1000,
        open: item.o,
        high: item.h,
        low: item.l,
        close: item.c,
        volume: item.v || 0,
      }))
      .filter((candle: OHLCV) => {
        const isValid =
          candle.timestamp > 0 &&
          isFinite(candle.open) && candle.open > 0 &&
          isFinite(candle.high) && candle.high > 0 &&
          isFinite(candle.low) && candle.low > 0 &&
          isFinite(candle.close) && candle.close > 0 &&
          candle.high >= candle.low &&
          candle.high >= candle.open && candle.high >= candle.close &&
          candle.low <= candle.open && candle.low <= candle.close;
        return isValid;
      });
  }

  // Get price for multiple tokens
  async getMultiplePrices(addresses: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    if (!this.apiKey) {
      console.warn("BIRDEYE_API_KEY not configured");
      return prices;
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
      console.warn("BIRDEYE_API_KEY not configured - returning empty token list");
      return [];
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
