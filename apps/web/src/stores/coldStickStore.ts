import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SavedColdStick } from "@/lib/coldstick";

interface ColdStickStore {
  // Saved wallet references (public keys only, no secrets)
  wallets: SavedColdStick[];

  // Currently active wallet (from last scan)
  activeWallet: SavedColdStick | null;

  // UI state
  isScanning: boolean;
  isWriting: boolean;
  error: string | null;

  // Actions
  addWallet: (wallet: SavedColdStick) => void;
  removeWallet: (id: string) => void;
  updateWalletLabel: (id: string, label: string) => void;
  setActiveWallet: (wallet: SavedColdStick | null) => void;
  updateLastUsed: (id: string) => void;
  setScanning: (scanning: boolean) => void;
  setWriting: (writing: boolean) => void;
  setError: (error: string | null) => void;
  getWalletByPublicKey: (publicKey: string) => SavedColdStick | undefined;
}

export const useColdStickStore = create<ColdStickStore>()(
  persist(
    (set, get) => ({
      wallets: [],
      activeWallet: null,
      isScanning: false,
      isWriting: false,
      error: null,

      addWallet: (wallet) => {
        const { wallets } = get();
        // Don't add duplicates
        if (wallets.some((w) => w.publicKey === wallet.publicKey)) {
          // Update existing
          set({
            wallets: wallets.map((w) =>
              w.publicKey === wallet.publicKey ? { ...w, ...wallet } : w
            ),
          });
        } else {
          set({ wallets: [wallet, ...wallets] });
        }
      },

      removeWallet: (id) => {
        const { wallets, activeWallet } = get();
        set({
          wallets: wallets.filter((w) => w.id !== id),
          activeWallet: activeWallet?.id === id ? null : activeWallet,
        });
      },

      updateWalletLabel: (id, label) => {
        const { wallets } = get();
        set({
          wallets: wallets.map((w) => (w.id === id ? { ...w, label } : w)),
        });
      },

      setActiveWallet: (wallet) => {
        set({ activeWallet: wallet });
        if (wallet) {
          get().updateLastUsed(wallet.id);
        }
      },

      updateLastUsed: (id) => {
        const { wallets } = get();
        set({
          wallets: wallets.map((w) =>
            w.id === id ? { ...w, lastUsed: Date.now() } : w
          ),
        });
      },

      setScanning: (scanning) => set({ isScanning: scanning }),
      setWriting: (writing) => set({ isWriting: writing }),
      setError: (error) => set({ error }),

      getWalletByPublicKey: (publicKey) => {
        return get().wallets.find((w) => w.publicKey === publicKey);
      },
    }),
    {
      name: "coldstick-store",
      partialize: (state) => ({
        wallets: state.wallets,
      }),
    }
  )
);
