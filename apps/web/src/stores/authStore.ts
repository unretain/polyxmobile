import { create } from "zustand";
import { persist } from "zustand/middleware";

interface User {
  id: string;
  email: string;
  name?: string;
  wallet?: string;
  twoFactorEnabled?: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => void;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: true,

      login: async (email: string, password: string) => {
        // Simple mock login - in production, this would call your API
        // For now, accept any email/password combo
        if (email && password) {
          const user: User = {
            id: crypto.randomUUID(),
            email,
            name: email.split("@")[0],
          };
          set({ user, isAuthenticated: true, isLoading: false });
          return true;
        }
        return false;
      },

      logout: () => {
        set({ user: null, isAuthenticated: false, isLoading: false });
      },

      checkAuth: () => {
        const state = get();
        set({ isLoading: false, isAuthenticated: !!state.user });
      },

      setUser: (user: User) => {
        set({ user, isAuthenticated: true, isLoading: false });
      },
    }),
    {
      name: "polyx-auth",
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isLoading = false;
          state.isAuthenticated = !!state.user;
        }
      },
    }
  )
);
