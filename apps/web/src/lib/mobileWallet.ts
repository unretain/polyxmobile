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

/**
 * Encrypt a wallet public key using AES-256-GCM
 * Returns base64 encoded string: iv:ciphertext:tag
 */
export async function encryptWalletAddress(
  publicKey: string,
  encryptionKey: string
): Promise<string> {
  const encoder = new TextEncoder();

  // Derive a 256-bit key from the encryption key using SHA-256
  const keyData = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(encryptionKey)
  );

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  // Generate random IV (12 bytes for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(publicKey)
  );

  // Combine IV + ciphertext and encode as base64
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a wallet public key using AES-256-GCM
 */
export async function decryptWalletAddress(
  encrypted: string,
  encryptionKey: string
): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Derive the same key
  const keyData = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(encryptionKey)
  );

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  // Decode base64
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));

  // Extract IV (first 12 bytes) and ciphertext
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return decoder.decode(decrypted);
}
