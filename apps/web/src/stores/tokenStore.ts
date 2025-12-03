import { create } from "zustand";

export interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUri?: string;
  price?: number;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
  liquidity?: number;
  totalSupply?: number;
  maxSupply?: number;
  circulatingSupply?: number;
  website?: string;
  twitter?: string;
  telegram?: string;
  description?: string;
}

interface TokenStore {
  tokens: Token[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  fetchTokens: () => Promise<void>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export const useTokenStore = create<TokenStore>((set) => ({
  tokens: [],
  isLoading: false,
  error: null,
  searchQuery: "",
  setSearchQuery: (query) => set({ searchQuery: query }),
  fetchTokens: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/api/tokens?limit=100`);
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      const data = await response.json();
      set({ tokens: data.data || [], isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to fetch tokens",
        isLoading: false,
      });
    }
  },
}));
