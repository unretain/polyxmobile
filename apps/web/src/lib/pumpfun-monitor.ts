/**
 * Pump.fun Real-time Monitor
 * Uses Solana RPC WebSocket subscriptions to detect:
 * - New token launches
 * - Tokens nearing graduation (bonding curve progress)
 * - Graduated/migrated tokens
 */

import { Connection, PublicKey, Logs } from "@solana/web3.js";
import { getConnection, getTokenMetadata, getTokenPrice } from "./solana-data";

// Pump.fun Program IDs
export const PUMP_FUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const PUMP_FUN_MINT_AUTHORITY = new PublicKey("TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM");

// Raydium AMM for detecting migrations
export const RAYDIUM_AMM_PROGRAM = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");

// PumpSwap (pump.fun's own AMM)
export const PUMP_SWAP_PROGRAM = new PublicKey("pswapFLqNDcx2z5LZzETzToaVWRshKQqKmaU4gMwiLm");

// Event types
export interface PumpFunToken {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  image?: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  creator?: string;
  bondingCurve?: string;
  timestamp: number;
  price?: number;
  marketCap?: number;
  progress?: number; // Bonding curve progress 0-100
}

export interface GraduationEvent {
  mint: string;
  bondingCurve: string;
  timestamp: number;
  destination: "raydium" | "pumpswap";
}

type NewTokenCallback = (token: PumpFunToken) => void;
type GraduatingCallback = (token: PumpFunToken) => void;
type GraduatedCallback = (event: GraduationEvent) => void;

// In-memory cache for tokens
const tokenCache = new Map<string, PumpFunToken>();
const bondingCurveProgress = new Map<string, number>();

// Graduation threshold (pump.fun graduates at ~$69k market cap / ~85 SOL in bonding curve)
const GRADUATION_THRESHOLD_PROGRESS = 85; // 85% of bonding curve filled

/**
 * Parse Pump.fun create instruction logs
 */
function parseCreateLog(logs: string[]): { mint?: string; name?: string; symbol?: string; uri?: string } | null {
  // Look for "Program log: mint:" pattern in logs
  for (const log of logs) {
    // Pump.fun logs contain token info in specific format
    if (log.includes("Program log: Create")) {
      // Extract mint from logs - format varies
      const mintMatch = logs.find(l => l.includes("mint:"));
      if (mintMatch) {
        const mint = mintMatch.split("mint:")[1]?.trim();
        return { mint };
      }
    }
  }
  return null;
}

/**
 * Check if logs indicate a token creation
 */
function isCreateInstruction(logs: string[]): boolean {
  return logs.some(log =>
    log.includes("Program log: Instruction: Create") ||
    log.includes("Program log: Initialize")
  );
}

/**
 * Check if logs indicate a migration/graduation
 */
function isMigrateInstruction(logs: string[]): boolean {
  return logs.some(log =>
    log.includes("Program log: Instruction: Withdraw") ||
    log.includes("migrate") ||
    log.includes("withdraw")
  );
}

/**
 * Extract accounts from transaction logs
 */
function extractAccountsFromLogs(logs: string[]): string[] {
  const accounts: string[] = [];
  for (const log of logs) {
    // Look for base58 addresses (32-44 chars)
    const matches = log.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
    if (matches) {
      accounts.push(...matches);
    }
  }
  return [...new Set(accounts)];
}

/**
 * PumpFunMonitor class
 * Manages WebSocket subscriptions and emits events
 */
export class PumpFunMonitor {
  private connection: Connection;
  private subscriptionId: number | null = null;
  private raydiumSubscriptionId: number | null = null;
  private isRunning = false;

  private onNewToken: NewTokenCallback | null = null;
  private onGraduating: GraduatingCallback | null = null;
  private onGraduated: GraduatedCallback | null = null;

  constructor() {
    this.connection = getConnection();
  }

  /**
   * Set callback for new token events
   */
  setNewTokenCallback(callback: NewTokenCallback) {
    this.onNewToken = callback;
  }

  /**
   * Set callback for graduating (near 85%) events
   */
  setGraduatingCallback(callback: GraduatingCallback) {
    this.onGraduating = callback;
  }

  /**
   * Set callback for graduated/migrated events
   */
  setGraduatedCallback(callback: GraduatedCallback) {
    this.onGraduated = callback;
  }

