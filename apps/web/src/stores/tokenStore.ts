import { create } from "zustand";
import { io, Socket } from "socket.io-client";

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
  isRealtime: boolean;
  socket: Socket | null;
  lastUpdate: number;
  setSearchQuery: (query: string) => void;
  fetchTokens: () => Promise<void>;
  connectRealtime: () => void;
  disconnectRealtime: () => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export const useTokenStore = create<TokenStore>((set, get) => ({
  tokens: [],
  isLoading: false,
  error: null,
  searchQuery: "",
  isRealtime: false,
  socket: null,
  lastUpdate: 0,
  setSearchQuery: (query) => set({ searchQuery: query }),
  fetchTokens: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/api/tokens?limit=100`);
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      const data = await response.json();
      set({ tokens: data.data || [], isLoading: false, lastUpdate: Date.now() });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to fetch tokens",
        isLoading: false,
      });
    }
  },

  // Connect to WebSocket for real-time price updates
  connectRealtime: () => {
    const { socket } = get();
    if (socket?.connected) return;

    const newSocket = io(API_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on("connect", () => {
      console.log("📊 Connected to Dashboard WebSocket");
      newSocket.emit("subscribe:dashboard");
      set({ isRealtime: true });
    });

    newSocket.on("disconnect", () => {
      console.log("📊 Disconnected from Dashboard WebSocket");
      set({ isRealtime: false });
    });

    // Handle real-time price updates
    newSocket.on("dashboard:prices", (data: { tokens: Partial<Token>[]; timestamp: number }) => {
      const { tokens: currentTokens } = get();

      // Update prices for existing tokens
      const updatedTokens = currentTokens.map((token) => {
        const update = data.tokens.find((t) => t.address === token.address);
        if (update) {
          return {
            ...token,
            price: update.price ?? token.price,
            priceChange24h: update.priceChange24h ?? token.priceChange24h,
            volume24h: update.volume24h ?? token.volume24h,
            marketCap: update.marketCap ?? token.marketCap,
            liquidity: update.liquidity ?? token.liquidity,
          };
        }
        return token;
      });

      set({ tokens: updatedTokens, lastUpdate: data.timestamp });
    });

    set({ socket: newSocket });
  },

  // Disconnect from WebSocket
  disconnectRealtime: () => {
    const { socket } = get();
    if (socket) {
      socket.emit("unsubscribe:dashboard");
      socket.disconnect();
      set({ socket: null, isRealtime: false });
    }
  },
}));
