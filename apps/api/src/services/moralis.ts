// Moralis Solana API Service
// https://docs.moralis.com/web3-data-api/solana
// Pump.fun specific endpoints: https://docs.moralis.com/web3-data-api/solana/pump-fun-tutorials

import type { OHLCV, BirdeyeTokenData } from "@shared/types";

const MORALIS_API_URL = "https://solana-gateway.moralis.io";

// Moralis timeframe options for OHLCV
// Note: Moralis uses different format than Birdeye (1min not 1m)
type MoralisTimeframe = "1s" | "10s" | "30s" | "1min" | "5min" | "10min" | "30min" | "1h" | "4h" | "12h" | "1d" | "1w" | "1M";

// Pump.fun token from Moralis new/bonding/graduated endpoints
interface MoralisPumpFunToken {
  tokenAddress: string;
  name: string;
  symbol: string;
  logo?: string;
  decimals: number | string;
  priceUsd?: string;  // API returns string
  priceNative?: string;
  liquidity?: string;  // API returns string
  fullyDilutedValuation?: string;  // API returns string
  createdAt?: string;  // ISO date string
  graduatedAt?: string;  // ISO date string
  pairAddress?: string;
  // Bonding endpoint returns progress as percentage (0-100)
  bondingCurveProgress?: number;
}

// Swap event from Moralis - actual API response structure
interface MoralisSwapToken {
  address: string;
  name: string;
  symbol: string;
  logo?: string | null;
  amount: string;
  usdPrice: number;
  usdAmount: number;
  tokenType: string;  // "token0" or "token1"
}

interface MoralisSwap {
  transactionHash: string;
  transactionType: "buy" | "sell";  // Direct buy/sell indicator
  transactionIndex: number;
  subCategory?: string;  // "buyAll", "sellAll", etc.
  blockTimestamp: string;
  blockNumber: number;
  walletAddress: string;
  pairAddress: string;
  pairLabel: string;
  exchangeAddress: string;
  exchangeName: string;
  exchangeLogo?: string;
  baseToken: string;
  quoteToken: string;
  bought: MoralisSwapToken;  // What the wallet received
  sold: MoralisSwapToken;    // What the wallet paid
  baseQuotePrice: string;
  totalValueUsd: number;
}

interface MoralisTokenPrice {
  tokenAddress: string;
  usdPrice: number;
  usdPriceFormatted: string;
  exchangeName: string;
  exchangeAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenLogo?: string;
  tokenDecimals: number;
  nativePrice?: {
    value: string;
    decimals: number;
    name: string;
    symbol: string;
  };
  "24hrPercentChange"?: string;
}

// Token metadata from Moralis (includes CDN-hosted logo)
interface MoralisTokenMetadata {
  mint: string;
  standard: string;
  name: string;
  symbol: string;
  logo?: string;  // CDN-hosted logo URL like https://d23exngyjlavgo.cloudfront.net/...
  decimals: string;
  metaplex?: {
    metadataUri?: string;
    masterEdition?: boolean;
    isMutable?: boolean;
  };
  fullyDilutedValue?: string;
  totalSupply?: string;
  totalSupplyFormatted?: string;
}

