import { EventEmitter } from "events";
import { GrpcClient, getGrpcClient, GrpcConfig, ParsedSwap } from "./client";
import { parseTransaction } from "../parsers";
import { getOHLCVAggregator, OHLCVAggregator, Timeframe, OHLCV } from "../ohlcv";

export interface GrpcServiceConfig extends GrpcConfig {
  enabled: boolean;
}

class GrpcService extends EventEmitter {
  private client: GrpcClient | null = null;
  private aggregator: OHLCVAggregator;
  private isRunning = false;
  private stats = {
    totalTransactions: 0,
    totalSwaps: 0,
    uniquePairs: 0,
    startTime: 0,
  };

  constructor() {
    super();
    this.aggregator = getOHLCVAggregator();
    this.setupAggregatorListeners();
  }

  private setupAggregatorListeners(): void {
    // Forward aggregator events
    this.aggregator.on("trade", (data) => {
      this.emit("trade", data);
    });

    this.aggregator.on("candleUpdate", (data) => {
      this.emit("candleUpdate", data);
    });

    this.aggregator.on("candleClosed", (data) => {
      this.emit("candleClosed", data);
    });
  }

  async start(config: GrpcServiceConfig): Promise<void> {
    if (!config.enabled) {
      console.log("⚠️ gRPC service disabled");
      return;
    }

    if (this.isRunning) {
      console.log("⚠️ gRPC service already running");
      return;
    }

    try {
      this.client = getGrpcClient(config);

      // Set up event handlers
      this.client.on("connected", () => {
        console.log("✅ gRPC service connected");
        this.emit("connected");
      });

      this.client.on("transaction", (tx) => {
        this.processTransaction(tx);
      });

      this.client.on("error", (error) => {
        console.error("❌ gRPC error:", error);
        this.emit("error", error);
      });

      this.client.on("disconnected", () => {
        console.log("🔌 gRPC service disconnected");
        this.emit("disconnected");
      });

      // Connect and subscribe
      await this.client.connect();
      await this.client.subscribeToDexTransactions();

      this.isRunning = true;
      this.stats.startTime = Date.now();
      console.log("🚀 gRPC service started - streaming DEX transactions");
    } catch (error) {
      console.error("❌ Failed to start gRPC service:", error);
      throw error;
    }
  }

  private processTransaction(tx: any): void {
    this.stats.totalTransactions++;

    try {
      const swaps = parseTransaction(tx);

      for (const swap of swaps) {
        this.stats.totalSwaps++;
        this.processSwap(swap);
      }
    } catch (error) {
      console.error("Error processing transaction:", error);
    }
  }

  private processSwap(swap: ParsedSwap): void {
    // Add trade to OHLCV aggregator
    this.aggregator.addTrade(
      swap.baseMint,
      swap.quoteMint,
      swap.price,
      swap.baseAmount,
      swap.quoteAmount,
      swap.timestamp,
      swap.isBuy
    );

    // Log interesting swaps
    if (swap.quoteAmount > 1) {
      // More than 1 SOL
      console.log(
        `💱 ${swap.dex} | ${swap.isBuy ? "BUY" : "SELL"} | ` +
          `${swap.baseAmount.toFixed(2)} tokens @ ${swap.price.toFixed(8)} SOL | ` +
          `${swap.quoteAmount.toFixed(4)} SOL`
      );
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
    }
    this.isRunning = false;
    console.log("🛑 gRPC service stopped");
  }

  // Public API methods
  getCandles(baseMint: string, quoteMint: string, timeframe: Timeframe, limit?: number): OHLCV[] {
    return this.aggregator.getCandles(baseMint, quoteMint, timeframe, limit);
  }

  getCurrentCandle(baseMint: string, quoteMint: string, timeframe: Timeframe): OHLCV | null {
    return this.aggregator.getCurrentCandle(baseMint, quoteMint, timeframe);
  }

  getLastPrice(baseMint: string, quoteMint: string): number | null {
    return this.aggregator.getLastPrice(baseMint, quoteMint);
  }

  getPairStats(baseMint: string, quoteMint: string) {
    return this.aggregator.getPairStats(baseMint, quoteMint);
  }

  getAllPairs() {
    return this.aggregator.getAllPairs();
  }

  getStats() {
    const uptime = this.isRunning ? Date.now() - this.stats.startTime : 0;
    const pairs = this.aggregator.getAllPairs();

    return {
      isRunning: this.isRunning,
      uptime,
      totalTransactions: this.stats.totalTransactions,
      totalSwaps: this.stats.totalSwaps,
      uniquePairs: pairs.length,
      transactionsPerSecond: uptime > 0 ? (this.stats.totalTransactions / (uptime / 1000)).toFixed(2) : "0",
      swapsPerSecond: uptime > 0 ? (this.stats.totalSwaps / (uptime / 1000)).toFixed(2) : "0",
    };
  }
}

// Singleton instance
let grpcServiceInstance: GrpcService | null = null;

export function getGrpcService(): GrpcService {
  if (!grpcServiceInstance) {
    grpcServiceInstance = new GrpcService();
  }
  return grpcServiceInstance;
}

export { GrpcService };
