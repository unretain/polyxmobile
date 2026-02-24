/**
 * Pulse data via Solana RPC
 * Parses Pump.fun transactions to build new pairs + OHLCV
 */

import { Connection, PublicKey, ParsedTransactionWithMeta } from "@solana/web3.js";

// RPC config
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

// Program IDs
const PUMP_FUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const RAYDIUM_AMM = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");

// Connection singleton
let connection: Connection | null = null;
function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(RPC_URL, { commitment: "confirmed" });
  }
  return connection;
}

// Token data
export interface PulseToken {
  address: string;
  symbol: string;
  name: string;
  logoUri: string | null;
  price: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  txCount: number;
  createdAt: number;
  source: string;
  complete: boolean;
  progress: number;
}

// OHLCV candle
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Trade data
interface Trade {
  timestamp: number;
  price: number;
  amount: number;
  side: "buy" | "sell";
  signature: string;
}

// Caches
const tokenCache = new Map<string, PulseToken>();
const tradeCache = new Map<string, Trade[]>(); // mint -> trades
const candleCache = new Map<string, Candle[]>(); // mint -> candles

/**
 * Fetch new Pump.fun token launches
 */
export async function fetchNewPairs(limit = 50): Promise<PulseToken[]> {
  const conn = getConnection();

  console.log("[Pulse] Fetching new pairs from RPC...");

  const signatures = await conn.getSignaturesForAddress(PUMP_FUN_PROGRAM, {
    limit: 200,
  });

  const newTokens: PulseToken[] = [];

  for (const sig of signatures) {
    if (newTokens.length >= limit) break;
    if (tokenCache.has(sig.signature)) continue;

    try {
      const tx = await conn.getParsedTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx?.meta || tx.meta.err) continue;

      const logs = tx.meta.logMessages || [];
      const logsStr = logs.join(" ");

      // Look for token creation
      if (logsStr.includes("Create") && logsStr.includes("mint")) {
        const mint = extractMintFromTx(tx);
        if (mint && !tokenCache.has(mint)) {
          const token: PulseToken = {
            address: mint,
            symbol: mint.slice(0, 4).toUpperCase(),
            name: `Token ${mint.slice(0, 8)}`,
            logoUri: null,
            price: 0,
            priceChange24h: 0,
            volume24h: 0,
            liquidity: 0,
            marketCap: 0,
            txCount: 0,
            createdAt: (sig.blockTime || Math.floor(Date.now() / 1000)) * 1000,
            source: "pump.fun",
            complete: false,
            progress: 0,
          };

          tokenCache.set(mint, token);
          newTokens.push(token);
        }
      }
    } catch (e) {
      continue;
    }
  }

  // Return all cached tokens sorted by creation time
  return Array.from(tokenCache.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/**
 * Fetch graduating tokens (high activity, near $69k market cap)
 */
export async function fetchGraduating(limit = 20): Promise<PulseToken[]> {
  const conn = getConnection();

  const signatures = await conn.getSignaturesForAddress(PUMP_FUN_PROGRAM, {
    limit: 500,
  });

  // Count activity per token
  const activityCount = new Map<string, number>();

  for (const sig of signatures) {
    try {
      const tx = await conn.getParsedTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx?.meta || tx.meta.err) continue;

      const logs = tx.meta.logMessages || [];
      const logsStr = logs.join(" ");

      // Count buys/sells
      if (logsStr.includes("Buy") || logsStr.includes("Sell")) {
        const mint = extractMintFromTx(tx);
        if (mint) {
          activityCount.set(mint, (activityCount.get(mint) || 0) + 1);
        }
      }
    } catch (e) {
      continue;
    }
  }

  // Get tokens with highest activity (likely graduating)
  const graduating = Array.from(activityCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([mint, txCount]) => {
      const existing = tokenCache.get(mint);
      return {
        address: mint,
        symbol: existing?.symbol || mint.slice(0, 4).toUpperCase(),
        name: existing?.name || `Token ${mint.slice(0, 8)}`,
        logoUri: null,
        price: 0,
        priceChange24h: 0,
        volume24h: 0,
        liquidity: 0,
        marketCap: 50000, // Estimated
        txCount,
        createdAt: existing?.createdAt || Date.now(),
        source: "pump.fun",
        complete: false,
        progress: 75,
      };
    });

  return graduating;
}

/**
 * Fetch graduated tokens (migrated to Raydium)
 */
export async function fetchGraduated(limit = 20): Promise<PulseToken[]> {
  const conn = getConnection();

  const signatures = await conn.getSignaturesForAddress(RAYDIUM_AMM, {
    limit: 100,
  });

  const graduated: PulseToken[] = [];

  for (const sig of signatures) {
    if (graduated.length >= limit) break;

    try {
      const tx = await conn.getParsedTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx?.meta || tx.meta.err) continue;

      const logs = tx.meta.logMessages || [];
      const logsStr = logs.join(" ");

      // Look for pool initialization (graduation)
      if (logsStr.includes("Initialize") || logsStr.includes("init")) {
        const mint = extractMintFromTx(tx);
        if (mint) {
          graduated.push({
            address: mint,
            symbol: mint.slice(0, 4).toUpperCase(),
            name: `Token ${mint.slice(0, 8)}`,
            logoUri: null,
            price: 0,
            priceChange24h: 0,
            volume24h: 0,
            liquidity: 0,
            marketCap: 69000,
            txCount: 0,
            createdAt: (sig.blockTime || Math.floor(Date.now() / 1000)) * 1000,
            source: "pump.fun",
            complete: true,
            progress: 100,
          });
        }
      }
    } catch (e) {
      continue;
    }
  }

  return graduated;
}

