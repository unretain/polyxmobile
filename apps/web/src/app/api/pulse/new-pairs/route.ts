/**
 * New Pump.fun pairs via Yellowstone gRPC
 * Real-time streaming from Solana Vibe Station
 */

import { NextRequest, NextResponse } from "next/server";

// gRPC config
const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT || "";
const GRPC_TOKEN = process.env.GRPC_TOKEN || "";

// Pump.fun Program ID
const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// Token cache
const tokenCache: Map<string, any> = new Map();
let grpcInitialized = false;
let grpcStream: any = null;

async function initGrpcStream() {
  if (grpcInitialized || !GRPC_ENDPOINT || !GRPC_TOKEN) return;

  try {
    const { default: Client, CommitmentLevel } = await import(
      "@triton-one/yellowstone-grpc"
    );
    const { PublicKey } = await import("@solana/web3.js");

    console.log(`[gRPC] Connecting to ${GRPC_ENDPOINT}...`);
    console.log(`[gRPC] Using x-token: ${GRPC_TOKEN.slice(0, 8)}...`);

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

          const signature = Buffer.from(tx.signature).toString("base64");
          const meta = tx.meta;
          const message = tx.transaction?.message;

          if (!meta || !message) return;

          const accountKeys =
            message.accountKeys?.map((key: Uint8Array) =>
              new PublicKey(key).toBase58()
            ) || [];

          const logs = meta.logMessages || [];
          const logsStr = logs.join(" ");

          // Look for token creation
          if (logsStr.includes("Create") || logsStr.includes("Initialize")) {
            let mintAddress: string | null = null;
            for (const account of accountKeys) {
              if (account === PUMP_FUN_PROGRAM) continue;
              if (account === "11111111111111111111111111111111") continue;
              if (account === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") continue;
              if (tokenCache.has(account)) continue;
              mintAddress = account;
              break;
            }

            if (mintAddress) {
              const token = {
                address: mintAddress,
                symbol: mintAddress.slice(0, 4).toUpperCase(),
                name: `Token ${mintAddress.slice(0, 8)}`,
                logoUri: null,
                price: 0,
                priceChange24h: 0,
                volume24h: 0,
                liquidity: 0,
                marketCap: 0,
                txCount: 0,
                createdAt: Date.now(),
                source: "pump.fun",
                complete: false,
                progress: 0,
              };

              tokenCache.set(mintAddress, token);
              console.log(`[gRPC] New token: ${mintAddress}`);

              // Keep only last 100 tokens
              if (tokenCache.size > 100) {
                const oldest = tokenCache.keys().next().value;
                if (oldest) tokenCache.delete(oldest);
              }
            }
          }
        }
      } catch (e) {
        console.error("[gRPC] Error processing:", e);
      }
    });

    grpcStream.on("error", (err: Error) => {
      console.error("[gRPC] Stream error:", err.message);
      grpcInitialized = false;
    });

    grpcStream.on("end", () => {
      console.log("[gRPC] Stream ended");
      grpcInitialized = false;
    });

    await new Promise<void>((resolve, reject) => {
      grpcStream.write(request, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    grpcInitialized = true;
    console.log("[gRPC] Connected and subscribed to Pump.fun");
  } catch (error) {
    console.error("[gRPC] Init failed:", error);
    throw error;
  }
}

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");

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

  const tokens = Array.from(tokenCache.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);

  return NextResponse.json({
    data: tokens,
    sources: ["grpc"],
    realtime: grpcInitialized,
    tokenCount: tokenCache.size,
  });
}
