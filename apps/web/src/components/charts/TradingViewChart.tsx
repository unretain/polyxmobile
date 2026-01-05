"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, IChartApi, ISeriesApi, CandlestickData, LineData, Time, CandlestickSeries, LineSeries } from "lightweight-charts";
import { useThemeStore } from "@/stores/themeStore";
import type { OHLCV } from "@/stores/pulseStore";

export type Timeframe = "1s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M";
type ChartType = "candle" | "line";

interface TradingViewChartProps {
  data: OHLCV[];
  isLoading?: boolean;
  timeframe?: Timeframe;
  onTimeframeChange?: (tf: Timeframe) => void;
  showTimeframeSelector?: boolean;
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
}: TradingViewChartProps) {
  const { isDark } = useThemeStore();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [chartType, setChartType] = useState<ChartType>("candle");
  const [chartReady, setChartReady] = useState(false);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
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
        secondsVisible: timeframe === "1s",
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
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
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
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    lineSeriesRef.current = lineSeries;
    setChartReady(true);

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
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      setChartReady(false);
    };
  }, [isDark, timeframe]);

  // Update data when it changes or when chart becomes ready
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current || !lineSeriesRef.current || !data || data.length === 0) return;

    // Convert OHLCV data to lightweight-charts format
    const candleData: CandlestickData<Time>[] = data
      .filter((d) => d && typeof d.timestamp === "number")
      .map((d) => ({
        time: (d.timestamp / 1000) as Time, // Convert ms to seconds
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    const lineData: LineData<Time>[] = candleData.map((d) => ({
      time: d.time,
      value: d.close,
    }));

    candleSeriesRef.current.setData(candleData);
    lineSeriesRef.current.setData(lineData);

    // Fit content to view
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [data, chartReady]); // Re-run when data changes or chart becomes ready

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

  if (isLoading && (!data || data.length === 0)) {
    return (
      <div className={`h-full w-full flex items-center justify-center ${isDark ? "bg-[#0a0a0a]" : "bg-gray-50"}`}>
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
          <span className={`text-sm ${isDark ? "text-white/50" : "text-gray-500"}`}>Loading chart...</span>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className={`h-full w-full flex items-center justify-center text-sm ${isDark ? "bg-[#0a0a0a] text-white/40" : "bg-gray-50 text-gray-400"}`}>
        No price data available
      </div>
    );
  }

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

        {/* Chart type toggle */}
        <div className="flex gap-1">
          <button
            onClick={() => setChartType("line")}
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
            onClick={() => setChartType("candle")}
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
      </div>

      {/* Chart container */}
      <div ref={chartContainerRef} className="h-full w-full" />
    </div>
  );
}
