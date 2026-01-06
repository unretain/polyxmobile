import { create } from "zustand";

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ============================================================================
// LINE CHART: Period = TIME RANGE (how much history to show)
// User selects "1M" = show last 1 month of data with auto-selected candle size
// Line chart does NOT have 1s option - that's candlestick only
// ============================================================================
export type LinePeriod = "1m" | "15m" | "1h" | "24h" | "7d" | "30d" | "3m" | "1y" | "5y";

// Line chart config - period is time range, interval is auto-selected for best granularity
// Format: { interval: API candle size, seconds: time range to fetch }
const LINE_PERIOD_CONFIG: Record<LinePeriod, { interval: string; seconds: number }> = {
  "1m": { interval: "1s", seconds: 60 },                 // 1s candles for last 1 minute
  "15m": { interval: "1s", seconds: 900 },               // 1s candles for last 15 minutes
  "1h": { interval: "1min", seconds: 3600 },             // 1 min candles for 1 hour
  "24h": { interval: "5min", seconds: 86400 },           // 5 min candles for 24 hours
  "7d": { interval: "1h", seconds: 86400 * 7 },          // 1 hour candles for 7 days
  "30d": { interval: "4h", seconds: 86400 * 30 },        // 4 hour candles for 1 month
  "3m": { interval: "1d", seconds: 86400 * 90 },         // 1 day candles for 3 months
  "1y": { interval: "1d", seconds: 86400 * 365 },        // 1 day candles for 1 year
  "5y": { interval: "1d", seconds: 86400 * 365 * 5 },    // 1 day candles for 5 years
};

// ============================================================================
// CANDLESTICK CHART: Period = CANDLE INTERVAL (size of each candle)
// User selects "1H" = show 1-hour candles (each candle = 1 hour of data)
// ============================================================================
export type CandlePeriod = "1s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M";

// Candlestick config - period IS the interval, fetch ALL available data for each timeframe
// 1s is special: per-trade candles for Pulse tokens (pump.fun style)
const CANDLE_PERIOD_CONFIG: Record<CandlePeriod, { interval: string; seconds: number; isPulse?: boolean }> = {
  "1s": { interval: "1s", seconds: 0, isPulse: true },      // Per-trade candles, fetch ALL history (pump.fun style)
  "1m": { interval: "1min", seconds: 86400 * 7 },           // 1 min candles, 7 days of data (~10080 candles)
  "5m": { interval: "5min", seconds: 86400 * 30 },          // 5 min candles, 30 days of data
  "15m": { interval: "15m", seconds: 86400 * 90 },          // 15 min candles, 90 days of data
  "1h": { interval: "1h", seconds: 86400 * 365 * 2 },       // 1 hour candles, 2 years of data
  "4h": { interval: "4h", seconds: 86400 * 365 * 3 },       // 4 hour candles, 3 years of data
  "1d": { interval: "1d", seconds: 86400 * 365 * 5 },       // 1 day candles, 5 years of data
  "1w": { interval: "1w", seconds: 86400 * 365 * 10 },      // 1 week candles, 10 years of data
  "1M": { interval: "1M", seconds: 86400 * 365 * 10 },      // 1 month candles, 10 years of data
};

// Legacy type for backwards compatibility
export type Period = LinePeriod;

// Helper to get config based on chart type
export type ChartType = "line" | "candle";

function getPeriodConfig(period: string, chartType: ChartType) {
  if (chartType === "candle" && period in CANDLE_PERIOD_CONFIG) {
    return CANDLE_PERIOD_CONFIG[period as CandlePeriod];
  }
  // Default to line chart config
  if (period in LINE_PERIOD_CONFIG) {
    return LINE_PERIOD_CONFIG[period as LinePeriod];
  }
  // Fallback
  return LINE_PERIOD_CONFIG["24h"];
}

