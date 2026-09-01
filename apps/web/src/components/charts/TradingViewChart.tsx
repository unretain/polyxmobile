"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, IChartApi, ISeriesApi, CandlestickData, LineData, Time, CandlestickSeries, LineSeries } from "lightweight-charts";
import { useThemeStore } from "@/stores/themeStore";
import type { OHLCV } from "@/stores/pulseStore";

export type Timeframe = "1s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M";
type ChartType = "candle" | "line";

// pump.fun tokens have a fixed 1B supply, so market cap = price * 1e9.
const DEFAULT_SUPPLY = 1_000_000_000;

// Compact USD (market cap) label for the price scale + crosshair.
function formatCompactUsd(v: number): string {
  const n = Math.abs(v);
  if (n >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  if (n >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}


/**
 * lightweight-charts keys every point by an integer UNIX SECOND. Our bars are 250ms
 * apart, so `timestamp / 1000` produced fractional seconds (X.0, X.25, X.5, X.75) that
 * collapse onto the same second — the library keeps one and discards the rest, which is
 * what punched holes in the candles: three of every four bars never rendered.
 *
 * So we key on the raw MILLISECOND value instead. It is integer and strictly
 * increasing, which is all the library needs; it just believes the number is seconds.
 * The axis and crosshair are then formatted by the two functions below, which read it
 * back as milliseconds — so labels stay correct while every bar survives.
 */
const asTime = (ms: number) => ms as unknown as Time;

const fmtClock = (ms: number, tf?: string) => {
  const d = new Date(ms);
  // Daily+ views want a date, intraday wants a clock, sub-minute wants seconds.
  if (tf === "1D" || tf === "1W" || tf === "1M" || tf === "1d" || tf === "1w")
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  const seconds = tf === "1s" || tf === "5s" || tf === "15s" || tf === "30s";
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" as const } : {}),
  });
};

interface TradingViewChartProps {
  data: OHLCV[];
  isLoading?: boolean;
  timeframe?: Timeframe;
  onTimeframeChange?: (tf: Timeframe) => void;
  showTimeframeSelector?: boolean;
  /** Total token supply used to render market cap instead of raw price. */
  supply?: number;
  /** Controlled Line/Candle mode — when set, overrides the internal toggle. */
  chartType?: ChartType;
  /** The user's own buys/sells on this coin — rendered as B/S bubbles on the chart. */
  userTrades?: { time: number; type: "buy" | "sell" }[];
}

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "4h", label: "4h" },
  { value: "1d", label: "1d" },
];

