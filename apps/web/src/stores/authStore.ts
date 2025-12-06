import { create } from "zustand";

// This store is DEPRECATED - use NextAuth's useSession() instead
// Keeping minimal interface for backwards compatibility during migration
// Auth is now handled entirely by NextAuth cookies - no client-side persistence

interface AuthState {
  // Legacy logout function - calls NextAuth signOut
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(() => ({
  logout: () => {
    // Clear any legacy storage from old implementation
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("polyx-auth");
      localStorage.removeItem("polyx-auth");
    }
  },
}));