interface MoralisOHLCVItem {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Holder stats from Moralis
interface MoralisHolderStats {
  totalHolders: number;
  holderChange: {
    "5min"?: number;
    "1h"?: number;
    "6h"?: number;
    "24h"?: number;
    "7d"?: number;
    "30d"?: number;
  };
  holdersByAcquisition?: {
    swap?: number;
    transfer?: number;
    airdrop?: number;
  };
  holderDistribution?: {
    whales?: number;
    sharks?: number;
    dolphins?: number;
    fish?: number;
    octopus?: number;
    crabs?: number;
    shrimps?: number;
  };
}

// Top holder from Moralis - actual API response structure
interface MoralisTopHolder {
  ownerAddress: string;
  balance: string;
  balanceFormatted: string;
  percentageRelativeToTotalSupply: number;  // Actual field name from Moralis
  usdValue?: string;  // Returned as string
  isContract?: boolean;
}

// Token analytics/stats from Moralis
interface MoralisTokenStats {
  totalBuyers24h?: number;
  totalSellers24h?: number;
  netBuyers24h?: number;
  volume24hUsd?: number;
  buyVolume24hUsd?: number;
  sellVolume24hUsd?: number;
  trades24h?: number;
  buyTrades24h?: number;
  sellTrades24h?: number;
}

interface MoralisPairData {
  exchangeAddress: string;
  exchangeName: string;  // "Pump.Fun", "PumpSwap", "Raydium"
  exchangeLogo?: string;
  pairAddress: string;
  pairLabel: string;
  usdPrice: number;
  usdPrice24hrPercentChange?: number;
  usdPrice24hrUsdChange?: number;
  volume24hrNative?: number;
  volume24hrUsd?: number;
  liquidityUsd?: number;
  baseToken: string;
  quoteToken: string;
  inactivePair?: boolean;  // Pump.Fun pairs become inactive after graduation
  volume24h?: number;  // Legacy field for compatibility
  pair?: Array<{
    tokenAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenLogo?: string;
    tokenDecimals: string;
    pairTokenType: string;
    liquidityUsd?: number;
  }>;
}

class MoralisService {
  // Image cache - maps token address to logo URL
  private imageCache: Map<string, string | null> = new Map();
  private imageFetchQueue: Map<string, Promise<string | null>> = new Map();

  private get apiKey(): string {
    return process.env.MORALIS_API_KEY || "";
  }

  private getHeaders() {
    return {
      "Accept": "application/json",
      "X-API-Key": this.apiKey,
    };
  }