interface ChartStore {
  ohlcv: OHLCV[];
  period: string;             // Can be LinePeriod or CandlePeriod
  chartType: ChartType;       // Track which chart type is active
  isLoading: boolean;
  error: string | null;
  isPulseToken: boolean;      // Whether this is a Pulse token (uses PumpPortal, not Birdeye)
  // X-axis (time) controls
  visibleStartIndex: number;
  visibleCount: number;       // 0 means show all
  // Y-axis (price) controls
  priceZoom: number;          // 1 = fit to data, <1 = zoom in (show less range), >1 = zoom out (show more range)
  priceOffset: number;        // Vertical pan offset as percentage of visible range
  setPeriod: (period: string) => void;
  setChartType: (chartType: ChartType) => void;
  setIsPulseToken: (isPulse: boolean) => void;
  setVisibleRange: (startIndex: number, count: number) => void;
  zoomTime: (zoomIn: boolean, centerRatio?: number) => void;
  panTime: (delta: number) => void;
  zoomPrice: (zoomIn: boolean) => void;
  panPrice: (delta: number) => void;
  resetView: () => void;
  fetchOHLCV: (tokenAddress: string, period?: string, chartType?: ChartType) => Promise<void>;
}

// API calls go through Next.js proxy routes (protects internal API key)
const MIN_VISIBLE_COUNT = 20;

export const useChartStore = create<ChartStore>((set, get) => ({
  ohlcv: [],
  period: "24h",
  chartType: "line",
  isLoading: false,
  error: null,
  isPulseToken: false,
  visibleStartIndex: 0,
  visibleCount: 0,
  priceZoom: 1,
  priceOffset: 0,

  setPeriod: (period) => set({ period }),

  setChartType: (chartType) => set({ chartType }),

  setIsPulseToken: (isPulse) => set({ isPulseToken: isPulse }),

  setVisibleRange: (startIndex: number, count: number) => {
    const { ohlcv } = get();
    const maxStart = Math.max(0, ohlcv.length - count);
    set({
      visibleStartIndex: Math.max(0, Math.min(startIndex, maxStart)),
      visibleCount: count,
    });
  },

  // Zoom time axis (X-axis) - changes number of visible candles
  zoomTime: (zoomIn: boolean, centerRatio = 0.5) => {
    const { ohlcv, visibleStartIndex, visibleCount } = get();
    if (ohlcv.length === 0) return;

    const currentCount = visibleCount === 0 ? ohlcv.length : visibleCount;
    const factor = zoomIn ? 0.8 : 1.25;
    let newCount = Math.round(currentCount * factor);
    newCount = Math.max(MIN_VISIBLE_COUNT, Math.min(ohlcv.length, newCount));

    if (newCount >= ohlcv.length) {
      set({ visibleStartIndex: 0, visibleCount: 0 });
      return;
    }

    const currentStart = visibleCount === 0 ? 0 : visibleStartIndex;
    const centerIndex = currentStart + currentCount * centerRatio;
    let newStart = Math.round(centerIndex - newCount * centerRatio);
    const maxStart = ohlcv.length - newCount;
    newStart = Math.max(0, Math.min(newStart, maxStart));

    set({ visibleStartIndex: newStart, visibleCount: newCount });
  },

  // Pan time axis (X-axis) - scrolls through candles
  panTime: (delta: number) => {
    const { ohlcv, visibleStartIndex, visibleCount } = get();
    if (ohlcv.length === 0) return;

    // If not zoomed, auto-zoom to 80% to enable panning
    if (visibleCount === 0) {
      const newCount = Math.floor(ohlcv.length * 0.8);
      const newStart = Math.max(0, ohlcv.length - newCount);
      set({ visibleStartIndex: newStart, visibleCount: newCount });
      return;
    }

    const maxStart = Math.max(0, ohlcv.length - visibleCount);
    const newStart = Math.max(0, Math.min(visibleStartIndex + delta, maxStart));
    set({ visibleStartIndex: newStart });
  },

  // Zoom price axis (Y-axis) - shows more or less price range
  zoomPrice: (zoomIn: boolean) => {
    const { priceZoom } = get();
    // zoomIn = true means show LESS price range (zoom into the data)
    // zoomIn = false means show MORE price range (zoom out)
    const factor = zoomIn ? 0.8 : 1.25;
    const newZoom = Math.max(0.2, Math.min(5, priceZoom * factor));
    set({ priceZoom: newZoom });
  },

  // Pan price axis (Y-axis) - shifts the visible price range up/down
  panPrice: (delta: number) => {
    const { priceOffset } = get();
    // delta is percentage of visible range to shift
    const newOffset = Math.max(-100, Math.min(100, priceOffset + delta));
    set({ priceOffset: newOffset });
  },

  // Reset all view settings
  resetView: () => {
    set({
      visibleStartIndex: 0,
      visibleCount: 0,
      priceZoom: 1,
      priceOffset: 0
    });
  },

  fetchOHLCV: async (tokenAddress: string, newPeriod?: string, newChartType?: ChartType) => {
    const period = newPeriod ?? get().period;
    const chartType = newChartType ?? get().chartType;
    const isPulseToken = get().isPulseToken;
    const config = getPeriodConfig(period, chartType);

    set({ isLoading: true, error: null, period, chartType });

    try {
      let data: OHLCV[] = [];

      // For Pulse tokens, ALWAYS use PumpPortal - never Birdeye
      // Pulse tokens are new pump.fun tokens that only have PumpPortal data
      if (isPulseToken) {
        // Use Next.js proxy route (protects internal API key)
        const response = await fetch(`/api/pulse/ohlcv/${tokenAddress}`);
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }
        const result = await response.json();
        data = result.data || [];
      } else {
        // Standard Birdeye OHLCV for main dashboard tokens
        // Use Next.js proxy route (protects internal API key)
        const to = Math.floor(Date.now() / 1000);
        const from = config.seconds === 0 ? 0 : to - config.seconds;

        const response = await fetch(
          `/api/tokens/${tokenAddress}/ohlcv?timeframe=${config.interval}&from=${from}&to=${to}`
        );
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }
        data = await response.json();
      }

      // Reset view when fetching new data
      set({
        ohlcv: data || [],
        isLoading: false,
        visibleStartIndex: 0,
        visibleCount: 0,
        priceZoom: 1,
        priceOffset: 0,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to fetch chart data",
        isLoading: false,
      });
    }
  },
}));

