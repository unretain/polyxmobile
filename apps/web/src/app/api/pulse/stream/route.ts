/**
 * Real-time Pump.fun token stream via Yellowstone gRPC
 * Uses Server-Sent Events (SSE) for real-time updates
 */

import { NextRequest } from "next/server";

// gRPC config from env
const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT || "";
const GRPC_TOKEN = process.env.GRPC_TOKEN || "";

// Pump.fun Program ID
const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// Token cache for new pairs
const tokenCache: Map<string, any> = new Map();
let lastTokenTimestamp = 0;

export async function GET(req: NextRequest) {
  // Check if gRPC is configured
  if (!GRPC_ENDPOINT || !GRPC_TOKEN) {
    return new Response(
      JSON.stringify({ error: "gRPC not configured", data: [] }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // For non-streaming requests, return cached tokens
  const stream = req.nextUrl.searchParams.get("stream");
  if (stream !== "true") {
    return new Response(
      JSON.stringify({
        data: Array.from(tokenCache.values()).slice(0, 50),
        sources: ["grpc"],
        cached: true,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // SSE stream for real-time updates
  const encoder = new TextEncoder();

  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        // Dynamic import to avoid WASM issues at module level
        const { default: Client, CommitmentLevel } = await import(
          "@triton-one/yellowstone-grpc"
        );
        const { PublicKey } = await import("@solana/web3.js");

        console.log(`[gRPC Stream] Connecting to ${GRPC_ENDPOINT}...`);

        const client = new Client(GRPC_ENDPOINT, GRPC_TOKEN, {
          "grpc.max_receive_message_length": 64 * 1024 * 1024,
        });

        const grpcStream = await client.subscribe();

        // Subscribe to Pump.fun transactions
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

        // Handle incoming data
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

              // Check for token creation
              if (logsStr.includes("Create") || logsStr.includes("Initialize")) {
                // Find mint address
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
                    name: `New Token ${mintAddress.slice(0, 6)}`,
                    timestamp: Date.now(),
                    signature,
                    source: "grpc",
                  };

                  tokenCache.set(mintAddress, token);
                  lastTokenTimestamp = Date.now();

                  // Send SSE event
                  const sseData = `data: ${JSON.stringify(token)}\n\n`;
                  controller.enqueue(encoder.encode(sseData));

                  console.log(`[gRPC] New token: ${mintAddress}`);
                }
              }
            }
          } catch (e) {
            console.error("[gRPC] Error processing update:", e);
          }
        });

        grpcStream.on("error", (err: Error) => {
          console.error("[gRPC] Stream error:", err.message);
          const errorEvent = `data: ${JSON.stringify({ error: err.message })}\n\n`;
          controller.enqueue(encoder.encode(errorEvent));
        });

        grpcStream.on("end", () => {
          console.log("[gRPC] Stream ended");
          controller.close();
        });

        // Send subscription request
        await new Promise<void>((resolve, reject) => {
          grpcStream.write(request, (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
        });

        console.log("[gRPC] Subscribed to Pump.fun transactions");

        // Send initial connection event
        const connectedEvent = `data: ${JSON.stringify({ connected: true, endpoint: GRPC_ENDPOINT })}\n\n`;
        controller.enqueue(encoder.encode(connectedEvent));
      } catch (error) {
        console.error("[gRPC] Failed to start stream:", error);
        const errorMsg = `data: ${JSON.stringify({ error: String(error) })}\n\n`;
        controller.enqueue(encoder.encode(errorMsg));
        controller.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
