/**
 * Pump.fun Real-time Monitor via Yellowstone gRPC
 * Streams new token creates, trades, and graduations in real-time
 */

import Client, {
  CommitmentLevel,
  SubscribeRequest,
  SubscribeUpdate,
} from "@triton-one/yellowstone-grpc";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getTokenMetadata, getTokenPrice } from "./solana-data";

// Pump.fun Program ID
const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// Raydium AMM for graduation detection
const RAYDIUM_AMM_PROGRAM = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

// gRPC config from env
const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT || "";
const GRPC_TOKEN = process.env.GRPC_TOKEN || "";

// Token interfaces
export interface PumpToken {
  mint: string;
  name: string;
  symbol: string;
  image?: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  creator?: string;
  timestamp: number;
  price?: number;
  signature?: string;
}

export interface GraduationEvent {
  mint: string;
  timestamp: number;
  signature: string;
  destination: "raydium" | "pumpswap";
}

// Callbacks
type NewTokenCallback = (token: PumpToken) => void;
type GraduatedCallback = (event: GraduationEvent) => void;

// Token cache
const tokenCache = new Map<string, PumpToken>();

/**
 * PumpFunGrpcMonitor - Real-time streaming via Yellowstone gRPC
 */
export class PumpFunGrpcMonitor {
  private client: Client | null = null;
  private stream: any = null;
  private isRunning = false;

  private onNewToken: NewTokenCallback | null = null;
  private onGraduated: GraduatedCallback | null = null;

  constructor() {}

  setNewTokenCallback(cb: NewTokenCallback) {
    this.onNewToken = cb;
  }

  setGraduatedCallback(cb: GraduatedCallback) {
    this.onGraduated = cb;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    if (!GRPC_ENDPOINT) {
      console.error("[gRPC] Missing GRPC_ENDPOINT");
      return;
    }

    console.log(`[gRPC] Connecting to ${GRPC_ENDPOINT}...`);

    try {
      // Create gRPC client
      this.client = new Client(GRPC_ENDPOINT, GRPC_TOKEN || undefined, {
        "grpc.max_receive_message_length": 64 * 1024 * 1024, // 64MB
      });

      // Subscribe to Pump.fun and Raydium transactions
      const request: SubscribeRequest = {
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

      this.stream = await this.client.subscribe();

      // Handle incoming data
      this.stream.on("data", async (update: SubscribeUpdate) => {
        await this.handleUpdate(update);
      });

      this.stream.on("error", (err: Error) => {
        console.error("[gRPC] Stream error:", err.message);
      });

      this.stream.on("end", () => {
        console.log("[gRPC] Stream ended");
        this.isRunning = false;
      });

      // Send subscription request
      await new Promise<void>((resolve, reject) => {
        this.stream.write(request, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });

      this.isRunning = true;
      console.log("[gRPC] Subscribed to Pump.fun & Raydium transactions");
    } catch (error) {
      console.error("[gRPC] Failed to start:", error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }

    this.client = null;
    this.isRunning = false;
    console.log("[gRPC] Stopped");
  }

  private async handleUpdate(update: SubscribeUpdate): Promise<void> {
    try {
      // Handle transaction updates
      if (update.transaction) {
        const tx = update.transaction.transaction;
        if (!tx) return;

        const signature = bs58.encode(tx.signature);
        const meta = tx.meta;
        const message = tx.transaction?.message;

        if (!meta || !message) return;

        // Get account keys
        const accountKeys = message.accountKeys?.map((key) =>
          new PublicKey(key).toBase58()
        ) || [];

        // Check if Pump.fun is involved
        const isPumpFun = accountKeys.includes(PUMP_FUN_PROGRAM);
        const isRaydium = accountKeys.includes(RAYDIUM_AMM_PROGRAM);

        // Parse log messages
        const logs = meta.logMessages || [];
        const logsStr = logs.join(" ");

        if (isPumpFun) {
          // Check for token creation
          if (logsStr.includes("Create") || logsStr.includes("Initialize")) {
            await this.handleNewToken(accountKeys, signature, logs);
          }

          // Check for graduation/migration
          if (logsStr.includes("Withdraw") || logsStr.includes("migrate")) {
            await this.handleGraduation(accountKeys, signature, "pumpswap");
          }
        }

        if (isRaydium && logsStr.includes("Initialize")) {
          // Raydium pool creation = token graduated
          await this.handleGraduation(accountKeys, signature, "raydium");
        }
      }
    } catch (error) {
      console.error("[gRPC] Error handling update:", error);
    }
  }

  private async handleNewToken(
    accountKeys: string[],
    signature: string,
    logs: string[]
  ): Promise<void> {
    // Find the mint address (usually a new account in the tx)
    let mintAddress: string | null = null;

    for (const account of accountKeys) {
      // Skip known programs
      if (account === PUMP_FUN_PROGRAM) continue;
      if (account === RAYDIUM_AMM_PROGRAM) continue;
      if (account === "11111111111111111111111111111111") continue; // System program
      if (account === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") continue; // Token program

      // Check if we already have this token
      if (tokenCache.has(account)) continue;

      // This might be the mint
      mintAddress = account;
      break;
    }

    if (!mintAddress) return;

    // Fetch metadata
    const metadata = await getTokenMetadata(mintAddress);
    const price = await getTokenPrice(mintAddress);

    const token: PumpToken = {
      mint: mintAddress,
      name: metadata?.name || "Unknown",
      symbol: metadata?.symbol || "???",
      image: metadata?.image,
      description: metadata?.description,
      twitter: metadata?.twitter,
      telegram: metadata?.telegram,
      website: metadata?.website,
      timestamp: Date.now(),
      price: price || 0,
      signature,
    };

    // Cache it
    tokenCache.set(mintAddress, token);

    // Emit event
    if (this.onNewToken) {
      this.onNewToken(token);
    }

    console.log(`[gRPC] New token: ${token.symbol} (${mintAddress})`);
  }

  private async handleGraduation(
    accountKeys: string[],
    signature: string,
    destination: "raydium" | "pumpswap"
  ): Promise<void> {
    // Find which cached token graduated
    for (const account of accountKeys) {
      if (tokenCache.has(account)) {
        const event: GraduationEvent = {
          mint: account,
          timestamp: Date.now(),
          signature,
          destination,
        };

        if (this.onGraduated) {
          this.onGraduated(event);
        }

        console.log(`[gRPC] Token graduated: ${account} -> ${destination}`);

        // Remove from new tokens cache
        tokenCache.delete(account);
        return;
      }
    }
  }

  getCachedTokens(): PumpToken[] {
    return Array.from(tokenCache.values());
  }

  getCachedToken(mint: string): PumpToken | undefined {
    return tokenCache.get(mint);
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

// Singleton
let instance: PumpFunGrpcMonitor | null = null;

export function getPumpFunGrpcMonitor(): PumpFunGrpcMonitor {
  if (!instance) {
    instance = new PumpFunGrpcMonitor();
  }
  return instance;
}
