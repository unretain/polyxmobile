import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import crypto from "crypto";

export interface GeneratedWallet {
  publicKey: string;
  secretKey: string; // Base58 encoded
  mnemonic?: string;
}

// Encryption for storing private keys in database
const ENCRYPTION_ALGORITHM = "aes-256-gcm";

/**
 * Encrypt a secret key for database storage
 * Uses AES-256-GCM with a key derived from the encryption secret
 */
export function encryptPrivateKey(secretKey: string, encryptionSecret: string): string {
  const key = crypto.scryptSync(encryptionSecret, "polyx-wallet-salt", 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  let encrypted = cipher.update(secretKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt a secret key from database storage
 */
export function decryptPrivateKey(encryptedData: string, encryptionSecret: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedData.split(":");
  const key = crypto.scryptSync(encryptionSecret, "polyx-wallet-salt", 32);
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Generate a wallet and return encrypted private key for storage
 */
export function generateWalletForUser(encryptionSecret: string): {
  publicKey: string;
  encryptedPrivateKey: string;
} {
  const wallet = generateSolanaWallet();
  const encryptedPrivateKey = encryptPrivateKey(wallet.secretKey, encryptionSecret);

  return {
    publicKey: wallet.publicKey,
    encryptedPrivateKey,
  };
}

/**
 * Generate a new Solana wallet keypair
 * Returns the public key and base58-encoded secret key
 */
export function generateSolanaWallet(): GeneratedWallet {
  const keypair = Keypair.generate();

  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: bs58.encode(keypair.secretKey),
  };
}

/**
 * Restore a wallet from a base58-encoded secret key
 */
export function restoreWalletFromSecret(secretKey: string): GeneratedWallet {
  const decoded = bs58.decode(secretKey);
  const keypair = Keypair.fromSecretKey(decoded);

  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: secretKey,
  };
}

/**
 * Validate a Solana public key
 */
export function isValidPublicKey(key: string): boolean {
  try {
    const decoded = bs58.decode(key);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

/**
 * Shorten a wallet address for display
 */
export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
