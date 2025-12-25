"use client";

import { create } from "zustand";
import { io, Socket } from "socket.io-client";

interface SocketState {
  socket: Socket | null;
  isConnected: boolean;
  isAuthenticated: boolean;
  connect: (userId: string, username: string | null, name: string | null, image: string | null) => void;
  disconnect: () => void;
}

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  isConnected: false,
  isAuthenticated: false,

  connect: (userId, username, name, image) => {
    const existing = get().socket;
    if (existing?.connected) {
      // Already connected, just re-auth
      existing.emit("lobby:auth", { userId, username, name, image });
      set({ isAuthenticated: true });
      return;
    }

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";
    const socket = io(wsUrl, { transports: ["websocket"] });

    socket.on("connect", () => {
      console.log("🔌 Socket connected:", socket.id);
      set({ isConnected: true });

      // Authenticate for lobby features
      socket.emit("lobby:auth", { userId, username, name, image });
      set({ isAuthenticated: true });
    });

    socket.on("disconnect", () => {
      console.log("🔌 Socket disconnected");
      set({ isConnected: false, isAuthenticated: false });
    });

    set({ socket });
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.disconnect();
      set({ socket: null, isConnected: false, isAuthenticated: false });
    }
  },
}));