/**
 * Fetch trades and build OHLCV for a token
 */
export async function fetchOHLCV(
  mint: string,
  interval: "1m" | "5m" | "15m" | "1h" | "4h" | "1d" = "5m",
  limit = 100
): Promise<Candle[]> {
  const conn = getConnection();
  const mintPubkey = new PublicKey(mint);

  // Get recent transactions for this token
  const signatures = await conn.getSignaturesForAddress(mintPubkey, {
    limit: 500,
  });

  const trades: Trade[] = [];

  for (const sig of signatures) {
    try {
      const tx = await conn.getParsedTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx?.meta || tx.meta.err) continue;

      const trade = extractTradeFromTx(tx, mint);
      if (trade) {
        trades.push({
          ...trade,
          timestamp: (sig.blockTime || Math.floor(Date.now() / 1000)) * 1000,
          signature: sig.signature,
        });
      }
    } catch (e) {
      continue;
    }
  }

  // Cache trades
  tradeCache.set(mint, trades);

  // Build candles from trades
  const candles = buildCandles(trades, interval, limit);
  candleCache.set(mint, candles);

  return candles;
}

/**
 * Extract mint address from transaction
 */
function extractMintFromTx(tx: ParsedTransactionWithMeta): string | null {
  const accounts = tx.transaction.message.accountKeys;

  for (const acc of accounts) {
    const pubkey = acc.pubkey.toBase58();

    // Skip known programs
    if (pubkey === PUMP_FUN_PROGRAM.toBase58()) continue;
    if (pubkey === RAYDIUM_AMM.toBase58()) continue;
    if (pubkey === "11111111111111111111111111111111") continue;
    if (pubkey === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") continue;
    if (pubkey === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL") continue;
    if (pubkey === "SysvarRent111111111111111111111111111111111") continue;
    if (pubkey === "ComputeBudget111111111111111111111111111111") continue;

    // Likely a token mint
    return pubkey;
  }

  return null;
}

/**
 * Extract trade data from swap transaction
 */
function extractTradeFromTx(
  tx: ParsedTransactionWithMeta,
  mint: string
): Omit<Trade, "timestamp" | "signature"> | null {
  const preBalances = tx.meta?.preTokenBalances || [];
  const postBalances = tx.meta?.postTokenBalances || [];

  // Find token balance changes
  let tokenChange = 0;
  let solChange = 0;

  for (const post of postBalances) {
    if (post.mint === mint) {
      const pre = preBalances.find(
        (p) => p.accountIndex === post.accountIndex && p.mint === mint
      );
      const preAmount = pre?.uiTokenAmount?.uiAmount || 0;
      const postAmount = post.uiTokenAmount?.uiAmount || 0;
      tokenChange = postAmount - preAmount;
    }
  }

  // Get SOL change from lamport balances
  const preLamports = tx.meta?.preBalances || [];
  const postLamports = tx.meta?.postBalances || [];

  if (preLamports.length > 0 && postLamports.length > 0) {
    // First account is usually the payer
    solChange = (postLamports[0] - preLamports[0]) / 1e9;
  }

  if (tokenChange === 0 || solChange === 0) return null;

  // Calculate price (SOL per token)
  const price = Math.abs(solChange / tokenChange);
  const side = tokenChange > 0 ? "buy" : "sell";

  return {
    price,
    amount: Math.abs(tokenChange),
    side,
  };
}

/**
 * Build OHLCV candles from trades
 */
function buildCandles(
  trades: Trade[],
  interval: "1m" | "5m" | "15m" | "1h" | "4h" | "1d",
  limit: number
): Candle[] {
  if (trades.length === 0) return [];

  // Interval in ms
  const intervals: Record<string, number> = {
    "1m": 60 * 1000,
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
  };

  const intervalMs = intervals[interval];

  // Sort trades by time
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  // Group into candles
  const candleMap = new Map<number, Trade[]>();

  for (const trade of sortedTrades) {
    const candleTime = Math.floor(trade.timestamp / intervalMs) * intervalMs;
    const existing = candleMap.get(candleTime) || [];
    existing.push(trade);
    candleMap.set(candleTime, existing);
  }

  // Build candles
  const candles: Candle[] = [];

  for (const [timestamp, candleTrades] of candleMap) {
    const prices = candleTrades.map((t) => t.price);
    const volumes = candleTrades.map((t) => t.amount * t.price);

    candles.push({
      timestamp,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
      volume: volumes.reduce((a, b) => a + b, 0),
    });
  }

  // Sort by time descending and limit
  return candles.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

/**
 * Get cached token
 */
export function getCachedToken(mint: string): PulseToken | undefined {
  return tokenCache.get(mint);
}

/**
 * Get all cached tokens
 */
export function getAllCachedTokens(): PulseToken[] {
  return Array.from(tokenCache.values());
}
