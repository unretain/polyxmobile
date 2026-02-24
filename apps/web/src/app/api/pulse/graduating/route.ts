/**
 * Graduating Pump.fun tokens via Yellowstone gRPC
 * Tokens with high trading activity (near graduation)
 */

import { NextResponse } from "next/server";

// gRPC config
const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT || "";
const GRPC_TOKEN = process.env.GRPC_TOKEN || "";

const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// Track token activity
const tokenActivity: Map<string, { txCount: number; lastSeen: number }> = new Map();
const graduatingCache: Map<string, any> = new Map();
let grpcInitialized = false;
let grpcStream: any = null;

async function initGrpcStream() {
  if (grpcInitialized || !GRPC_ENDPOINT || !GRPC_TOKEN) return;

  try {
    const { default: Client, CommitmentLevel } = await import(
      "@triton-one/yellowstone-grpc"
    );
    const { PublicKey } = await import("@solana/web3.js");

    console.log(`[gRPC graduating] Connecting...`);

    const client = new Client(GRPC_ENDPOINT, GRPC_TOKEN, {
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

          // Track buy/sell activity
          if (logsStr.includes("Buy") || logsStr.includes("Sell") || logsStr.includes("Swap")) {
            for (const account of accountKeys) {
              if (account === PUMP_FUN_PROGRAM) continue;
              if (account === "11111111111111111111111111111111") continue;
              if (account === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") continue;

              const activity = tokenActivity.get(account) || { txCount: 0, lastSeen: 0 };
              activity.txCount++;
              activity.lastSeen = Date.now();
              tokenActivity.set(account, activity);

              // High activity = likely graduating
              if (activity.txCount >= 30 && !graduatingCache.has(account)) {
                graduatingCache.set(account, {
                  address: account,
                  symbol: account.slice(0, 4).toUpperCase(),
                  name: `Token ${account.slice(0, 8)}`,
                  logoUri: null,
                  price: 0,
                  marketCap: 50000,
                  txCount: activity.txCount,
                  createdAt: Date.now(),
                  source: "pump.fun",
                  complete: false,
                  progress: 75,
                });
                console.log(`[gRPC] Graduating: ${account} (${activity.txCount} txs)`);
              }
            }
          }
        }
      } catch (e) {
        console.error("[gRPC graduating] Error:", e);
      }
    });

    grpcStream.on("error", (err: Error) => {
      console.error("[gRPC graduating] Error:", err.message);
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
    console.log("[gRPC graduating] Connected");
  } catch (error) {
    console.error("[gRPC graduating] Init failed:", error);
    throw error;
  }
}

export async function GET() {
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

  const tokens = Array.from(graduatingCache.values())
    .sort((a, b) => b.txCount - a.txCount)
    .slice(0, 20);

  return NextResponse.json({
    data: tokens,
    sources: ["grpc"],
    realtime: grpcInitialized,
  });
}
