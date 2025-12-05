import Client, {
  CommitmentLevel,
  SubscribeRequest,
  SubscribeUpdate,
} from "@triton-one/yellowstone-grpc";
import { EventEmitter } from "events";

// DEX Program IDs
export const DEX_PROGRAMS = {
  RAYDIUM_AMM: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  RAYDIUM_CLMM: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  PUMP_FUN: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  ORCA_WHIRLPOOL: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
} as const;

// Common token addresses
export const TOKENS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
} as const;

export interface GrpcConfig {
  endpoint: string;
  xToken?: string;
}

export interface ParsedSwap {
  signature: string;
  slot: number;
  timestamp: number;
  dex: string;
  baseMint: string;
  quoteMint: string;
  baseAmount: number;
  quoteAmount: number;
  price: number; // quote per base
  isBuy: boolean; // true if buying base token
  maker?: string;
}

class GrpcClient extends EventEmitter {
  private client: Client | null = null;
  private stream: AsyncIterable<SubscribeUpdate> | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private config: GrpcConfig;

  constructor(config: GrpcConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    try {
      console.log(`🔌 Connecting to gRPC: ${this.config.endpoint}`);

      this.client = new Client(
        this.config.endpoint,
        this.config.xToken,
        undefined
      );

      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log("✅ gRPC client connected");
      this.emit("connected");
    } catch (error) {
      console.error("❌ gRPC connection failed:", error);
      this.emit("error", error);
      await this.handleReconnect();
    }
  }

  async subscribeToDexTransactions(): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error("gRPC client not connected");
    }

    const request: SubscribeRequest = {
      slots: {},
      accounts: {},
      transactions: {
        dex: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: Object.values(DEX_PROGRAMS),
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

    try {
      this.stream = await this.client.subscribe();

      // Send subscription request
      const stream = this.stream as any;
      await stream.write(request);

      console.log("📡 Subscribed to DEX transactions");
      this.emit("subscribed");

      // Process incoming updates
      for await (const update of this.stream) {
        if (update.transaction) {
          this.emit("transaction", update.transaction);
        }

        if (update.ping) {
          // Respond to ping to keep connection alive
          this.emit("ping");
        }
      }
    } catch (error) {
      console.error("❌ Subscription error:", error);
      this.emit("error", error);
      await this.handleReconnect();
    }
  }

  private async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("❌ Max reconnection attempts reached");
      this.emit("maxReconnectReached");
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connect();
      await this.subscribeToDexTransactions();
    } catch (error) {
      console.error("❌ Reconnection failed:", error);
    }
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.stream = null;
    if (this.client) {
      // Client cleanup if needed
      this.client = null;
    }
    console.log("🔌 gRPC client disconnected");
    this.emit("disconnected");
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}

// Singleton instance
let grpcClientInstance: GrpcClient | null = null;

export function getGrpcClient(config?: GrpcConfig): GrpcClient {
  if (!grpcClientInstance && config) {
    grpcClientInstance = new GrpcClient(config);
  }
  if (!grpcClientInstance) {
    throw new Error("gRPC client not initialized. Provide config on first call.");
  }
  return grpcClientInstance;
}

export { GrpcClient };