// Export the period options for use in ChartControls
// LINE CHART: Time ranges (how far back to show history)
export const LINE_PERIODS: { value: LinePeriod; label: string }[] = [
  { value: "1m", label: "1m" },     // Last 1 minute
  { value: "15m", label: "15m" },   // Last 15 minutes
  { value: "1h", label: "1H" },     // Last 1 hour
  { value: "24h", label: "24H" },   // Last 24 hours
  { value: "7d", label: "7D" },     // Last 7 days
  { value: "30d", label: "30D" },   // Last 30 days
  { value: "3m", label: "3M" },     // Last 3 months
  { value: "1y", label: "1Y" },     // Last 1 year
  { value: "5y", label: "5Y" },     // Last 5 years
];

// CANDLESTICK CHART: Candle intervals (size of each candle)
export const CANDLE_PERIODS: { value: CandlePeriod; label: string }[] = [
  { value: "1m", label: "1m" },     // 1-minute candles
  { value: "5m", label: "5m" },     // 5-minute candles
  { value: "15m", label: "15m" },   // 15-minute candles
  { value: "1h", label: "1H" },     // 1-hour candles
  { value: "4h", label: "4H" },     // 4-hour candles
  { value: "1d", label: "1D" },     // Daily candles
  { value: "1w", label: "1W" },     // Weekly candles
  { value: "1M", label: "1M" },     // Monthly candles
];

// 1s option is ONLY for candlestick chart on Pulse tokens (per-trade candles)
export const PULSE_PERIOD = { value: "1s" as const, label: "1s" };