export function TradingViewChart({
  data,
  isLoading,
  timeframe = "1m",
  onTimeframeChange,
  showTimeframeSelector = false,
  supply = DEFAULT_SUPPLY,
  chartType: chartTypeProp,
  userTrades,
}: TradingViewChartProps) {
  const { isDark } = useThemeStore();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [bubbles, setBubbles] = useState<{ x: number; y: number; type: "buy" | "sell" }[]>([]);
  // Track whether we've done the one-time initial fit for the current dataset, so
  // live updates don't keep snapping the user's zoom/pan back to "fit all".
  const fittedRef = useRef(false);
  const [internalChartType, setInternalChartType] = useState<ChartType>("candle");
  // Controlled by the page's Line/Candle toggle when provided; else self-managed.
  const chartType = chartTypeProp ?? internalChartType;
  const [chartReady, setChartReady] = useState(false);

  // Initialize chart - only recreate on theme change, NOT on timeframe change
  useEffect(() => {
    console.log("[TradingViewChart] Init effect running, containerRef:", !!chartContainerRef.current);
    if (!chartContainerRef.current) return;

    const container = chartContainerRef.current;
    const width = container.clientWidth || 400;
    const height = container.clientHeight || 300;
    console.log("[TradingViewChart] Creating chart with dimensions:", width, "x", height);

    const chart = createChart(container, {
      width,
      height,
      layout: {
        background: { color: "transparent" },
        textColor: isDark ? "#888888" : "#333333",
      },
      grid: {
        vertLines: { color: isDark ? "rgba(255, 107, 74, 0.1)" : "rgba(0, 0, 0, 0.1)" },
        horzLines: { color: isDark ? "rgba(255, 107, 74, 0.1)" : "rgba(0, 0, 0, 0.1)" },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: "#FF6B4A",
          width: 1,
          style: 2,
          labelBackgroundColor: "#FF6B4A",
        },
        horzLine: {
          color: "#FF6B4A",
          width: 1,
          style: 2,
          labelBackgroundColor: "#FF6B4A",
        },
      },
      rightPriceScale: {
        borderColor: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      localization: {
        // `time` carries milliseconds (see asTime) — render it as a real clock.
        timeFormatter: (t: unknown) => fmtClock(Number(t), "1s"), // crosshair: always precise
      },
      timeScale: {
        borderColor: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
        timeVisible: true,
        secondsVisible: false, // Will be updated dynamically
        tickMarkFormatter: (t: unknown) => fmtClock(Number(t), tfRef.current),
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    // Create both series but only show one at a time (v5 API)
    // Market-cap values are large ($1K–$1M+), so format the axis compactly.
    const mcapPriceFormat = {
      type: "custom" as const,
      formatter: formatCompactUsd,
      minMove: 0.01,
    };

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      priceFormat: mcapPriceFormat,
    });

    const lineSeries = chart.addSeries(LineSeries, {
      color: "#FF6B4A",
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: "#FF6B4A",
      crosshairMarkerBackgroundColor: "#ffffff",
      priceLineVisible: true,
      priceLineColor: "#FF6B4A",
      lastValueVisible: true,
      priceFormat: mcapPriceFormat,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    lineSeriesRef.current = lineSeries;
    setChartReady(true);
    console.log("[TradingViewChart] Chart created and ready");

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);
    // Initial resize and delayed resize to handle container dimensions settling
    handleResize();
    const resizeTimeout = setTimeout(handleResize, 100);

    return () => {
      clearTimeout(resizeTimeout);
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      setChartReady(false);
    };
  }, [isDark]); // Only recreate chart on theme change

  // tickMarkFormatter is fixed at creation in v5, so it reads the timeframe from a
  // ref — that keeps axis labels correct across timeframe switches without tearing
  // the chart down.
  const tfRef = useRef(timeframe);
  useEffect(() => { tfRef.current = timeframe; }, [timeframe]);

  // Update timeScale options when timeframe changes (without recreating chart)
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.timeScale().applyOptions({
      secondsVisible: timeframe === "1s",
    });
  }, [timeframe]);

  // Update data when it changes or when chart becomes ready
  useEffect(() => {
    console.log("[TradingViewChart] Data effect running, chartReady:", chartReady, "dataLen:", data?.length);
    if (!chartReady || !candleSeriesRef.current || !lineSeriesRef.current) return;
    if (!data || data.length === 0) { fittedRef.current = false; return; }

    // Convert OHLCV to lightweight-charts format, scaling price -> market cap
    // (price * supply) so the chart reads in dollars people recognize ($3.7K)
    // instead of a per-token price that rounds to $0.00.
    const candleData: CandlestickData<Time>[] = data
      .filter((d) => d && typeof d.timestamp === "number")
      .map((d) => ({
        time: asTime(d.timestamp), // ms key — fractional seconds dropped bars
        open: d.open * supply,
        high: d.high * supply,
        low: d.low * supply,
        close: d.close * supply,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    const lineData: LineData<Time>[] = candleData.map((d) => ({
      time: d.time,
      value: d.close,
    }));

    console.log("[TradingViewChart] Setting data, candleData length:", candleData.length);
    candleSeriesRef.current.setData(candleData);
    lineSeriesRef.current.setData(lineData);

    // Fit to view only ONCE per dataset (initial load / coin switch), never on
    // live updates — otherwise every new candle snaps zoom/pan back to "fit all".
    if (chartRef.current && !fittedRef.current) {
      chartRef.current.timeScale().fitContent();
      fittedRef.current = true;
    }
  }, [data, chartReady, supply]); // Re-run when data changes or chart becomes ready

  // Position the B/S bubbles as an HTML overlay at the EXACT buy/sell time+price.
  // Recomputed on pan / zoom / resize / timeframe / data so each bubble stays pinned
  // to its real transaction instead of snapping to whatever bar is nearest.
  useEffect(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chartReady || !chart || !series) return;

    const compute = () => {
      const ts = chart.timeScale();
      const cands = data.filter((d) => d && typeof d.timestamp === "number");
      const out: { x: number; y: number; type: "buy" | "sell" }[] = [];
      for (const t of userTrades || []) {
        const timeSec = t.time;
        if (!cands.length) continue;
        // Snap to the nearest candle by time — the trade's time is often a few
        // seconds ahead of the last candle (pipeline lag), which makes a raw
        // timeToCoordinate return null. The nearest candle IS the trade's candle.
        let nearest = cands[0];
        let best = Infinity;
        for (const c of cands) {
          const d = Math.abs(c.timestamp / 1000 - timeSec); // userTrades are in seconds
          if (d < best) { best = d; nearest = c; }
        }
        const x = ts.timeToCoordinate(asTime(nearest.timestamp));
        if (x == null) continue;
        // Both buy and sell bubbles sit ABOVE the candle (anchor to the high, offset up).
        const yc = series.priceToCoordinate(nearest.high * supply);
        if (yc == null) continue;
        out.push({ x, y: yc - 16, type: t.type });
      }
      // Stack bubbles that land on the same candle (same x) so a buy + sell on the
      // same bar don't overlap — each subsequent one sits above the previous.
      const seen = new Map<number, number>();
      for (const b of out) {
        const k = Math.round(b.x);
        const n = seen.get(k) || 0;
        b.y -= n * 22;
        seen.set(k, n + 1);
      }
      setBubbles(out);
    };

    compute();
    const ts = chart.timeScale();
    ts.subscribeVisibleTimeRangeChange(compute);
    const ro = new ResizeObserver(compute);
    if (chartContainerRef.current) ro.observe(chartContainerRef.current);
    return () => {
      ts.unsubscribeVisibleTimeRangeChange(compute);
      ro.disconnect();
    };
  }, [userTrades, chartReady, data, supply]);

  // Toggle series visibility based on chart type
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current || !lineSeriesRef.current) return;

    if (chartType === "candle") {
      candleSeriesRef.current.applyOptions({ visible: true });
      lineSeriesRef.current.applyOptions({ visible: false });
    } else {
      candleSeriesRef.current.applyOptions({ visible: false });
      lineSeriesRef.current.applyOptions({ visible: true });
    }
  }, [chartType, chartReady]);

  // NOTE: no early returns for loading/empty — the chart container below must
  // ALWAYS be in the DOM so lightweight-charts can initialize on mount. The 2D
  // chart mounts (hidden) at page load before OHLCV arrives; if we early-return
  // here the container never exists, createChart never runs, and the chart stays
  // blank forever (the init effect only depends on [isDark]). Loading/empty are
  // rendered as overlays instead.
  return (
    <div className={`h-full w-full relative ${isDark ? "bg-[#0a0a0a]" : "bg-gray-50"}`}>
      {/* Controls */}
      <div className="absolute top-2 left-2 right-2 z-10 flex justify-between">
        {/* Timeframe selector */}
        {showTimeframeSelector && onTimeframeChange && (
          <div className="flex gap-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                onClick={() => onTimeframeChange(tf.value)}
                className={`px-1.5 py-1 text-[9px] font-medium rounded transition-colors ${
                  timeframe === tf.value
                    ? "bg-[#FF6B4A] text-white"
                    : isDark
                    ? "bg-white/10 text-white/60 hover:bg-white/20"
                    : "bg-black/5 text-gray-500 hover:bg-black/10"
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        )}
        {!showTimeframeSelector && <div />}

        {/* Chart type toggle — hidden when the page controls Line/Candle */}
        {chartTypeProp ? <div /> : (
        <div className="flex gap-1">
          <button
            onClick={() => setInternalChartType("line")}
            className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
              chartType === "line"
                ? "bg-[#FF6B4A] text-white"
                : isDark
                ? "bg-white/10 text-white/60 hover:bg-white/20"
                : "bg-black/5 text-gray-500 hover:bg-black/10"
            }`}
          >
            Line
          </button>
          <button
            onClick={() => setInternalChartType("candle")}
            className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
              chartType === "candle"
                ? "bg-[#FF6B4A] text-white"
                : isDark
                ? "bg-white/10 text-white/60 hover:bg-white/20"
                : "bg-black/5 text-gray-500 hover:bg-black/10"
            }`}
          >
            Candle
          </button>
        </div>
        )}
      </div>

      {/* Chart container — always mounted so the chart can attach even before data */}
      <div ref={chartContainerRef} className="h-full w-full" />

      {/* B/S trade bubbles — custom overlay pinned to the exact tx time+price.
          Bevel/emboss via radial gradient + inset highlight/shadow, white Inter letter. */}
      <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
        {bubbles.map((b, i) => (
          <div
            key={i}
            className="absolute flex items-center justify-center rounded-full"
            style={{
              left: `${b.x}px`,
              top: `${b.y}px`,
              width: 20,
              height: 20,
              transform: "translate(-50%, -50%)",
              fontFamily: "Inter, system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 11,
              lineHeight: 1,
              color: "#ffffff",
              background:
                b.type === "buy"
                  ? "radial-gradient(circle at 35% 30%, #5cf08a, #16a34a 68%, #12833c)"
                  : "radial-gradient(circle at 35% 30%, #fb8a8a, #dc2626 68%, #b01c1c)",
              boxShadow:
                "inset 1px 1px 1.5px rgba(255,255,255,0.55), inset -1.5px -1.5px 2px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.55)",
              border: "1px solid rgba(0,0,0,0.25)",
            }}
          >
            {b.type === "buy" ? "B" : "S"}
          </div>
        ))}
      </div>

      {/* Loading / empty as overlays (never early-return the container away) */}
      {isLoading && (!data || data.length === 0) && (
        <div className={`absolute inset-0 flex items-center justify-center ${isDark ? "bg-[#0a0a0a]" : "bg-gray-50"}`}>
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
            <span className={`text-sm ${isDark ? "text-white/50" : "text-gray-500"}`}>Loading chart...</span>
          </div>
        </div>
      )}
      {!isLoading && (!data || data.length === 0) && (
        <div className={`absolute inset-0 flex items-center justify-center text-sm ${isDark ? "bg-[#0a0a0a] text-white/40" : "bg-gray-50 text-gray-400"}`}>
          No price data available
        </div>
      )}
    </div>
  );
}
