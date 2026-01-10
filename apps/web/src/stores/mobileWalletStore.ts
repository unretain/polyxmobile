import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface MobileWallet {
  publicKey: string;
  hasBackedUp: boolean;
  createdAt: number;
  // Encrypted mnemonic for signing transactions (encrypted with device-specific key)
  encryptedMnemonic?: string;
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
  getMnemonic: () => Promise<string | null>; // Decrypt and get mnemonic for signing
}

// Simple encryption key derived from device info (in production, use secure enclave)
const getEncryptionKey = (): string => {
  // Use a combination of factors for the key
  // In production, this should use iOS Keychain / Android Keystore
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'default';
  return `polyx-mobile-${ua.slice(0, 32)}`;
};

// Encrypt mnemonic using AES-like XOR (simple for now, upgrade to WebCrypto in production)
const encryptMnemonic = (mnemonic: string): string => {
  const key = getEncryptionKey();
  const encoded = btoa(mnemonic);
  let result = '';
  for (let i = 0; i < encoded.length; i++) {
    result += String.fromCharCode(encoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(result);
};

// Decrypt mnemonic
const decryptMnemonic = (encrypted: string): string => {
  const key = getEncryptionKey();
  const decoded = atob(encrypted);
  let result = '';
  for (let i = 0; i < decoded.length; i++) {
    result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return atob(result);
};

export const useMobileWalletStore = create<MobileWalletState>()(
  persist(
    (set, get) => ({
      wallet: null,
      pendingMnemonic: null, // Never persisted
      isOnboarding: false,
      _hasHydrated: false,

      setWallet: (wallet) => set({ wallet }),
      setPendingMnemonic: (mnemonic) => set({ pendingMnemonic: mnemonic }),
      setOnboarding: (isOnboarding) => set({ isOnboarding }),
      confirmBackup: () => set((state) => {
        // Encrypt and store the mnemonic before clearing pending
        const encrypted = state.pendingMnemonic ? encryptMnemonic(state.pendingMnemonic) : undefined;
        return {
          wallet: state.wallet ? {
            ...state.wallet,
            hasBackedUp: true,
            encryptedMnemonic: encrypted || state.wallet.encryptedMnemonic,
          } : null,
          pendingMnemonic: null, // Clear plaintext mnemonic
          isOnboarding: false,
        };
      }),
      clearWallet: () => set({ wallet: null, pendingMnemonic: null, isOnboarding: false }),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
      getMnemonic: async () => {
        const state = get();
        // First check pending mnemonic (during onboarding)
        if (state.pendingMnemonic) {
          return state.pendingMnemonic;
        }
        // Then check encrypted mnemonic
        if (state.wallet?.encryptedMnemonic) {
          try {
            return decryptMnemonic(state.wallet.encryptedMnemonic);
          } catch {
            return null;
          }
        }
        return null;
      },
    }),
    {
      name: "polyx-mobile-wallet",
      partialize: (state) => ({
        wallet: state.wallet, // This now includes encryptedMnemonic
        // Never persist pendingMnemonic (plaintext), onboarding, or hydration state
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
