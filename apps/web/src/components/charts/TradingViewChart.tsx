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
}: TradingViewChartProps) {
  const { isDark } = useThemeStore();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
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
      timeScale: {
        borderColor: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
        timeVisible: true,
        secondsVisible: false, // Will be updated dynamically
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
        time: (d.timestamp / 1000) as Time, // Convert ms to seconds
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
