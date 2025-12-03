import type { JupiterToken } from "@shared/types";

const JUPITER_API_URL = "https://tokens.jup.ag";

class JupiterService {
  private tokenCache: Map<string, JupiterToken> = new Map();
  private allTokensCache: JupiterToken[] | null = null;
  private lastFetch: number = 0;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes

  // Fetch all tokens from Jupiter
  async getAllTokens(): Promise<JupiterToken[]> {
    const now = Date.now();
    if (this.allTokensCache && now - this.lastFetch < this.cacheTTL) {
      return this.allTokensCache;
    }

    try {
      const response = await fetch(`${JUPITER_API_URL}/tokens?tags=verified,community`);
      if (!response.ok) {
        throw new Error(`Jupiter API error: ${response.status}`);
      }

      const tokens: JupiterToken[] = await response.json();
      this.allTokensCache = tokens;
      this.lastFetch = now;

      // Update individual token cache
      for (const token of tokens) {
        this.tokenCache.set(token.address, token);
      }

      console.log(`📊 Fetched ${tokens.length} tokens from Jupiter`);
      return tokens;
    } catch (error) {
      console.error("Error fetching Jupiter tokens:", error);
      return this.allTokensCache ?? [];
    }
  }

  // Get a single token by address
  async getToken(address: string): Promise<JupiterToken | null> {
    // Check cache first
    if (this.tokenCache.has(address)) {
      return this.tokenCache.get(address)!;
    }

    // Fetch all tokens if cache is empty
    if (!this.allTokensCache) {
      await this.getAllTokens();
    }

    return this.tokenCache.get(address) ?? null;
  }

  // Search tokens by symbol or name
  searchTokens(query: string, limit: number = 20): JupiterToken[] {
    if (!this.allTokensCache) {
      return [];
    }

    const lowerQuery = query.toLowerCase();
    return this.allTokensCache
      .filter(
        (token) =>
          token.symbol.toLowerCase().includes(lowerQuery) ||
          token.name.toLowerCase().includes(lowerQuery)
      )
      .slice(0, limit);
  }

  // Get tokens with specific tags (e.g., 'meme', 'pump')
  getTokensByTag(tag: string): JupiterToken[] {
    if (!this.allTokensCache) {
      return [];
    }

    return this.allTokensCache.filter((token) => token.tags?.includes(tag));
  }
}

export const jupiterService = new JupiterService();
