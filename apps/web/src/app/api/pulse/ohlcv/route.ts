/**
 * OHLCV candle data via Yellowstone gRPC
 * Streams trades and builds candles in real-time
 */

import { NextRequest, NextResponse } from "next/server";

// gRPC config
const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT || "";
const GRPC_TOKEN = process.env.GRPC_TOKEN || "";

const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// Trade tracking
interface Trade {
  timestamp: number;
  price: number;
  amount: number;
  side: "buy" | "sell";
}

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Per-token trade cache
const tradeCache: Map<string, Trade[]> = new Map();
const candleCache: Map<string, Candle[]> = new Map();
let grpcInitialized = false;
let grpcStream: any = null;

async function initGrpcStream() {
  // Token optional - Corvus trial is IP-whitelisted
  if (grpcInitialized || !GRPC_ENDPOINT) return;

  try {
    const { default: Client, CommitmentLevel } = await import(
      "@triton-one/yellowstone-grpc"
    );
    const { PublicKey } = await import("@solana/web3.js");

    console.log(`[gRPC ohlcv] Connecting...`);

    const client = new Client(GRPC_ENDPOINT, GRPC_TOKEN || undefined, {
      "grpc.max_receive_message_length": 64 * 1024 * 1024,
    });

    grpcStream = await client.subscribe();

    const request = {
      slots: {},
      accounts: {},
      transactions: {
        pumpfun: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [PUMP_FUN_PROGRAM],
          accountExclude: [],
          accountRequired: [],
        },
      },
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      commitment: CommitmentLevel.CONFIRMED,
      accountsDataSlice: [],
      ping: undefined,
    };

    grpcStream.on("data", async (update: any) => {
      try {
        if (update.transaction) {
          const tx = update.transaction.transaction;
          if (!tx) return;

          const meta = tx.meta;
          const message = tx.transaction?.message;
          if (!meta || !message) return;

          const accountKeys =
            message.accountKeys?.map((key: Uint8Array) =>
              new PublicKey(key).toBase58()
            ) || [];

          const logs = meta.logMessages || [];
          const logsStr = logs.join(" ");

          // Parse buy/sell trades
          if (logsStr.includes("Buy") || logsStr.includes("Sell")) {
            const side = logsStr.includes("Buy") ? "buy" : "sell";

            // Find token mint
            let mint: string | null = null;
            for (const account of accountKeys) {
              if (account === PUMP_FUN_PROGRAM) continue;
              if (account === "11111111111111111111111111111111") continue;
              if (account === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") continue;
              mint = account;
              break;
            }

            if (mint) {
              // Extract price from balance changes
              const preBalances = meta.preBalances || [];
              const postBalances = meta.postBalances || [];

              let solChange = 0;
              if (preBalances.length > 0 && postBalances.length > 0) {
                solChange = Math.abs(postBalances[0] - preBalances[0]) / 1e9;
              }

              // Estimate price (simplified)
              const price = solChange > 0 ? solChange * 150 : 0.0001; // Rough USD estimate

              const trade: Trade = {
                timestamp: Date.now(),
                price,
                amount: solChange,
                side,
              };

              // Add to cache
              const trades = tradeCache.get(mint) || [];
              trades.push(trade);

              // Keep last 1000 trades per token
              if (trades.length > 1000) {
                trades.shift();
              }

              tradeCache.set(mint, trades);

              // Update candles
              updateCandles(mint, trades);
            }
          }
        }
      } catch (e) {
        console.error("[gRPC ohlcv] Error:", e);
      }
    });

    grpcStream.on("error", (err: Error) => {
      console.error("[gRPC ohlcv] Error:", err.message);
      grpcInitialized = false;
    });

    grpcStream.on("end", () => {
      grpcInitialized = false;
    });

    await new Promise<void>((resolve, reject) => {
      grpcStream.write(request, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    grpcInitialized = true;
    console.log("[gRPC ohlcv] Connected");
  } catch (error) {
    console.error("[gRPC ohlcv] Init failed:", error);
    throw error;
  }
}

// Build candles from trades
function updateCandles(mint: string, trades: Trade[]) {
  const intervalMs = 5 * 60 * 1000; // 5 minute candles
  const candleMap = new Map<number, Trade[]>();

  for (const trade of trades) {
    const candleTime = Math.floor(trade.timestamp / intervalMs) * intervalMs;
    const existing = candleMap.get(candleTime) || [];
    existing.push(trade);
    candleMap.set(candleTime, existing);
  }

  const candles: Candle[] = [];
  for (const [timestamp, candleTrades] of candleMap) {
    const prices = candleTrades.map((t) => t.price);
    const volumes = candleTrades.map((t) => t.amount);

    candles.push({
      timestamp,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
      volume: volumes.reduce((a, b) => a + b, 0),
    });
  }

  candleCache.set(mint, candles.sort((a, b) => b.timestamp - a.timestamp));
}

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint");
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "100");

  if (!mint) {
    return NextResponse.json(
      { error: "mint parameter required", data: [] },
      { status: 400 }
    );
  }

  if (!grpcInitialized) {
    try {
      await initGrpcStream();
    } catch (error) {
      return NextResponse.json(
        { error: "gRPC connection failed", details: String(error), data: [] },
        { status: 500 }
      );
    }
  }

  const candles = candleCache.get(mint) || [];

  return NextResponse.json({
    data: candles.slice(0, limit),
    mint,
    interval: "5m",
    realtime: grpcInitialized,
    tradeCount: tradeCache.get(mint)?.length || 0,
  });
}
