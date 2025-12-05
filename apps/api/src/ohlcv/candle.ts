export type Timeframe = "1s" | "5s" | "15s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface OHLCV {
  timestamp: number; // Candle open time (ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // Base token volume
  quoteVolume: number; // Quote token volume (SOL/USDC)
  trades: number; // Number of trades in this candle
  isClosed: boolean;
}

export interface Trade {
  timestamp: number;
  price: number;
  amount: number; // Base amount
  quoteAmount: number;
  isBuy: boolean;
}

// Timeframe durations in milliseconds
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "1s": 1000,
  "5s": 5000,
  "15s": 15000,
  "1m": 60000,
  "5m": 300000,
  "15m": 900000,
  "1h": 3600000,
  "4h": 14400000,
  "1d": 86400000,
};

export class Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  isClosed: boolean;

  constructor(timestamp: number, initialPrice?: number) {
    this.timestamp = timestamp;
    this.open = initialPrice || 0;
    this.high = initialPrice || 0;
    this.low = initialPrice || Infinity;
    this.close = initialPrice || 0;
    this.volume = 0;
    this.quoteVolume = 0;
    this.trades = 0;
    this.isClosed = false;

    // Handle case where no initial price
    if (!initialPrice) {
      this.low = 0;
    }
  }

  addTrade(trade: Trade): void {
    if (this.trades === 0) {
      // First trade sets open price
      this.open = trade.price;
      this.high = trade.price;
      this.low = trade.price;
    } else {
      this.high = Math.max(this.high, trade.price);
      this.low = Math.min(this.low, trade.price);
    }

    this.close = trade.price;
    this.volume += trade.amount;
    this.quoteVolume += trade.quoteAmount;
    this.trades++;
  }

  toOHLCV(): OHLCV {
    return {
      timestamp: this.timestamp,
      open: this.open,
      high: this.high,
      low: this.low,
      close: this.close,
      volume: this.volume,
      quoteVolume: this.quoteVolume,
      trades: this.trades,
      isClosed: this.isClosed,
    };
  }

  closeCandle(): OHLCV {
    this.isClosed = true;
    return this.toOHLCV();
  }
}

// Get the candle timestamp for a given time and timeframe
export function getCandleTimestamp(timestamp: number, timeframe: Timeframe): number {
  const interval = TIMEFRAME_MS[timeframe];
  return Math.floor(timestamp / interval) * interval;
}

// Check if a candle should be closed based on current time
export function shouldCloseCandle(candleTimestamp: number, timeframe: Timeframe, currentTime: number): boolean {
  const interval = TIMEFRAME_MS[timeframe];
  return currentTime >= candleTimestamp + interval;
}
