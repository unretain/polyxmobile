import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PulseToken {
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
  source?: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  complete?: boolean;
  replyCount?: number;
  ohlcv: OHLCV[];
}

interface PulseStore {
  // New pairs (just launched on pump.fun/meteora)
  newPairs: PulseToken[];
  // Graduating (about to complete bonding curve - "Final Stretch")
  graduatingPairs: PulseToken[];
  // Graduated/Migrated (completed bonding curve, on Raydium/PumpSwap)
  graduatedPairs: PulseToken[];

  isLoading: boolean;
  error: string | null;
  lastUpdate: number;
  sources: string[];
  isRealtime: boolean;

  // Actions
  fetchNewPairs: () => Promise<void>;
  fetchGraduatingPairs: () => Promise<void>;
  fetchGraduatedPairs: () => Promise<void>;
  fetchAllPairs: () => Promise<void>;
  fetchTokenOHLCV: (address: string) => Promise<OHLCV[]>;
  updateTokenOHLCV: (address: string, ohlcv: OHLCV[]) => void;
  getTokenByAddress: (address: string) => PulseToken | undefined;

  // Real-time actions
  connectRealtime: () => void;
  disconnectRealtime: () => void;
  addNewPair: (token: PulseToken) => void;
  addGraduatingPair: (token: PulseToken) => void;
  addMigratedPair: (token: PulseToken) => void;
}

// API calls go through Next.js proxy routes which use RPC polling

const mapTokenData = (token: any): PulseToken => ({
  address: token.address,
  symbol: token.symbol,
  name: token.name,
  logoUri: token.logoUri || token.image_uri,
  price: token.price || 0,
  priceChange24h: token.priceChange24h || 0,
  volume24h: token.volume24h || 0,
  liquidity: token.liquidity || 0,
  marketCap: token.marketCap || 0,
  txCount: token.txCount || token.replyCount || 0,
  createdAt: token.createdAt || Date.now(),
  source: token.source,
  description: token.description,
  twitter: token.twitter,
  telegram: token.telegram,
  website: token.website,
  complete: token.complete,
  replyCount: token.replyCount,
  ohlcv: [],
});

const MAX_PAIRS = 100; // Maximum pairs to keep in each list

// Filter out stale/invalid tokens from persisted data
const filterValidTokens = (tokens: PulseToken[]): PulseToken[] => {
  const now = Date.now();
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

  return tokens
    .map((t) => {
      // Clean up invalid image URLs (image.pump.fun doesn't exist)
      if (t.logoUri && t.logoUri.includes("image.pump.fun")) {
        return { ...t, logoUri: undefined };
      }
      return t;
    })
    .filter((t) => {
      // Must have valid address and symbol
      if (!t.address || !t.symbol || t.symbol === "???") return false;
      // Must be from last 24 hours (new tokens only)
      if (t.createdAt < twentyFourHoursAgo) return false;
      // Must be from pump.fun/pumpportal/moralis source (not trending like SOL, TRUMP)
      if (t.source && !["pump.fun", "pumpportal", "meteora", "moralis"].includes(t.source)) return false;
      // Filter out known established tokens that shouldn't be in Pulse
      const establishedSymbols = ["SOL", "TRUMP", "BONK", "WIF", "JUP", "USDC", "USDT", "RAY", "ORCA", "KAZOO"];
      if (establishedSymbols.includes(t.symbol.toUpperCase())) return false;
      return true;
    });
};

