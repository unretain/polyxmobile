import bs58 from "bs58";

// Address helpers only. Wallets are non-custodial: keys are generated and held on
// the user's device (see mobileWallet.ts) — the server never creates, stores or
// decrypts a private key.

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
