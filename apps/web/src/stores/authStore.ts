import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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

// Storage key constant
const AUTH_STORAGE_KEY = "polyx-auth";

// Debug logging helper
const logAuth = (action: string, data?: unknown) => {
  console.log(`[AUTH] ${action}`, data ?? "");
  if (typeof window !== "undefined") {
    console.log(`[AUTH] sessionStorage:`, sessionStorage.getItem(AUTH_STORAGE_KEY));
    console.log(`[AUTH] localStorage:`, localStorage.getItem(AUTH_STORAGE_KEY));
  }
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: true,

      login: async (email: string, password: string) => {
        logAuth("login attempt", { email });
        if (email && password) {
          const user: User = {
            id: crypto.randomUUID(),
            email,
            name: email.split("@")[0],
          };
          set({ user, isAuthenticated: true, isLoading: false });
          logAuth("login success", user);
          return true;
        }
        logAuth("login failed - missing credentials");
        return false;
      },

      logout: () => {
        logAuth("logout called");
        set({ user: null, isAuthenticated: false, isLoading: false });
        // Clear persisted storage to prevent rehydration after logout
        if (typeof window !== "undefined") {
          logAuth("clearing storage...");
          sessionStorage.removeItem(AUTH_STORAGE_KEY);
          localStorage.removeItem(AUTH_STORAGE_KEY);
          // Also clear any NextAuth session cookies
          document.cookie.split(";").forEach((c) => {
            document.cookie = c
              .replace(/^ +/, "")
              .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
          });
          logAuth("storage cleared");
        }
      },

      checkAuth: () => {
        const state = get();
        logAuth("checkAuth", { user: state.user, isAuthenticated: state.isAuthenticated });
        set({ isLoading: false, isAuthenticated: !!state.user });
      },

      setUser: (user: User) => {
        logAuth("setUser", user);
        set({ user, isAuthenticated: true, isLoading: false });
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      // Use sessionStorage instead of localStorage for security
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        // Custom storage that logs operations
        return {
          getItem: (name: string) => {
            const value = sessionStorage.getItem(name);
            logAuth(`storage.getItem(${name})`, value ? JSON.parse(value) : null);
            return value;
          },
          setItem: (name: string, value: string) => {
            logAuth(`storage.setItem(${name})`, JSON.parse(value));
            sessionStorage.setItem(name, value);
          },
          removeItem: (name: string) => {
            logAuth(`storage.removeItem(${name})`);
            sessionStorage.removeItem(name);
          },
        };
      }),
      onRehydrateStorage: () => {
        logAuth("onRehydrateStorage - starting rehydration");
        return (state, error) => {
          if (error) {
            logAuth("rehydration error", error);
          } else if (state) {
            logAuth("rehydration complete", { user: state.user, isAuthenticated: state.isAuthenticated });
            state.isLoading = false;
            state.isAuthenticated = !!state.user;
          } else {
            logAuth("rehydration - no state found");
          }
        };
      },
    }
  )
);