  /**
   * Start monitoring Pump.fun program
   * Uses HTTP polling since most RPCs don't support WebSocket
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log("[PumpFun Monitor] Starting HTTP polling mode...");

    // Use HTTP polling - more reliable across all RPCs
    this.startPolling();
    this.isRunning = true;
  }

  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Fallback: Poll for new tokens via HTTP
   * Note: Using longer interval (60s) to avoid rate limiting public RPC
   */
  private startPolling(): void {
    // Poll every 60 seconds to avoid rate limits on public RPC
    this.pollingInterval = setInterval(async () => {
      try {
        const tokens = await fetchRecentPumpFunTokens(10); // Reduced limit
        for (const token of tokens) {
          if (!tokenCache.has(token.mint)) {
            tokenCache.set(token.mint, token);
            if (this.onNewToken) {
              this.onNewToken(token);
            }
          }
        }
      } catch (error) {
        // Silent fail - don't spam console with rate limit errors
        if (error instanceof Error && !error.message.includes("429")) {
          console.error("[PumpFun Monitor] Polling error:", error);
        }
      }
    }, 60000);

    console.log("[PumpFun Monitor] HTTP polling started (60s interval)");
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log("[PumpFun Monitor] Stopping...");

    if (this.subscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
    }

    if (this.raydiumSubscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.raydiumSubscriptionId);
      this.raydiumSubscriptionId = null;
    }

    if (this.pollingInterval !== null) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    this.isRunning = false;
    console.log("[PumpFun Monitor] Stopped");
  }

  /**
   * Handle Pump.fun program logs
   */
  private async handlePumpFunLogs(logs: Logs): Promise<void> {
    const logMessages = logs.logs;

    // Check for new token creation
    if (isCreateInstruction(logMessages)) {
      await this.handleNewToken(logs);
    }

    // Check for graduation/migration
    if (isMigrateInstruction(logMessages)) {
      await this.handleGraduation(logs);
    }
  }

  /**
   * Handle Raydium logs for migration detection
   */
  private async handleRaydiumLogs(logs: Logs): Promise<void> {
    // Raydium pool initialization = token graduated from pump.fun
    const logMessages = logs.logs;

    if (logMessages.some(log => log.includes("Initialize"))) {
      // Extract token mint from logs
      const accounts = extractAccountsFromLogs(logMessages);

      // Check if any of these accounts are known pump.fun tokens
      for (const account of accounts) {
        if (tokenCache.has(account)) {
          const event: GraduationEvent = {
            mint: account,
            bondingCurve: "",
            timestamp: Date.now(),
            destination: "raydium",
          };

          if (this.onGraduated) {
            this.onGraduated(event);
          }

          // Remove from cache after graduation
          tokenCache.delete(account);
          bondingCurveProgress.delete(account);
        }
      }
    }
  }

  /**
   * Handle new token creation event
   */
  private async handleNewToken(logs: Logs): Promise<void> {
    try {
      // Extract mint address from transaction
      const accounts = extractAccountsFromLogs(logs.logs);

      // The first new account that's not a known program is likely the mint
      let mintAddress: string | null = null;
      for (const account of accounts) {
        // Skip known program addresses
        if (
          account === PUMP_FUN_PROGRAM.toBase58() ||
          account === PUMP_FUN_MINT_AUTHORITY.toBase58() ||
          account.length < 32
        ) {
          continue;
        }

        // Check if this could be a mint (validate format)
        try {
          new PublicKey(account);
          mintAddress = account;
          break;
        } catch {
          continue;
        }
      }

      if (!mintAddress) {
        return;
      }

      // Check if we already have this token
      if (tokenCache.has(mintAddress)) {
        return;
      }

      // Fetch metadata from chain
      const metadata = await getTokenMetadata(mintAddress);

      if (!metadata) {
        // Create minimal token if metadata fetch fails
        const token: PumpFunToken = {
          mint: mintAddress,
          name: "Unknown",
          symbol: "???",
          uri: "",
          timestamp: Date.now(),
          progress: 0,
        };

        tokenCache.set(mintAddress, token);

        if (this.onNewToken) {
          this.onNewToken(token);
        }
        return;
      }

      // Fetch price
      const price = await getTokenPrice(mintAddress);

      const token: PumpFunToken = {
        mint: mintAddress,
        name: metadata.name,
        symbol: metadata.symbol,
        uri: metadata.uri,
        image: metadata.image,
        description: metadata.description,
        twitter: metadata.twitter,
        telegram: metadata.telegram,
        website: metadata.website,
        timestamp: Date.now(),
        price: price || 0,
        progress: 0,
      };

      // Cache the token
      tokenCache.set(mintAddress, token);
      bondingCurveProgress.set(mintAddress, 0);

      // Emit event
      if (this.onNewToken) {
        this.onNewToken(token);
      }
    } catch (error) {
      console.error("[PumpFun Monitor] Error handling new token:", error);
    }
  }

  /**
   * Handle graduation event
   */
  private async handleGraduation(logs: Logs): Promise<void> {
    try {
      const accounts = extractAccountsFromLogs(logs.logs);

      // Find the token mint from cached tokens
      for (const account of accounts) {
        if (tokenCache.has(account)) {
          const event: GraduationEvent = {
            mint: account,
            bondingCurve: "",
            timestamp: Date.now(),
            destination: "pumpswap",
          };

          if (this.onGraduated) {
            this.onGraduated(event);
          }

          // Remove from cache
          tokenCache.delete(account);
          bondingCurveProgress.delete(account);
          return;
        }
      }
    } catch (error) {
      console.error("[PumpFun Monitor] Error handling graduation:", error);
    }
  }

  /**
   * Check bonding curve progress for a token
   */
  async checkBondingCurveProgress(mint: string): Promise<number> {
    // This would require parsing the bonding curve account
    // For now, estimate based on market cap
    const price = await getTokenPrice(mint);
    if (!price) return 0;

    // Pump.fun tokens have ~1B supply
    // Graduation happens at ~$69k market cap
    const estimatedMarketCap = price * 1_000_000_000;
    const progress = Math.min(100, (estimatedMarketCap / 69000) * 100);

    bondingCurveProgress.set(mint, progress);

    // If nearing graduation, emit graduating event
    if (progress >= GRADUATION_THRESHOLD_PROGRESS && this.onGraduating) {
      const token = tokenCache.get(mint);
      if (token) {
        this.onGraduating({ ...token, progress });
      }
    }

    return progress;
  }

  /**
   * Get all cached tokens
   */
  getCachedTokens(): PumpFunToken[] {
    return Array.from(tokenCache.values());
  }

  /**
   * Get cached token by mint
   */
  getCachedToken(mint: string): PumpFunToken | undefined {
    return tokenCache.get(mint);
  }

  /**
   * Check if monitor is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

// Singleton instance
let monitorInstance: PumpFunMonitor | null = null;

export function getPumpFunMonitor(): PumpFunMonitor {
  if (!monitorInstance) {
    monitorInstance = new PumpFunMonitor();
  }
  return monitorInstance;
}

/**
 * Fetch recent pump.fun tokens (HTTP fallback when WebSocket isn't available)
 * Uses getSignaturesForAddress + getTransaction to find recent creates
 * Note: Optimized for public RPC rate limits
 */
