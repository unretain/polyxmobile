import { Keypair } from "@solana/web3.js";
import * as bip39 from "bip39";
import { derivePath } from "ed25519-hd-key";

/**
 * Generate a new wallet with 12-word mnemonic
 */
export function generateWalletWithMnemonic(): {
  mnemonic: string;
  publicKey: string;
  secretKey: Uint8Array;
} {
  // Generate 12-word mnemonic (128 bits of entropy)
  const mnemonic = bip39.generateMnemonic(128);

  // Derive keypair from mnemonic
  const { publicKey, secretKey } = deriveKeypairFromMnemonic(mnemonic);

  return {
    mnemonic,
    publicKey,
    secretKey,
  };
}

/**
 * Derive Solana keypair from mnemonic using standard derivation path
 */
export function deriveKeypairFromMnemonic(mnemonic: string): {
  publicKey: string;
  secretKey: Uint8Array;
} {
  // Validate mnemonic
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error("Invalid mnemonic phrase");
  }

  // Convert mnemonic to seed
  const seed = bip39.mnemonicToSeedSync(mnemonic);

  // Use Solana's standard derivation path: m/44'/501'/0'/0'
  const derivationPath = "m/44'/501'/0'/0'";
  const derivedSeed = derivePath(derivationPath, seed.toString("hex")).key;

  // Create keypair from derived seed
  const keypair = Keypair.fromSeed(derivedSeed);

  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: keypair.secretKey,
  };
}

/**
 * Validate a mnemonic phrase
 */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic.trim().toLowerCase());
}

/**
 * Format mnemonic for display (split into numbered words)
 */
export function formatMnemonicForDisplay(mnemonic: string): string[] {
  return mnemonic.trim().split(/\s+/);
}