  // Get token metadata (includes CDN-hosted logo)
  async getTokenMetadata(address: string): Promise<MoralisTokenMetadata | null> {
    if (!this.apiKey) {
      return null;
    }

    try {
      const response = await fetch(
        `${MORALIS_API_URL}/token/mainnet/${address}/metadata`,
        {
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(5000),
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      // Cache the logo URL
      if (data.logo) {
        this.imageCache.set(address, data.logo);
      }

      return data;
    } catch (error) {
      return null;
    }
  }

  // Get token logo URL (with caching)
  async getTokenLogo(address: string): Promise<string | null> {
    // Check cache first
    if (this.imageCache.has(address)) {
      return this.imageCache.get(address) || null;
    }

    // Check if already fetching
    if (this.imageFetchQueue.has(address)) {
      return this.imageFetchQueue.get(address) || null;
    }

    // Fetch metadata to get logo
    const fetchPromise = (async () => {
      const metadata = await this.getTokenMetadata(address);
      const logo = metadata?.logo || null;
      this.imageCache.set(address, logo);
      return logo;
    })();

    this.imageFetchQueue.set(address, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      this.imageFetchQueue.delete(address);
    }
  }

  // Get cached logo URL (synchronous - returns undefined if not cached)
  getCachedLogo(address: string): string | undefined {
    return this.imageCache.get(address) || undefined;
  }

  // Prefetch logo for a token (fire and forget)
  prefetchLogo(address: string): void {
    if (!this.imageCache.has(address) && !this.imageFetchQueue.has(address)) {
      this.getTokenLogo(address).catch(() => {});
    }
  }

  // Get token price by address
  async getTokenPrice(address: string): Promise<MoralisTokenPrice | null> {
    if (!this.apiKey) {
      console.warn("MORALIS_API_KEY not configured");
      return null;
    }

    try {
      const response = await fetch(
        `${MORALIS_API_URL}/token/mainnet/${address}/price`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Moralis API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error fetching Moralis token price:", error);
      return null;
    }
  }

  // Get token metadata and price (formatted like BirdeyeTokenData for compatibility)
  async getTokenData(address: string): Promise<BirdeyeTokenData | null> {
    if (!this.apiKey) {
      console.warn("MORALIS_API_KEY not configured");
      return null;
    }

    try {
      // Fetch price and metadata in parallel for efficiency
      const [priceData, metadata, pairData] = await Promise.all([
        this.getTokenPrice(address),
        this.getTokenMetadata(address),
        this.getTokenPairs(address),
      ]);

      if (!priceData && !metadata) return null;

      const mainPair = pairData?.[0];

      // Prefer metadata logo (from CDN) over price endpoint logo
      const logoUrl = metadata?.logo || priceData?.tokenLogo || this.getCachedLogo(address);

      return {
        address: priceData?.tokenAddress || metadata?.mint || address,
        decimals: priceData?.tokenDecimals || parseInt(metadata?.decimals || "9"),
        symbol: priceData?.tokenSymbol || metadata?.symbol || "???",
        name: priceData?.tokenName || metadata?.name || "Unknown",
        logoURI: logoUrl,
        liquidity: mainPair?.liquidityUsd || 0,
        price: priceData?.usdPrice || 0,
        priceChange24h: parseFloat(priceData?.["24hrPercentChange"] || "0"),
        volume24h: mainPair?.volume24h || 0,
        marketCap: parseFloat(metadata?.fullyDilutedValue || "0"),
      };
    } catch (error) {
      console.error("Error fetching Moralis token data:", error);
      return null;
    }
  }

  // Get token pairs (for finding pair address needed for OHLCV)
  async getTokenPairs(address: string): Promise<MoralisPairData[] | null> {
    if (!this.apiKey) {
      console.warn("MORALIS_API_KEY not configured");
      return null;
    }

    try {
      const response = await fetch(
        `${MORALIS_API_URL}/token/mainnet/${address}/pairs`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Moralis pairs API error: ${response.status}`);
      }

      const data = await response.json();
      return data.pairs || [];
    } catch (error) {
      console.error("Error fetching Moralis token pairs:", error);
      return null;
    }
  }

  // Get OHLCV data by pair address (with pagination for more historical data)
  // Note: fromDate and toDate are REQUIRED by Moralis API (epoch seconds)
  async getOHLCVByPair(
    pairAddress: string,
    timeframe: MoralisTimeframe = "1min",
    options?: { fromDate?: number; toDate?: number; limit?: number; maxCandles?: number }
  ): Promise<OHLCV[]> {
    if (!this.apiKey) {
      throw new Error("MORALIS_API_KEY not configured");
    }

    try {
      // Default to last hour if no dates provided
      const now = Math.floor(Date.now() / 1000);
      const fromDate = options?.fromDate ?? (now - 3600);
      const toDate = options?.toDate ?? now;
      const maxCandles = options?.maxCandles ?? 1000;

      // Fetch with pagination to get more historical data
      let allItems: MoralisOHLCVItem[] = [];
      let cursor: string | undefined;
      const maxPages = 10; // Limit pagination to prevent API abuse

      for (let page = 0; page < maxPages; page++) {
        const params = new URLSearchParams({
          timeframe,
          fromDate: String(fromDate),
          toDate: String(toDate),
        });

        if (cursor) {
          params.append("cursor", cursor);
        }

        const response = await fetch(
          `${MORALIS_API_URL}/token/mainnet/pairs/${pairAddress}/ohlcv?${params}`,
          { headers: this.getHeaders() }
        );

        if (!response.ok) {
          throw new Error(`Moralis OHLCV API error: ${response.status}`);
        }

        const data = await response.json();
        const items: MoralisOHLCVItem[] = data.result || [];
        allItems = allItems.concat(items);

        // Check for pagination cursor
        cursor = data.cursor;
        if (!cursor || items.length === 0 || allItems.length >= maxCandles) break;
      }

      // Sort by timestamp ascending (oldest first) for charting
      return allItems
        .map((item) => ({
          timestamp: new Date(item.timestamp).getTime(),
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
          volume: item.volume,
        }))
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-maxCandles);
    } catch (error) {
      console.error("Error fetching Moralis OHLCV:", error);
      throw error;
    }
  }

  // Get OHLCV data by token address (finds active pair automatically)
  async getOHLCV(
    tokenAddress: string,
    timeframe: MoralisTimeframe = "1min",
    options?: { fromDate?: number; toDate?: number; limit?: number }
  ): Promise<OHLCV[]> {
    if (!this.apiKey) {
      throw new Error("MORALIS_API_KEY not configured");
    }

    try {
      // First get the token pairs to find the active pair address
      const pairs = await this.getTokenPairs(tokenAddress);
      if (!pairs || pairs.length === 0) {
        throw new Error("No trading pairs found for token");
      }

      // Prefer active pair (PumpSwap for graduated tokens) over inactive (original Pump.Fun)
      // Inactive pairs are from before migration and won't have new data
      const activePair = pairs.find((p) => !p.inactivePair) || pairs[0];
      const pairAddress = activePair.pairAddress;

      console.log(`📊 Using ${activePair.exchangeName} pair ${pairAddress} for OHLCV (inactive: ${activePair.inactivePair || false})`);

      return await this.getOHLCVByPair(pairAddress, timeframe, options);
    } catch (error) {
      console.error("Error fetching Moralis OHLCV by token:", error);
      throw error;
    }
  }

  // Get new pump.fun token listings
  async getNewTokens(limit: number = 50): Promise<MoralisPumpFunToken[]> {
    if (!this.apiKey) {
      console.warn("MORALIS_API_KEY not configured");
      return [];
    }

    try {
      const response = await fetch(
        `${MORALIS_API_URL}/token/mainnet/exchange/pumpfun/new?limit=${limit}`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Moralis new tokens API error: ${response.status}`);
      }

      const data = await response.json();
      return data.result || [];
    } catch (error) {
      console.error("Error fetching Moralis new tokens:", error);
      return [];
    }
  }

  // Get pump.fun tokens in bonding phase (not yet graduated)
  // Sort by bondingCurveProgress to get tokens closest to graduation
  // This naturally filters out stale tokens that have low/stuck progress
  async getBondingTokens(limit: number = 50): Promise<MoralisPumpFunToken[]> {
    if (!this.apiKey) {
      console.warn("MORALIS_API_KEY not configured");
      return [];
    }

    try {
      // Sort by bondingCurveProgress descending to get tokens closest to graduation
      // Stale old tokens typically have low/stuck progress (like 50-80%) and won't appear
      // in top results - only actively trading tokens reach 90%+ progress
      const response = await fetch(
        `${MORALIS_API_URL}/token/mainnet/exchange/pumpfun/bonding?limit=${limit}&sort=bondingCurveProgress&order=desc`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`Moralis bonding tokens error body: ${errorBody}`);
        throw new Error(`Moralis bonding tokens API error: ${response.status}`);
      }

      const data = await response.json();
      return data.result || [];
    } catch (error) {
      console.error("Error fetching Moralis bonding tokens:", error);
      return [];
    }
  }

  // Get graduated pump.fun tokens (completed bonding)
  async getGraduatedTokens(limit: number = 50): Promise<MoralisPumpFunToken[]> {
    if (!this.apiKey) {
      console.warn("MORALIS_API_KEY not configured");
      return [];
    }

    try {
      const response = await fetch(
        `${MORALIS_API_URL}/token/mainnet/exchange/pumpfun/graduated?limit=${limit}`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Moralis graduated tokens API error: ${response.status}`);
      }

      const data = await response.json();
      const tokens = data.result || [];

      // Log first few tokens to debug
      console.log(`[Moralis] getGraduatedTokens: Got ${tokens.length} tokens`);
      if (tokens.length > 0) {
        console.log(`[Moralis] Sample graduated token:`, JSON.stringify(tokens[0], null, 2));
      }

      return tokens;
    } catch (error) {
      console.error("Error fetching Moralis graduated tokens:", error);
      return [];
    }
  }

  // Get bonding status for a specific token
  async getBondingStatus(address: string): Promise<{ complete: boolean; progress: number } | null> {
    if (!this.apiKey) {
      console.warn("MORALIS_API_KEY not configured");
      return null;
    }

    try {
      const response = await fetch(
        `${MORALIS_API_URL}/token/mainnet/${address}/bonding-status`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Moralis bonding status API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error fetching Moralis bonding status:", error);
      return null;
    }
  }

  // Get token swaps (trade history)
  async getTokenSwaps(
    address: string,
    options?: { order?: "ASC" | "DESC"; limit?: number; cursor?: string }
  ): Promise<{ swaps: MoralisSwap[]; cursor?: string }> {
    if (!this.apiKey) {
      console.warn("MORALIS_API_KEY not configured");
      return { swaps: [] };
    }

    try {
      const params = new URLSearchParams({
        order: options?.order || "DESC",
        ...(options?.limit && { limit: String(options.limit) }),
        ...(options?.cursor && { cursor: options.cursor }),
      });

      const url = `${MORALIS_API_URL}/token/mainnet/${address}/swaps?${params}`;
      const response = await fetch(url, { headers: this.getHeaders() });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Moralis] Swaps API error ${response.status}: ${errorText}`);
        throw new Error(`Moralis swaps API error: ${response.status}`);
      }

      const data = await response.json();
      const swaps = data.result || [];

      // Log when fetching first page
      if (!options?.cursor) {
        console.log(`[Moralis] getTokenSwaps: First page got ${swaps.length} swaps, cursor: ${data.cursor ? 'yes' : 'no'}`);
      }

      return {
        swaps,
        cursor: data.cursor,
      };
    } catch (error) {
      console.error("Error fetching Moralis token swaps:", error);
      return { swaps: [] };
    }
  }

