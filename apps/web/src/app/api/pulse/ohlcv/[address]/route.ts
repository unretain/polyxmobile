import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getConnection } from "@/lib/solana-data";
import { PUMP_FUN_PROGRAM, RAYDIUM_AMM_PROGRAM } from "@/lib/pumpfun-monitor";

// Solana address validation
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// OHLCV interface
interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Trade from on-chain
interface Trade {
  timestamp: number;
  price: number;
  amount: number;
  side: "buy" | "sell";
}

// Cache for OHLCV data (per token, 30 second TTL)
const ohlcvCache = new Map<string, { data: OHLCV[]; timestamp: number }>();
const CACHE_TTL = 30000;

/**
 * Parse swap transaction to extract trade data
 */
function parseSwapTransaction(logs: string[], preBalances: number[], postBalances: number[]): Trade | null {
  try {
    // Look for swap-related logs
    const hasSwap = logs.some(log =>
      log.includes("Swap") ||
      log.includes("swap") ||
      log.includes("Buy") ||
      log.includes("Sell")
    );

    if (!hasSwap) return null;

    // Estimate price from SOL balance change
    // This is simplified - real implementation would parse instruction data
    const solChange = Math.abs((postBalances[0] || 0) - (preBalances[0] || 0)) / 1e9;

    if (solChange < 0.0001) return null; // Too small, probably not a swap

    // Determine side from balance change direction
    const side = (postBalances[0] || 0) > (preBalances[0] || 0) ? "sell" : "buy";

    return {
      timestamp: Date.now(),
      price: solChange, // Price in SOL (simplified)
      amount: solChange,
      side,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch trades from chain for a token
 */
async function fetchTrades(connection: Connection, mint: string, limit = 100): Promise<Trade[]> {
  const trades: Trade[] = [];

  try {
    const mintPubkey = new PublicKey(mint);

    // Get recent transactions involving this mint
    const signatures = await connection.getSignaturesForAddress(
      mintPubkey,
      { limit },
      "confirmed"
    );

    // Process in batches
    const batchSize = 10;
    for (let i = 0; i < signatures.length; i += batchSize) {
      const batch = signatures.slice(i, i + batchSize);

      const txPromises = batch.map(async (sig) => {
        try {
          const tx = await connection.getTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });

          if (!tx?.meta?.logMessages) return null;

          // Check if this is a swap transaction
          const isPumpSwap = tx.meta.logMessages.some(log =>
            log.includes(PUMP_FUN_PROGRAM.toBase58())
          );
          const isRaydiumSwap = tx.meta.logMessages.some(log =>
            log.includes(RAYDIUM_AMM_PROGRAM.toBase58())
          );

          if (!isPumpSwap && !isRaydiumSwap) return null;

          const trade = parseSwapTransaction(
            tx.meta.logMessages,
            tx.meta.preBalances,
            tx.meta.postBalances
          );

          if (trade) {
            trade.timestamp = (sig.blockTime || 0) * 1000;
          }

          return trade;
        } catch {
          return null;
        }
      });

      const results = await Promise.all(txPromises);
      trades.push(...results.filter((t): t is Trade => t !== null));

      // Small delay between batches
      if (i + batchSize < signatures.length) {
        await new Promise(r => setTimeout(r, 50));
      }
    }
  } catch (error) {
    console.error(`[OHLCV] Error fetching trades for ${mint}:`, error);
  }

  return trades.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Aggregate trades into OHLCV candles
 */
function aggregateToOHLCV(trades: Trade[], intervalMs: number): OHLCV[] {
  if (trades.length === 0) return [];

  const candles: OHLCV[] = [];
  const now = Date.now();

  // Group trades by interval
  const intervals = new Map<number, Trade[]>();

  for (const trade of trades) {
    const intervalStart = Math.floor(trade.timestamp / intervalMs) * intervalMs;
    const existing = intervals.get(intervalStart) || [];
    existing.push(trade);
    intervals.set(intervalStart, existing);
  }

  // Convert to OHLCV
  const sortedIntervals = Array.from(intervals.keys()).sort((a, b) => a - b);

  let lastClose = 0;

  for (const intervalStart of sortedIntervals) {
    const intervalTrades = intervals.get(intervalStart)!;
    const prices = intervalTrades.map(t => t.price);
    const volumes = intervalTrades.map(t => t.amount);

    const open = lastClose || prices[0];
    const close = prices[prices.length - 1];
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const volume = volumes.reduce((a, b) => a + b, 0);

    candles.push({
      timestamp: intervalStart,
      open,
      high,
      low,
      close,
      volume,
    });

    lastClose = close;
  }

  return candles;
}

/**
 * Get timeframe interval in milliseconds
 */
function getIntervalMs(timeframe: string): number {
  switch (timeframe) {
    case "1m":
    case "1min":
      return 60 * 1000;
    case "5m":
    case "5min":
      return 5 * 60 * 1000;
    case "15m":
    case "15min":
      return 15 * 60 * 1000;
    case "1h":
    case "1hour":
      return 60 * 60 * 1000;
    case "4h":
      return 4 * 60 * 60 * 1000;
    case "1d":
    case "1day":
      return 24 * 60 * 60 * 1000;
    default:
      return 60 * 1000; // Default 1 minute
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    // Validate address format
    if (!address || !SOLANA_ADDRESS_REGEX.test(address)) {
      return NextResponse.json(
        { error: "Invalid token address" },
        { status: 400 }
      );
    }

    const timeframe = req.nextUrl.searchParams.get("timeframe") || "1min";
    const cacheKey = `${address}-${timeframe}`;

    // Check cache
    const cached = ohlcvCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({
        address,
        timeframe,
        data: cached.data,
        source: "rpc",
        cached: true,
      }, {
        headers: {
          "Cache-Control": "public, max-age=30",
        },
      });
    }

    // Fetch trades from chain
    const connection = getConnection();
    const trades = await fetchTrades(connection, address, 200);

    // Aggregate to OHLCV
    const intervalMs = getIntervalMs(timeframe);
    const ohlcv = aggregateToOHLCV(trades, intervalMs);

    // Cache result
    ohlcvCache.set(cacheKey, { data: ohlcv, timestamp: Date.now() });

    return NextResponse.json({
      address,
      timeframe,
      data: ohlcv,
      source: "rpc",
      cached: false,
      tradesCount: trades.length,
    }, {
      headers: {
        "Cache-Control": "public, max-age=30",
      },
    });
  } catch (error) {
    console.error("[pulse/ohlcv] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch OHLCV data", data: [] },
      { status: 500 }
    );
  }
}
