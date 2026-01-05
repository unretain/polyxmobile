import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface MobileWallet {
  publicKey: string;
  hasBackedUp: boolean;
  createdAt: number;
}

interface MobileWalletState {
  wallet: MobileWallet | null;
  pendingMnemonic: string | null; // Only stored temporarily during onboarding
  isOnboarding: boolean;
  _hasHydrated: boolean; // Track hydration state

  // Actions
  setWallet: (wallet: MobileWallet) => void;
  setPendingMnemonic: (mnemonic: string | null) => void;
  setOnboarding: (isOnboarding: boolean) => void;
  confirmBackup: () => void;
  clearWallet: () => void;
  setHasHydrated: (state: boolean) => void;
}

export const useMobileWalletStore = create<MobileWalletState>()(
  persist(
    (set) => ({
      wallet: null,
      pendingMnemonic: null, // Never persisted
      isOnboarding: false,
      _hasHydrated: false,

      setWallet: (wallet) => set({ wallet }),
      setPendingMnemonic: (mnemonic) => set({ pendingMnemonic: mnemonic }),
      setOnboarding: (isOnboarding) => set({ isOnboarding }),
      confirmBackup: () => set((state) => ({
        wallet: state.wallet ? { ...state.wallet, hasBackedUp: true } : null,
        pendingMnemonic: null, // Clear mnemonic after backup confirmed
        isOnboarding: false,
      })),
      clearWallet: () => set({ wallet: null, pendingMnemonic: null, isOnboarding: false }),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: "polyx-mobile-wallet",
      partialize: (state) => ({
        wallet: state.wallet,
        // Never persist mnemonic, onboarding, or hydration state
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
