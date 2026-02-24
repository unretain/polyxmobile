/**
 * Graduated Pump.fun tokens via Yellowstone gRPC
 * Tokens that migrated to Raydium
 */

import { NextResponse } from "next/server";

// gRPC config
const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT || "";
const GRPC_TOKEN = process.env.GRPC_TOKEN || "";

const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const RAYDIUM_AMM_PROGRAM = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

const graduatedCache: Map<string, any> = new Map();
let grpcInitialized = false;
let grpcStream: any = null;

async function initGrpcStream() {
  if (grpcInitialized || !GRPC_ENDPOINT || !GRPC_TOKEN) return;

  try {
    const { default: Client, CommitmentLevel } = await import(
      "@triton-one/yellowstone-grpc"
    );
    const { PublicKey } = await import("@solana/web3.js");

    console.log(`[gRPC graduated] Connecting...`);

    const client = new Client(GRPC_ENDPOINT, GRPC_TOKEN, {
      "grpc.max_receive_message_length": 64 * 1024 * 1024,
    });

    grpcStream = await client.subscribe();

    // Subscribe to both Pump.fun and Raydium for graduation detection
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
        raydium: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [RAYDIUM_AMM_PROGRAM],
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

          const isPumpFun = accountKeys.includes(PUMP_FUN_PROGRAM);
          const isRaydium = accountKeys.includes(RAYDIUM_AMM_PROGRAM);

          // Detect graduation
          const isGraduation =
            (isPumpFun && (logsStr.includes("Withdraw") || logsStr.includes("migrate"))) ||
            (isRaydium && logsStr.includes("Initialize"));

          if (isGraduation) {
            for (const account of accountKeys) {
              if (account === PUMP_FUN_PROGRAM) continue;
              if (account === RAYDIUM_AMM_PROGRAM) continue;
              if (account === "11111111111111111111111111111111") continue;
              if (account === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") continue;
              if (graduatedCache.has(account)) continue;

              graduatedCache.set(account, {
                address: account,
                symbol: account.slice(0, 4).toUpperCase(),
                name: `Token ${account.slice(0, 8)}`,
                logoUri: null,
                price: 0,
                marketCap: 69000,
                txCount: 0,
                createdAt: Date.now(),
                source: "pump.fun",
                complete: true,
                progress: 100,
                destination: isRaydium ? "raydium" : "pumpswap",
              });

              console.log(`[gRPC] Graduated: ${account}`);

              // Keep only last 50
              if (graduatedCache.size > 50) {
                const oldest = graduatedCache.keys().next().value;
                if (oldest) graduatedCache.delete(oldest);
              }
              break;
            }
          }
        }
      } catch (e) {
        console.error("[gRPC graduated] Error:", e);
      }
    });

    grpcStream.on("error", (err: Error) => {
      console.error("[gRPC graduated] Error:", err.message);
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
    console.log("[gRPC graduated] Connected");
  } catch (error) {
    console.error("[gRPC graduated] Init failed:", error);
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

  const tokens = Array.from(graduatedCache.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20);

  return NextResponse.json({
    data: tokens,
    sources: ["grpc"],
    realtime: grpcInitialized,
  });
}