export const usePulseStore = create<PulseStore>()(
  persist(
    (set, get) => ({
      newPairs: [],
      graduatingPairs: [],
      graduatedPairs: [],
      isLoading: false,
      error: null,
      lastUpdate: 0,
      sources: [],
      isRealtime: false,

  fetchNewPairs: async () => {
    try {
      const response = await fetch(`/api/pulse/new-pairs?limit=50&source=all`);
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();

      const tokens = (data.data || []).map(mapTokenData);
      set({
        newPairs: tokens,
        sources: data.sources || ["grpc"],
        isRealtime: data.realtime || false,
      });
    } catch (error) {
      console.error("Failed to fetch new pairs:", error);
    }
  },

  fetchGraduatingPairs: async () => {
    try {
      const response = await fetch(`/api/pulse/graduating`);
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();

      const tokens = (data.data || []).map(mapTokenData);
      // Sort by progress (highest first) - tokens closest to graduation
      tokens.sort((a: PulseToken, b: PulseToken) => (b.marketCap || 0) - (a.marketCap || 0));
      set({ graduatingPairs: tokens });
    } catch (error) {
      console.error("Failed to fetch graduating pairs:", error);
    }
  },

  fetchGraduatedPairs: async () => {
    try {
      const response = await fetch(`/api/pulse/graduated`);
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();

      const tokens = (data.data || []).map(mapTokenData);
      // Sort by most recent graduation
      tokens.sort((a: PulseToken, b: PulseToken) => (b.createdAt || 0) - (a.createdAt || 0));
      set({ graduatedPairs: tokens });
    } catch (error) {
      console.error("Failed to fetch graduated pairs:", error);
    }
  },

  fetchAllPairs: async () => {
    set({ isLoading: true, error: null });
    try {
      await Promise.all([
        get().fetchNewPairs(),
        get().fetchGraduatingPairs(),
        get().fetchGraduatedPairs(),
      ]);
      set({ isLoading: false, lastUpdate: Date.now() });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to fetch pairs",
        isLoading: false,
      });
    }
  },

  fetchTokenOHLCV: async (address: string) => {
    try {
      // Use Next.js proxy route with 1-minute candles (protects internal API key)
      const response = await fetch(`/api/pulse/ohlcv/${address}?timeframe=1min`);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = await response.json();
      // The pulse endpoint returns { address, timeframe, data, timestamp, source }
      const ohlcv: OHLCV[] = result.data || [];
      return ohlcv;
    } catch (error) {
      console.error(`Failed to fetch OHLCV for ${address}:`, error);
      return [];
    }
  },

  updateTokenOHLCV: (address: string, ohlcv: OHLCV[]) => {
    const { newPairs, graduatingPairs, graduatedPairs } = get();

    const updateList = (list: PulseToken[]) =>
      list.map((token) =>
        token.address === address ? { ...token, ohlcv } : token
      );

    set({
      newPairs: updateList(newPairs),
      graduatingPairs: updateList(graduatingPairs),
      graduatedPairs: updateList(graduatedPairs),
    });
  },

  // Get a token by address from any of the lists
  getTokenByAddress: (address: string) => {
    const { newPairs, graduatingPairs, graduatedPairs } = get();
    return (
      newPairs.find((t) => t.address === address) ||
      graduatingPairs.find((t) => t.address === address) ||
      graduatedPairs.find((t) => t.address === address)
    );
  },

  // Connect to real-time updates via HTTP polling (WebSocket disabled - using RPC polling instead)
  connectRealtime: () => {
    // WebSocket disabled - real-time updates handled by server-side RPC polling
    // The API routes now poll the Solana RPC directly
    console.log("[Pulse] Real-time via RPC polling (no WebSocket)");
    set({ isRealtime: true });

    // Poll for updates every 15 seconds (client-side fallback)
    const pollInterval = setInterval(() => {
      get().fetchAllPairs();
    }, 15000);

    // Store interval ID for cleanup (using socket field as workaround)
    (window as any).__pulsePollingInterval = pollInterval;
  },

  // Disconnect - clear polling interval
  disconnectRealtime: () => {
    const interval = (window as any).__pulsePollingInterval;
    if (interval) {
      clearInterval(interval);
      (window as any).__pulsePollingInterval = null;
    }
    set({ isRealtime: false });
  },

  // Add a new pair to the top of the list
  addNewPair: (token: PulseToken) => {
    const { newPairs } = get();

    // Check if token already exists
    if (newPairs.some((t) => t.address === token.address)) {
      return;
    }

    // Add to top, keep max size
    set({
      newPairs: [token, ...newPairs].slice(0, MAX_PAIRS),
      lastUpdate: Date.now(),
    });
  },

  // Add a graduating pair (near $69k market cap)
  addGraduatingPair: (token: PulseToken) => {
    const { newPairs, graduatingPairs } = get();

    // Check if token already exists in graduating
    if (graduatingPairs.some((t) => t.address === token.address)) {
      // Update existing token with new market cap
      set({
        graduatingPairs: graduatingPairs.map((t) =>
          t.address === token.address ? { ...t, marketCap: token.marketCap } : t
        ),
      });
      return;
    }

    // Remove from new pairs if present
    const updatedNewPairs = newPairs.filter((t) => t.address !== token.address);

    // Add to graduating, sorted by market cap (highest first)
    const updatedGraduating = [token, ...graduatingPairs]
      .sort((a, b) => b.marketCap - a.marketCap)
      .slice(0, MAX_PAIRS);

    set({
      newPairs: updatedNewPairs,
      graduatingPairs: updatedGraduating,
      lastUpdate: Date.now(),
    });
  },

  // Add a migrated pair
  addMigratedPair: (token: PulseToken) => {
    const { graduatedPairs } = get();

    if (graduatedPairs.some((t) => t.address === token.address)) {
      return;
    }

    set({
      graduatedPairs: [token, ...graduatedPairs].slice(0, MAX_PAIRS),
    });
  },
    }),
    {
      name: "pulse-store",
      partialize: (state) => ({
        // Only persist the token lists, not loading/socket state
        newPairs: state.newPairs,
        graduatingPairs: state.graduatingPairs,
        graduatedPairs: state.graduatedPairs,
        lastUpdate: state.lastUpdate,
        sources: state.sources,
      }),
      // Filter out stale/invalid tokens when rehydrating from localStorage
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.newPairs = filterValidTokens(state.newPairs);
          state.graduatingPairs = filterValidTokens(state.graduatingPairs);
          state.graduatedPairs = filterValidTokens(state.graduatedPairs);
        }
      },
    }
  )
);
