import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export interface GeneratedWallet {
  publicKey: string;
  secretKey: string; // Base58 encoded
  mnemonic?: string;
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
