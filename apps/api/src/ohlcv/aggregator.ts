import { EventEmitter } from "events";
import {
  Candle,
  OHLCV,
  Trade,
  Timeframe,
  TIMEFRAME_MS,
  getCandleTimestamp,
  shouldCloseCandle,
} from "./candle";

const ALL_TIMEFRAMES: Timeframe[] = ["1s", "5s", "15s", "1m", "5m", "15m", "1h", "4h", "1d"];

// Maximum candles to keep in memory per timeframe
const MAX_CANDLES_IN_MEMORY: Record<Timeframe, number> = {
  "1s": 3600, // 1 hour of 1s candles
  "5s": 1440, // 2 hours of 5s candles
  "15s": 960, // 4 hours of 15s candles
  "1m": 1440, // 24 hours of 1m candles
  "5m": 576, // 48 hours of 5m candles
  "15m": 384, // 4 days of 15m candles
  "1h": 720, // 30 days of 1h candles
  "4h": 360, // 60 days of 4h candles
  "1d": 365, // 1 year of 1d candles
};

export interface PairAggregator {
  baseMint: string;
  quoteMint: string;
  candles: Map<Timeframe, Candle[]>;
  currentCandles: Map<Timeframe, Candle>;
  lastPrice: number;
  totalVolume: number;
  totalTrades: number;
}

