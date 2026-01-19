import { create } from "zustand";
import { persist } from "zustand/middleware";
import { io, Socket } from "socket.io-client";

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
  socket: Socket | null;

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

// WebSocket URL for real-time updates (connects directly to Express)
const WS_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
// API calls go through Next.js proxy routes (protects internal API key)

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

// Static fallback data for when API is unavailable
const STATIC_NEW_PAIRS: PulseToken[] = [
  { address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", symbol: "SAMO", name: "Samoyedcoin", price: 0.0234, priceChange24h: 15.4, volume24h: 125000, liquidity: 89000, marketCap: 45000, txCount: 342, createdAt: Date.now() - 1800000, source: "pump.fun", ohlcv: [] },
  { address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk Inu", price: 0.0000234, priceChange24h: -5.2, volume24h: 890000, liquidity: 456000, marketCap: 38000, txCount: 1205, createdAt: Date.now() - 3600000, source: "pump.fun", ohlcv: [] },
  { address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat", price: 2.34, priceChange24h: 8.7, volume24h: 2340000, liquidity: 1200000, marketCap: 52000, txCount: 3421, createdAt: Date.now() - 7200000, source: "pump.fun", ohlcv: [] },
  { address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", symbol: "RAY", name: "Raydium", price: 4.56, priceChange24h: 12.1, volume24h: 5670000, liquidity: 3400000, marketCap: 28000, txCount: 8901, createdAt: Date.now() - 10800000, source: "pump.fun", ohlcv: [] },
  { address: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", symbol: "MSOL", name: "Marinade SOL", price: 178.90, priceChange24h: 3.2, volume24h: 12300000, liquidity: 8900000, marketCap: 61000, txCount: 4523, createdAt: Date.now() - 14400000, source: "pump.fun", ohlcv: [] },
  { address: "So11111111111111111111111111111111111111112", symbol: "WSOL", name: "Wrapped SOL", price: 145.67, priceChange24h: 2.8, volume24h: 45000000, liquidity: 23000000, marketCap: 41000, txCount: 12034, createdAt: Date.now() - 18000000, source: "pump.fun", ohlcv: [] },
  { address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", price: 0.89, priceChange24h: -2.1, volume24h: 8900000, liquidity: 5600000, marketCap: 35000, txCount: 6789, createdAt: Date.now() - 21600000, source: "pump.fun", ohlcv: [] },
  { address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE", symbol: "ORCA", name: "Orca", price: 3.45, priceChange24h: 6.5, volume24h: 3400000, liquidity: 2100000, marketCap: 48000, txCount: 2345, createdAt: Date.now() - 25200000, source: "pump.fun", ohlcv: [] },
];

const STATIC_GRADUATING_PAIRS: PulseToken[] = [
  { address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", symbol: "PYTH", name: "Pyth Network", price: 0.45, priceChange24h: 22.3, volume24h: 6700000, liquidity: 4500000, marketCap: 65000, txCount: 5678, createdAt: Date.now() - 28800000, source: "pump.fun", ohlcv: [] },
  { address: "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ", symbol: "W", name: "Wormhole", price: 0.67, priceChange24h: 18.9, volume24h: 4500000, liquidity: 3200000, marketCap: 62000, txCount: 3456, createdAt: Date.now() - 32400000, source: "pump.fun", ohlcv: [] },
  { address: "HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4", symbol: "MYRO", name: "Myro", price: 0.12, priceChange24h: 45.6, volume24h: 2300000, liquidity: 1800000, marketCap: 58000, txCount: 2134, createdAt: Date.now() - 36000000, source: "pump.fun", ohlcv: [] },
  { address: "kinXdEcpDQeHPEuQnqmUgtYykqKGVFq6CeVX5iAHJq6", symbol: "KIN", name: "Kin", price: 0.000012, priceChange24h: 8.4, volume24h: 890000, liquidity: 670000, marketCap: 54000, txCount: 1567, createdAt: Date.now() - 39600000, source: "pump.fun", ohlcv: [] },
];

const STATIC_GRADUATED_PAIRS: PulseToken[] = [
  { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", price: 1.00, priceChange24h: 0.01, volume24h: 890000000, liquidity: 450000000, marketCap: 120000, txCount: 456789, createdAt: Date.now() - 43200000, source: "pump.fun", complete: true, ohlcv: [] },
  { address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "Tether USD", price: 1.00, priceChange24h: -0.02, volume24h: 670000000, liquidity: 340000000, marketCap: 98000, txCount: 345678, createdAt: Date.now() - 46800000, source: "pump.fun", complete: true, ohlcv: [] },
  { address: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", symbol: "ETH", name: "Wrapped Ether", price: 3245.67, priceChange24h: 4.5, volume24h: 23000000, liquidity: 12000000, marketCap: 85000, txCount: 23456, createdAt: Date.now() - 50400000, source: "pump.fun", complete: true, ohlcv: [] },
  { address: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", symbol: "WBTC", name: "Wrapped BTC", price: 67890.12, priceChange24h: 2.3, volume24h: 12000000, liquidity: 8900000, marketCap: 78000, txCount: 12345, createdAt: Date.now() - 54000000, source: "pump.fun", complete: true, ohlcv: [] },
];

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
      socket: null,

  fetchNewPairs: async () => {
    try {
      // Use Next.js proxy route (protects internal API key)
      const response = await fetch(`/api/pulse/new-pairs?limit=50&source=all`);
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();

      const tokens = (data.data || []).map(mapTokenData);
      if (tokens.length > 0) {
        set({
          newPairs: tokens,
          sources: data.sources || ["pumpfun", "meteora"],
          isRealtime: data.realtime || false,
        });
      } else {
        // Use static fallback if no data returned
        set({ newPairs: STATIC_NEW_PAIRS, sources: ["demo"], isRealtime: false });
      }
    } catch (error) {
      console.error("Failed to fetch new pairs, using static data:", error);
      // Use static fallback data when API fails
      set({ newPairs: STATIC_NEW_PAIRS, sources: ["demo"], isRealtime: false });
    }
  },

  fetchGraduatingPairs: async () => {
    try {
      // Use Next.js proxy route (protects internal API key)
      const response = await fetch(`/api/pulse/graduating`);
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();

      const tokens = (data.data || []).map(mapTokenData);
      if (tokens.length > 0) {
        set({ graduatingPairs: tokens });
      } else {
        // Use static fallback if no data returned
        set({ graduatingPairs: STATIC_GRADUATING_PAIRS });
      }
    } catch (error) {
      console.error("Failed to fetch graduating pairs, using static data:", error);
      // Use static fallback data when API fails
      set({ graduatingPairs: STATIC_GRADUATING_PAIRS });
    }
  },

  fetchGraduatedPairs: async () => {
    try {
      // Use Next.js proxy route (protects internal API key)
      const response = await fetch(`/api/pulse/graduated`);
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();

      const tokens = (data.data || []).map(mapTokenData);
      if (tokens.length > 0) {
        set({ graduatedPairs: tokens });
      } else {
        // Use static fallback if no data returned
        set({ graduatedPairs: STATIC_GRADUATED_PAIRS });
      }
    } catch (error) {
      console.error("Failed to fetch graduated pairs, using static data:", error);
      // Use static fallback data when API fails
      set({ graduatedPairs: STATIC_GRADUATED_PAIRS });
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

  // Connect to WebSocket for real-time updates
  connectRealtime: () => {
    const { socket } = get();
    if (socket?.connected) return;

    const newSocket = io(WS_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on("connect", () => {
      console.log("🔌 Connected to Pulse WebSocket");
      newSocket.emit("subscribe:pulse");
      set({ isRealtime: true });
    });

    newSocket.on("disconnect", () => {
      console.log("🔌 Disconnected from Pulse WebSocket");
      set({ isRealtime: false });
    });

    // Handle real-time new pairs
    newSocket.on("pulse:newPair", (data: any) => {
      const token = mapTokenData(data);
      get().addNewPair(token);
    });

    // Handle graduating tokens (near $69k market cap)
    newSocket.on("pulse:graduating", (data: any) => {
      const token = mapTokenData(data);
      get().addGraduatingPair(token);
    });

    // Handle migrations (graduated tokens)
    newSocket.on("pulse:migrated", (data: any) => {
      const { newPairs, graduatingPairs, graduatedPairs } = get();

      // Try to find token data from the event, newPairs, or graduatingPairs
      let migratedToken = data.tokenData ? mapTokenData(data.tokenData) : null;

      if (!migratedToken) {
        migratedToken = newPairs.find((t) => t.address === data.mint) ??
                        graduatingPairs.find((t) => t.address === data.mint) ?? null;
      }

      if (migratedToken) {
        const updatedToken = { ...migratedToken, complete: true, source: "pump.fun (migrated)" };
        set({
          newPairs: newPairs.filter((t) => t.address !== data.mint),
          graduatingPairs: graduatingPairs.filter((t) => t.address !== data.mint),
          graduatedPairs: [updatedToken, ...graduatedPairs].slice(0, MAX_PAIRS),
        });
      } else {
        // Create minimal token if we don't have data
        const minimalToken: PulseToken = {
          address: data.mint,
          symbol: "???",
          name: "Migrated Token",
          logoUri: undefined, // Image URL comes from IPFS metadata, fetched by backend
          price: 0,
          priceChange24h: 0,
          volume24h: 0,
          liquidity: 0,
          marketCap: 0,
          txCount: 0,
          createdAt: Date.now(),
          complete: true,
          ohlcv: [],
        };
        set({
          graduatedPairs: [minimalToken, ...graduatedPairs].slice(0, MAX_PAIRS),
        });
      }
    });

    // Handle token updates (e.g., logo loaded from Moralis)
    newSocket.on("pulse:tokenUpdate", (data: { address: string; logoUri?: string }) => {
      const { newPairs, graduatingPairs, graduatedPairs } = get();

      // Update logo in all lists where the token exists
      const updateList = (list: PulseToken[]) =>
        list.map((token) =>
          token.address === data.address
            ? { ...token, logoUri: data.logoUri || token.logoUri }
            : token
        );

      set({
        newPairs: updateList(newPairs),
        graduatingPairs: updateList(graduatingPairs),
        graduatedPairs: updateList(graduatedPairs),
      });
    });

    set({ socket: newSocket });
  },

  // Disconnect from WebSocket
  disconnectRealtime: () => {
    const { socket } = get();
    if (socket) {
      socket.emit("unsubscribe:pulse");
      socket.disconnect();
      set({ socket: null, isRealtime: false });
    }
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