  // Build OHLCV candles from swap history (for tokens without pair OHLCV)
  // When perTrade=true, creates one candle per trade (like pump.fun's 1s chart)
  async getOHLCVFromSwaps(
    address: string,
    intervalMs: number = 60000,  // 1 minute default
    maxCandles: number = 1000,
    perTrade: boolean = false  // When true, creates one candle per swap (pump.fun style)
  ): Promise<OHLCV[]> {
    if (!this.apiKey) {
      return [];
    }

    try {
      // Fetch ALL swaps with pagination to get complete history
      // For per-trade mode, we need ALL trades from token creation to show the full chart
      // like pump.fun does (they show the entire trade history from $4K MC to current)
      let allSwaps: MoralisSwap[] = [];
      let cursor: string | undefined;
      // Increase max pages significantly to get full history
      // Calculate max pages based on desired candles: maxCandles / 100 swaps per page
      // Add buffer pages since not all swaps may have valid data
      const maxPages = Math.min(100, Math.ceil((maxCandles * 1.5) / 100));

      console.log(`📊 [getOHLCVFromSwaps] Fetching up to ${maxPages} pages for ${address} (maxCandles: ${maxCandles}, perTrade: ${perTrade})`);

      for (let page = 0; page < maxPages; page++) {
        const { swaps, cursor: nextCursor } = await this.getTokenSwaps(address, {
          order: "DESC",
          limit: 100,
          cursor
        });

        allSwaps = allSwaps.concat(swaps);
        cursor = nextCursor;

        // Stop only when no more pages available
        // We want to fetch as much as possible up to maxPages
        if (!cursor || swaps.length < 100) {
          console.log(`📊 [getOHLCVFromSwaps] Stopping at page ${page + 1} - no more data (cursor: ${!!cursor}, swaps: ${swaps.length})`);
          break;
        }
      }
      console.log(`📊 [getOHLCVFromSwaps] Fetched ${allSwaps.length} total swaps`);

      // Sort swaps by timestamp ASC (oldest first) for correct open/close calculation
      // API returns DESC (newest first), but we need oldest first so:
      // - First swap in candle = OPEN (earliest price)
      // - Last swap in candle = CLOSE (latest price)
      const swaps = allSwaps.sort((a, b) =>
        new Date(a.blockTimestamp).getTime() - new Date(b.blockTimestamp).getTime()
      );
      console.log(`📊 Fetched ${swaps.length} swaps for OHLCV building (perTrade: ${perTrade})`);

      if (swaps.length === 0) {
        return [];
      }

      // Helper to extract price from a swap
      // For per-trade candles, we need to calculate price from the ACTUAL exchange ratio
      const getPriceAndVolume = (swap: MoralisSwap): { price: number; volume: number } => {
        let price = 0;
        const addressLower = address.toLowerCase();
        const boughtIsToken = swap.bought?.address?.toLowerCase() === addressLower;
        const soldIsToken = swap.sold?.address?.toLowerCase() === addressLower;

        // SOL address for reference (canonical Wrapped SOL address)
        const SOL_ADDRESSES = [
          "so11111111111111111111111111111111111111112",
        ];

        // Check if address is SOL
        const isSolAddress = (addr: string | undefined) =>
          addr && SOL_ADDRESSES.includes(addr.toLowerCase());

        // Method 1: Calculate price from exchange ratio (SOL amount * SOL price / Token amount)
        if (boughtIsToken && swap.bought?.amount && isSolAddress(swap.sold?.address)) {
          const tokenAmount = parseFloat(swap.bought.amount);
          const solAmount = parseFloat(swap.sold?.amount || "0");
          const solPrice = swap.sold?.usdPrice || 0;
          if (tokenAmount > 0 && solAmount > 0 && solPrice > 0) {
            price = (solAmount * solPrice) / tokenAmount;
          }
        } else if (soldIsToken && swap.sold?.amount && isSolAddress(swap.bought?.address)) {
          const tokenAmount = parseFloat(swap.sold.amount);
          const solAmount = parseFloat(swap.bought?.amount || "0");
          const solPrice = swap.bought?.usdPrice || 0;
          if (tokenAmount > 0 && solAmount > 0 && solPrice > 0) {
            price = (solAmount * solPrice) / tokenAmount;
          }
        }

        // Method 2: Use usdAmount / amount directly from Moralis
        if (price === 0) {
          if (boughtIsToken && swap.bought?.usdAmount && swap.bought?.amount) {
            const tokenAmount = parseFloat(swap.bought.amount);
            if (tokenAmount > 0) {
              price = swap.bought.usdAmount / tokenAmount;
            }
          } else if (soldIsToken && swap.sold?.usdAmount && swap.sold?.amount) {
            const tokenAmount = parseFloat(swap.sold.amount);
            if (tokenAmount > 0) {
              price = swap.sold.usdAmount / tokenAmount;
            }
          }
        }

        // Method 3: Use the token's usdPrice directly (Moralis provides this)
        if (price === 0) {
          if (boughtIsToken && swap.bought?.usdPrice) {
            price = swap.bought.usdPrice;
          } else if (soldIsToken && swap.sold?.usdPrice) {
            price = swap.sold.usdPrice;
          }
        }

        // Method 4: Calculate from totalValueUsd / token amount
        if (price === 0 && swap.totalValueUsd > 0) {
          if (boughtIsToken && swap.bought?.amount) {
            const tokenAmount = parseFloat(swap.bought.amount);
            if (tokenAmount > 0) {
              price = swap.totalValueUsd / tokenAmount;
            }
          } else if (soldIsToken && swap.sold?.amount) {
            const tokenAmount = parseFloat(swap.sold.amount);
            if (tokenAmount > 0) {
              price = swap.totalValueUsd / tokenAmount;
            }
          }
        }

        const volume = swap.totalValueUsd || swap.bought?.usdAmount || swap.sold?.usdAmount || 0;
        return { price, volume };
      };

      // Per-trade mode: create one candle per swap (like pump.fun)
      // Pure OHLCV - each trade is a single execution so high=max(O,C), low=min(O,C)
      if (perTrade) {
        const candles: OHLCV[] = [];
        let prevPrice = 0;

        for (const swap of swaps) {
          const { price, volume } = getPriceAndVolume(swap);
          if (price <= 0) continue;

          const timestamp = new Date(swap.blockTimestamp).getTime();

          // Open = previous candle's close (creates connected candlestick chart)
          const open = prevPrice > 0 ? prevPrice : price;
          const close = price;

          // Pure OHLCV: for a single trade, high/low are simply max/min of open and close
          // No artificial wicks - this is how real per-trade candles work
          const high = Math.max(open, close);
          const low = Math.min(open, close);

          candles.push({
            timestamp,
            open,
            high,
            low,
            close,
            volume,
          });

          prevPrice = price;
        }

        console.log(`📊 Built ${candles.length} per-trade candles from swaps (fetched ${allSwaps.length} total swaps)`);
        return candles;
      }

      // Interval mode: group swaps by time interval
      const candleMap = new Map<number, OHLCV>();

      for (const swap of swaps) {
        const timestamp = new Date(swap.blockTimestamp).getTime();
        const candleTime = Math.floor(timestamp / intervalMs) * intervalMs;

        const { price, volume } = getPriceAndVolume(swap);
        if (price <= 0) continue;

        const existing = candleMap.get(candleTime);
        if (existing) {
          existing.high = Math.max(existing.high, price);
          existing.low = Math.min(existing.low, price);
          existing.close = price;  // Most recent in this candle
          existing.volume += volume;
        } else {
          candleMap.set(candleTime, {
            timestamp: candleTime,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: volume,
          });
        }
      }

      // Convert to array and sort by time (oldest first)
      // Only return candles with actual trades - no gap filling (matches pump.fun style)
      const candles = Array.from(candleMap.values())
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-maxCandles);

      console.log(`📊 Built ${candles.length} interval candles from swaps`);
      return candles;
    } catch (error) {
      console.error("Error building OHLCV from swaps:", error);
      return [];
    }
  }