export class OHLCVAggregator extends EventEmitter {
  private pairs: Map<string, PairAggregator> = new Map();
  private candleCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.startCandleChecker();
  }

  private getPairKey(baseMint: string, quoteMint: string): string {
    return `${baseMint}:${quoteMint}`;
  }

  private getOrCreatePair(baseMint: string, quoteMint: string): PairAggregator {
    const key = this.getPairKey(baseMint, quoteMint);
    let pair = this.pairs.get(key);

    if (!pair) {
      pair = {
        baseMint,
        quoteMint,
        candles: new Map(),
        currentCandles: new Map(),
        lastPrice: 0,
        totalVolume: 0,
        totalTrades: 0,
      };

      // Initialize candle arrays for each timeframe
      for (const tf of ALL_TIMEFRAMES) {
        pair.candles.set(tf, []);
      }

      this.pairs.set(key, pair);
      console.log(`📊 New pair tracked: ${baseMint.slice(0, 8)}... / ${quoteMint.slice(0, 8)}...`);
    }

    return pair;
  }

  addTrade(
    baseMint: string,
    quoteMint: string,
    price: number,
    baseAmount: number,
    quoteAmount: number,
    timestamp: number,
    isBuy: boolean
  ): void {
    const pair = this.getOrCreatePair(baseMint, quoteMint);

    const trade: Trade = {
      timestamp,
      price,
      amount: baseAmount,
      quoteAmount,
      isBuy,
    };

    pair.lastPrice = price;
    pair.totalVolume += baseAmount;
    pair.totalTrades++;

    // Update candles for all timeframes
    for (const tf of ALL_TIMEFRAMES) {
      this.updateCandle(pair, tf, trade);
    }

    // Emit trade event for real-time updates
    this.emit("trade", {
      baseMint,
      quoteMint,
      trade,
    });
  }

  private updateCandle(pair: PairAggregator, timeframe: Timeframe, trade: Trade): void {
    const candleTimestamp = getCandleTimestamp(trade.timestamp, timeframe);
    let currentCandle = pair.currentCandles.get(timeframe);

    // Check if we need to close the current candle and start a new one
    if (currentCandle && currentCandle.timestamp !== candleTimestamp) {
      // Close the current candle
      const closedCandle = currentCandle.closeCandle();
      this.addCandleToHistory(pair, timeframe, closedCandle);

      // Emit candle closed event
      this.emit("candleClosed", {
        baseMint: pair.baseMint,
        quoteMint: pair.quoteMint,
        timeframe,
        candle: closedCandle,
      });

      currentCandle = undefined;
    }

    // Create new candle if needed
    if (!currentCandle) {
      currentCandle = new Candle(candleTimestamp);
      pair.currentCandles.set(timeframe, currentCandle);
    }

    // Add trade to current candle
    currentCandle.addTrade(trade);

    // Emit candle update event
    this.emit("candleUpdate", {
      baseMint: pair.baseMint,
      quoteMint: pair.quoteMint,
      timeframe,
      candle: currentCandle.toOHLCV(),
    });
  }

  private addCandleToHistory(pair: PairAggregator, timeframe: Timeframe, candle: OHLCV): void {
    const candles = pair.candles.get(timeframe);
    if (!candles) return;

    candles.push(new Candle(candle.timestamp, candle.open));
    Object.assign(candles[candles.length - 1], candle);

    // Trim to max size
    const maxCandles = MAX_CANDLES_IN_MEMORY[timeframe];
    if (candles.length > maxCandles) {
      candles.splice(0, candles.length - maxCandles);
    }
  }

  private startCandleChecker(): void {
    // Check for candles that should be closed every second
    this.candleCheckInterval = setInterval(() => {
      const now = Date.now();

      for (const [pairKey, pair] of this.pairs) {
        for (const tf of ALL_TIMEFRAMES) {
          const currentCandle = pair.currentCandles.get(tf);
          if (currentCandle && shouldCloseCandle(currentCandle.timestamp, tf, now)) {
            // Close the candle even if no new trades
            const closedCandle = currentCandle.closeCandle();
            this.addCandleToHistory(pair, tf, closedCandle);

            this.emit("candleClosed", {
              baseMint: pair.baseMint,
              quoteMint: pair.quoteMint,
              timeframe: tf,
              candle: closedCandle,
            });

            // Remove current candle (new one will be created on next trade)
            pair.currentCandles.delete(tf);
          }
        }
      }
    }, 1000);
  }

  getCandles(baseMint: string, quoteMint: string, timeframe: Timeframe, limit?: number): OHLCV[] {
    const pair = this.pairs.get(this.getPairKey(baseMint, quoteMint));
    if (!pair) return [];

    const historicalCandles = pair.candles.get(timeframe) || [];
    const currentCandle = pair.currentCandles.get(timeframe);

    const allCandles = [
      ...historicalCandles.map((c) => c.toOHLCV()),
      ...(currentCandle ? [currentCandle.toOHLCV()] : []),
    ];

    if (limit && limit > 0) {
      return allCandles.slice(-limit);
    }

    return allCandles;
  }

  getCurrentCandle(baseMint: string, quoteMint: string, timeframe: Timeframe): OHLCV | null {
    const pair = this.pairs.get(this.getPairKey(baseMint, quoteMint));
    if (!pair) return null;

    const currentCandle = pair.currentCandles.get(timeframe);
    return currentCandle ? currentCandle.toOHLCV() : null;
  }

  getLastPrice(baseMint: string, quoteMint: string): number | null {
    const pair = this.pairs.get(this.getPairKey(baseMint, quoteMint));
    return pair ? pair.lastPrice : null;
  }

  getPairStats(baseMint: string, quoteMint: string): {
    lastPrice: number;
    totalVolume: number;
    totalTrades: number;
    timeframes: Timeframe[];
  } | null {
    const pair = this.pairs.get(this.getPairKey(baseMint, quoteMint));
    if (!pair) return null;

    return {
      lastPrice: pair.lastPrice,
      totalVolume: pair.totalVolume,
      totalTrades: pair.totalTrades,
      timeframes: ALL_TIMEFRAMES,
    };
  }

  getAllPairs(): Array<{
    baseMint: string;
    quoteMint: string;
    lastPrice: number;
    totalVolume: number;
    totalTrades: number;
  }> {
    const pairs: Array<{
      baseMint: string;
      quoteMint: string;
      lastPrice: number;
      totalVolume: number;
      totalTrades: number;
    }> = [];

    for (const pair of this.pairs.values()) {
      pairs.push({
        baseMint: pair.baseMint,
        quoteMint: pair.quoteMint,
        lastPrice: pair.lastPrice,
        totalVolume: pair.totalVolume,
        totalTrades: pair.totalTrades,
      });
    }

    return pairs;
  }

  destroy(): void {
    if (this.candleCheckInterval) {
      clearInterval(this.candleCheckInterval);
    }
    this.pairs.clear();
    this.removeAllListeners();
  }
}

// Singleton instance
let aggregatorInstance: OHLCVAggregator | null = null;

export function getOHLCVAggregator(): OHLCVAggregator {
  if (!aggregatorInstance) {
    aggregatorInstance = new OHLCVAggregator();
  }
  return aggregatorInstance;
}
