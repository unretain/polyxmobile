// ColdStick NFC Wallet Utilities
import { Keypair } from "@solana/web3.js";
import * as bip39 from "bip39";
import { derivePath } from "ed25519-hd-key";
import bs58 from "bs58";

// NFC Payload structure
export interface ColdStickPayload {
  v: number; // version
  pub: string; // public key (base58)
  enc: string; // encrypted secret key (base64)
  alg: string; // encryption algorithm
  salt: string; // salt for key derivation (base64)
  iv: string; // initialization vector (base64)
  ts: number; // timestamp
  label?: string; // optional wallet label
}

// Saved wallet reference (stored locally, no secret material)
export interface SavedColdStick {
  id: string;
  publicKey: string;
  label: string;
  createdAt: number;
  lastUsed?: number;
}

// Convert string to Uint8Array
function stringToUint8Array(str: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(str);
}

// Convert Uint8Array to base64
function uint8ArrayToBase64(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr));
}

// Convert base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Derive encryption key from passphrase using PBKDF2
async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    stringToUint8Array(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Encrypt secret key with passphrase (AES-256-GCM)
export async function encryptSecretKey(
  secretKey: Uint8Array,
  passphrase: string
): Promise<{ encrypted: string; salt: string; iv: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new Uint8Array(secretKey)
  );

  return {
    encrypted: uint8ArrayToBase64(new Uint8Array(encrypted)),
    salt: uint8ArrayToBase64(salt),
    iv: uint8ArrayToBase64(iv),
  };
}

// Decrypt secret key with passphrase
export async function decryptSecretKey(
  encryptedData: string,
  salt: string,
  iv: string,
  passphrase: string
): Promise<Uint8Array> {
  const key = await deriveKey(passphrase, base64ToUint8Array(salt));

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToUint8Array(iv) },
    key,
    base64ToUint8Array(encryptedData)
  );

  return new Uint8Array(decrypted);
}

// Generate new Solana keypair
export function generateKeypair(): { publicKey: string; secretKey: Uint8Array } {
  const keypair = Keypair.generate();
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: keypair.secretKey,
  };
}

// Generate keypair from mnemonic (for recovery)
export function keypairFromMnemonic(mnemonic: string): { publicKey: string; secretKey: Uint8Array } {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString("hex")).key;
  const keypair = Keypair.fromSeed(derivedSeed);
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: keypair.secretKey,
  };
}

// Reconstruct keypair from secret key
export function keypairFromSecretKey(secretKey: Uint8Array): Keypair {
  return Keypair.fromSecretKey(secretKey);
}

// Create NFC payload for writing to tag
export function createNfcPayload(
  publicKey: string,
  encryptedKey: string,
  salt: string,
  iv: string,
  label?: string
): ColdStickPayload {
  return {
    v: 1,
    pub: publicKey,
    enc: encryptedKey,
    alg: "aes-256-gcm",
    salt,
    iv,
    ts: Date.now(),
    label,
  };
}

// Parse NFC payload from tag
export function parseNfcPayload(data: string): ColdStickPayload | null {
  try {
    const payload = JSON.parse(data);
    if (payload.v && payload.pub && payload.enc && payload.alg) {
      return payload as ColdStickPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// Validate Solana address
export function isValidSolanaAddress(address: string): boolean {
  try {
    const decoded = bs58.decode(address);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

// Securely wipe array from memory
export function wipeArray(arr: Uint8Array): void {
  crypto.getRandomValues(arr); // Overwrite with random data
  arr.fill(0); // Then zero out
}
