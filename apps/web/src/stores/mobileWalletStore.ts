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
  storeMnemonic: (mnemonic: string) => void; // persist encrypted key immediately (at create/import)
  clearWallet: () => void;
  setHasHydrated: (state: boolean) => void;
  getMnemonic: () => Promise<string | null>; // Decrypt and get mnemonic for signing
}

// STABLE per-install key for at-rest obfuscation of the seed in localStorage. The
// seed already lives on this device; the XOR just avoids storing it in the clear.
// Previously the key was derived from navigator.userAgent — which changes on every
// browser update and silently locked users out of their own wallet. This random
// key is generated once and persisted, so it survives UA/browser changes.
const DEVICE_KEY_NAME = 'polyx-device-key';
const getStableKey = (): string => {
  if (typeof localStorage === 'undefined') return 'polyx-mobile-default-key-0000';
  let k = localStorage.getItem(DEVICE_KEY_NAME);
  if (!k) {
    const bytes = typeof crypto !== 'undefined' && crypto.getRandomValues
      ? crypto.getRandomValues(new Uint8Array(24))
      : new Uint8Array(24);
    k = 'pk-' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(DEVICE_KEY_NAME, k);
  }
  return k;
};
// Legacy UA-derived key — used ONLY to migrate wallets encrypted before the switch.
const getLegacyKey = (): string => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'default';
  return `polyx-mobile-${ua.slice(0, 32)}`;
};

const xorCipher = (input: string, key: string): string => {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    out += String.fromCharCode(input.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return out;
};

// A decoded blob is only accepted if it looks like a real BIP39 phrase. This
// guards the legacy-key fallback: a wrong key yields garbage, and using a garbage
// "mnemonic" would derive a different wallet and could send funds astray.
const looksLikeMnemonic = (s: string): boolean => {
  const words = s.trim().split(/\s+/);
  return (words.length === 12 || words.length === 24) && words.every((w) => /^[a-z]+$/.test(w));
};

// Always encrypt with the stable key.
const encryptMnemonic = (mnemonic: string): string => {
  return btoa(xorCipher(btoa(mnemonic), getStableKey()));
};

// Try the stable key, then the legacy UA key (migration). Returns the phrase only
// if it decodes to a valid-looking mnemonic — otherwise null.
const decryptMnemonic = (encrypted: string): string | null => {
  for (const key of [getStableKey(), getLegacyKey()]) {
    try {
      const phrase = atob(xorCipher(atob(encrypted), key));
      if (looksLikeMnemonic(phrase)) return phrase;
    } catch {
      // wrong key produced non-base64 — try the next
    }
  }
  return null;
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
      // Persist the encrypted mnemonic on the wallet RIGHT AWAY (at create/import),
      // so getMnemonic() — and therefore client-side signing — works even if the
      // user never completes the backup-verify step. Without this, buys fall back
      // to the (session-only) server path and fail with "Authentication required".
      storeMnemonic: (mnemonic) => set((state) => ({
        wallet: state.wallet
          ? { ...state.wallet, encryptedMnemonic: encryptMnemonic(mnemonic) }
          : state.wallet,
      })),
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
          const phrase = decryptMnemonic(state.wallet.encryptedMnemonic);
          if (!phrase) return null;
          // Migrate: if it was stored under the legacy UA key, re-encrypt with the
          // stable key so the next browser update doesn't lock the wallet again.
          const reEncrypted = encryptMnemonic(phrase);
          if (reEncrypted !== state.wallet.encryptedMnemonic) {
            set((s) => ({
              wallet: s.wallet ? { ...s.wallet, encryptedMnemonic: reEncrypted } : s.wallet,
            }));
          }
          return phrase;
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