export async function fetchRecentPumpFunTokens(limit = 20): Promise<PumpFunToken[]> {
  const connection = getConnection();
  const tokens: PumpFunToken[] = [];

  try {
    // Get recent transactions for Pump.fun program
    // Reduced limit to avoid rate limits
    const signatures = await connection.getSignaturesForAddress(
      PUMP_FUN_PROGRAM,
      { limit: Math.min(limit * 2, 30) }, // Cap at 30 to reduce RPC calls
      "confirmed"
    );

    // Process transactions sequentially to avoid rate limits
    for (const sig of signatures) {
      if (tokens.length >= limit) break;

      try {
        // Add delay between each transaction fetch to avoid 429
        await new Promise(r => setTimeout(r, 500));

        const tx = await connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.meta?.logMessages) continue;

        // Check if this is a create instruction
        if (!isCreateInstruction(tx.meta.logMessages)) continue;

        // Extract accounts from transaction
        const accountKeys = tx.transaction.message.staticAccountKeys?.map(k => k.toBase58()) || [];

        // Find the mint (usually the 2nd or 3rd account after system accounts)
        let mintAddress: string | null = null;
        for (const account of accountKeys) {
          if (
            account !== PUMP_FUN_PROGRAM.toBase58() &&
            account !== PUMP_FUN_MINT_AUTHORITY.toBase58() &&
            account.length >= 32
          ) {
            try {
              new PublicKey(account);
              mintAddress = account;
              break;
            } catch {
              continue;
            }
          }
        }

        if (!mintAddress) continue;

        // Get metadata (with delay)
        await new Promise(r => setTimeout(r, 300));
        const metadata = await getTokenMetadata(mintAddress);
        if (!metadata) continue;

        // Get price from Jupiter (no RPC calls, different rate limit)
        const price = await getTokenPrice(mintAddress);

        tokens.push({
          mint: mintAddress,
          name: metadata.name,
          symbol: metadata.symbol,
          uri: metadata.uri,
          image: metadata.image,
          description: metadata.description,
          twitter: metadata.twitter,
          telegram: metadata.telegram,
          website: metadata.website,
          timestamp: (sig.blockTime || 0) * 1000,
          price: price || 0,
          progress: 0,
        });
      } catch (error) {
        // Skip this transaction if rate limited
        if (error instanceof Error && error.message.includes("429")) {
          await new Promise(r => setTimeout(r, 2000)); // Wait 2s on rate limit
        }
        continue;
      }
    }
  } catch (error) {
    // Return empty array on rate limit, let static fallback handle it
    if (error instanceof Error && !error.message.includes("429")) {
      console.error("[PumpFun] Error fetching recent tokens:", error);
    }
  }

  return tokens;
}