  // Get token holder stats
  async getHolderStats(address: string): Promise<MoralisHolderStats | null> {
    if (!this.apiKey) {
      console.warn("MORALIS_API_KEY not configured");
      return null;
    }

    try {
      const response = await fetch(
        `${MORALIS_API_URL}/token/mainnet/holders/${address}`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Moralis holder stats API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error fetching Moralis holder stats:", error);
      return null;
    }
  }

  // Get top token holders
  async getTopHolders(address: string, limit: number = 20): Promise<MoralisTopHolder[]> {
    if (!this.apiKey) {
      console.warn("MORALIS_API_KEY not configured");
      return [];
    }

    try {
      const response = await fetch(
        `${MORALIS_API_URL}/token/mainnet/${address}/top-holders?limit=${limit}`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Moralis top holders API error: ${response.status}`);
      }

      const data = await response.json();
      return data.result || [];
    } catch (error) {
      console.error("Error fetching Moralis top holders:", error);
      return [];
    }
  }

  // Get token trading stats/analytics
  async getTokenStats(address: string): Promise<MoralisTokenStats | null> {
    if (!this.apiKey) {
      console.warn("MORALIS_API_KEY not configured");
      return null;
    }

    try {
      // Get pairs to find the main trading pair
      const pairs = await this.getTokenPairs(address);
      if (!pairs || pairs.length === 0) {
        return null;
      }

      const mainPair = pairs.find((p) => !p.inactivePair) || pairs[0];

      // Get pair stats
      const response = await fetch(
        `${MORALIS_API_URL}/token/mainnet/pairs/${mainPair.pairAddress}/stats`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        // Stats endpoint might not exist for all pairs
        return {
          volume24hUsd: mainPair.volume24hrUsd || 0,
        };
      }

      return await response.json();
    } catch (error) {
      console.error("Error fetching Moralis token stats:", error);
      return null;
    }
  }

  // Check if API key is configured
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  // Convert Moralis pump.fun token to Pulse format
  mapPumpFunTokenToPulse(token: MoralisPumpFunToken): {
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
    complete?: boolean;
    bondingProgress?: number;
  } {
    const marketCap = parseFloat(token.fullyDilutedValuation || "0");

    // Calculate % change from creation for pump.fun tokens
    // Pump.fun tokens start at ~$4K market cap (initial bonding curve)
    // This gives us a meaningful "change since launch" metric
    const PUMP_FUN_STARTING_MC = 4000; // ~$4K starting market cap
    let priceChange = 0;
    if (marketCap > 0 && marketCap > PUMP_FUN_STARTING_MC) {
      priceChange = ((marketCap - PUMP_FUN_STARTING_MC) / PUMP_FUN_STARTING_MC) * 100;
    } else if (marketCap > 0) {
      // If somehow below starting MC (shouldn't happen normally)
      priceChange = ((marketCap - PUMP_FUN_STARTING_MC) / PUMP_FUN_STARTING_MC) * 100;
    }

    return {
      address: token.tokenAddress,
      symbol: token.symbol,
      name: token.name,
      logoUri: token.logo,
      price: parseFloat(token.priceUsd || "0"),
      priceChange24h: priceChange, // % change from pump.fun starting MC (~$4K)
      volume24h: 0, // Requires pair data
      liquidity: parseFloat(token.liquidity || "0"),
      marketCap,
      txCount: 0,
      createdAt: token.createdAt ? new Date(token.createdAt).getTime() : Date.now(),
      source: "moralis",
      complete: !!token.graduatedAt,
      bondingProgress: token.bondingCurveProgress,
    };
  }

  // Get new pump.fun tokens in Pulse format
  async getNewPulsePairs(limit: number = 50): Promise<ReturnType<typeof this.mapPumpFunTokenToPulse>[]> {
    const tokens = await this.getNewTokens(limit);
    return tokens.map((t) => this.mapPumpFunTokenToPulse(t));
  }

  // Get graduating (bonding) tokens in Pulse format
  async getGraduatingPulsePairs(limit: number = 50): Promise<ReturnType<typeof this.mapPumpFunTokenToPulse>[]> {
    const tokens = await this.getBondingTokens(limit);
    return tokens.map((t) => this.mapPumpFunTokenToPulse(t));
  }

  // Get graduated tokens in Pulse format
  // Fetches individual token data for each to get accurate MC/volume
  async getGraduatedPulsePairs(limit: number = 50): Promise<ReturnType<typeof this.mapPumpFunTokenToPulse>[]> {
    const tokens = await this.getGraduatedTokens(limit);

    // The graduated endpoint only returns basic info without MC/volume
    // We need to fetch individual token data for accurate stats
    console.log(`[Moralis] getGraduatedPulsePairs: Enriching ${tokens.length} graduated tokens with individual data...`);

    const enrichedTokens = await Promise.all(
      tokens.map(async (t, index) => {
        const baseData = {
          ...this.mapPumpFunTokenToPulse(t),
          complete: true,
        };

        // Fetch individual token data for accurate MC/volume
        try {
          const tokenData = await this.getTokenData(t.tokenAddress);
          if (tokenData && (tokenData.marketCap > 0 || tokenData.volume24h > 0)) {
            console.log(`[Moralis] Enriched ${t.symbol}: MC=$${tokenData.marketCap?.toLocaleString() || 0}, Vol=$${tokenData.volume24h?.toLocaleString() || 0}`);
            return {
              ...baseData,
              price: tokenData.price || baseData.price,
              marketCap: tokenData.marketCap || baseData.marketCap,
              volume24h: tokenData.volume24h || baseData.volume24h,
              liquidity: tokenData.liquidity || baseData.liquidity,
              priceChange24h: tokenData.priceChange24h || baseData.priceChange24h,
              logoUri: tokenData.logoURI || baseData.logoUri,
            };
          }
        } catch (err) {
          // Log but continue with base data
          if (index < 3) {
            console.warn(`[Moralis] Failed to enrich ${t.symbol}:`, err);
          }
        }

        return baseData;
      })
    );

    // Log summary
    const withMC = enrichedTokens.filter(t => t.marketCap > 0).length;
    const withVol = enrichedTokens.filter(t => t.volume24h > 0).length;
    console.log(`[Moralis] getGraduatedPulsePairs: ${withMC}/${enrichedTokens.length} have MC, ${withVol}/${enrichedTokens.length} have volume`);

    return enrichedTokens;
  }
}

export const moralisService = new MoralisService();
export type { MoralisPumpFunToken, MoralisPairData, MoralisSwap, MoralisHolderStats, MoralisTopHolder, MoralisTokenStats };
