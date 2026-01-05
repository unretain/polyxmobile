import { create } from "zustand";

// Mobile app: Auth is handled via wallet stored in localStorage
// This store provides a logout helper that clears wallet state

interface AuthState {
  // Logout function - clears mobile wallet
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(() => ({
  logout: () => {
    // Clear mobile wallet storage
    if (typeof window !== "undefined") {
      localStorage.removeItem("polyx-mobile-wallet");
      // Clear any legacy storage
      sessionStorage.removeItem("polyx-auth");
      localStorage.removeItem("polyx-auth");
    }
  },
}));
