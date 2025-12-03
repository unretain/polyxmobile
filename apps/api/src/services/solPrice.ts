// SOL Price Service - Fetches real-time SOL price from multiple sources
// Uses CoinGecko, Jupiter, or Binance as fallbacks

const SOL_MINT = "So11111111111111111111111111111111111111112";

// Multiple price APIs to try
const PRICE_APIS = [
  {
    name: "CoinGecko",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    parse: (data: any) => data?.solana?.usd,
  },
  {
    name: "Jupiter",
    url: `https://api.jup.ag/price/v2?ids=${SOL_MINT}`,
    parse: (data: any) => parseFloat(data?.data?.[SOL_MINT]?.price || "0"),
  },
  {
    name: "Binance",
    url: "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT",
    parse: (data: any) => parseFloat(data?.price || "0"),
  },
];

class SolPriceService {
  private price: number = 230; // Start with reasonable fallback
  private lastFetch: number = 0;
  private cacheTTL: number = 30 * 1000; // 30 seconds cache
  private fetchPromise: Promise<number> | null = null;
  private lastLoggedError: number = 0;

  // Get current SOL price in USD
  async getPrice(): Promise<number> {
    const now = Date.now();

    // Return cached price if still valid
    if (this.price > 0 && now - this.lastFetch < this.cacheTTL) {
      return this.price;
    }

    // If already fetching, wait for that promise
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    // Fetch new price
    this.fetchPromise = this.fetchPrice();

    try {
      const price = await this.fetchPromise;
      return price;
    } finally {
      this.fetchPromise = null;
    }
  }

  private async fetchPrice(): Promise<number> {
    // Try each API in order
    for (const api of PRICE_APIS) {
      try {
        const response = await fetch(api.url, {
          signal: AbortSignal.timeout(5000),
          headers: {
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          continue; // Try next API
        }

        const data = await response.json();
        const price = api.parse(data);

        if (price && price > 0) {
          this.price = price;
          this.lastFetch = Date.now();
          console.log(`💰 SOL price from ${api.name}: $${this.price.toFixed(2)}`);
          return this.price;
        }
      } catch (error) {
        // Log errors only once per minute to avoid spam
        const now = Date.now();
        if (now - this.lastLoggedError > 60000) {
          console.warn(`${api.name} price fetch failed:`, error instanceof Error ? error.message : error);
          this.lastLoggedError = now;
        }
        continue; // Try next API
      }
    }

    // All APIs failed - use cached or fallback
    if (this.price > 0) {
      return this.price;
    }

    // Last resort fallback
    console.warn("All price APIs failed, using fallback SOL price: $230");
    return 230;
  }

  // Get price synchronously (returns cached or fallback)
  getPriceSync(): number {
    // If cache is stale, trigger async refresh
    const now = Date.now();
    if (now - this.lastFetch > this.cacheTTL) {
      this.getPrice().catch(() => {});
    }
    return this.price; // Always return a value (starts at 230)
  }

  // Force refresh price
  async refresh(): Promise<number> {
    this.lastFetch = 0;
    return this.getPrice();
  }
}

export const solPriceService = new SolPriceService();

// Initialize price on module load (don't spam logs on error)
solPriceService.getPrice().catch(() => {});
