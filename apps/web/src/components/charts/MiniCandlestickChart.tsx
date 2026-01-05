"use client";

import { useMemo } from "react";
import type { OHLCV } from "@/stores/pulseStore";
import { formatMC, formatChartPrice } from "@/lib/utils";

interface MiniCandlestickChartProps {
  data: OHLCV[];
  isLoading?: boolean;
  showMarketCap?: boolean;
  currentMarketCap?: number;
}

// Pump.fun tokens have 1 billion supply
const PUMP_FUN_SUPPLY = 1_000_000_000;

export function MiniCandlestickChart({
  data,
  isLoading,
  showMarketCap = false,
  currentMarketCap,
}: MiniCandlestickChartProps) {
  // Generate mock data if no real data (for new tokens with no trades yet)
  const displayData = useMemo(() => {
    if (data.length > 0) return data;

    // Generate mock candlestick data for tokens with no OHLCV yet
    if (currentMarketCap && currentMarketCap > 0) {
      const price = currentMarketCap / PUMP_FUN_SUPPLY;
      const now = Date.now();
      return Array.from({ length: 20 }, (_, i) => {
        const variance = 0.02;
        const trend = Math.sin(i / 3) * 0.01;
        const basePrice = price * (1 + trend);
        return {
          timestamp: now - (20 - i) * 60000,
          open: basePrice * (1 - Math.random() * variance),
          high: basePrice * (1 + Math.random() * variance),
          low: basePrice * (1 - Math.random() * variance),
          close: basePrice * (1 + (Math.random() - 0.5) * variance),
          volume: Math.random() * 1000,
        };
      });
    }

    return [];
  }, [data, currentMarketCap]);

  // Calculate price bounds
  const bounds = useMemo(() => {
    if (displayData.length === 0) {
      return { min: 0, max: 1, range: 1 };
    }

    let min = Infinity;
    let max = -Infinity;

    for (const candle of displayData) {
      if (isFinite(candle.low) && candle.low > 0) min = Math.min(min, candle.low);
      if (isFinite(candle.high) && candle.high > 0) max = Math.max(max, candle.high);
    }

    if (!isFinite(min) || !isFinite(max) || min === max) {
      const mid = isFinite(min) && min > 0 ? min : 1;
      return { min: mid * 0.95, max: mid * 1.05, range: mid * 0.1 };
    }

    const padding = (max - min) * 0.1;
    return { min: min - padding, max: max + padding, range: max - min + padding * 2 };
  }, [displayData]);

  // Y-axis labels
  const yLabels = useMemo(() => {
    const labels: { value: number; text: string }[] = [];
    for (let i = 0; i <= 2; i++) {
      const value = bounds.min + (i / 2) * bounds.range;
      const displayValue = showMarketCap ? value * PUMP_FUN_SUPPLY : value;
      const text = showMarketCap ? formatMC(displayValue) : formatChartPrice(displayValue);
      labels.push({ value, text });
    }
    return labels;
  }, [bounds, showMarketCap]);

  if (isLoading && displayData.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-black/30 rounded-lg">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (displayData.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-black/30 rounded-lg text-muted-foreground text-xs">
        No data
      </div>
    );
  }

  const chartWidth = 200;
  const chartHeight = 100;
  const padding = { top: 5, right: 5, bottom: 5, left: 40 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const candleWidth = Math.max(2, Math.min(8, (innerWidth / displayData.length) * 0.8));
  const candleGap = (innerWidth - candleWidth * displayData.length) / (displayData.length - 1 || 1);

  // Normalize price to chart coordinates
  const normalizeY = (price: number) => {
    if (bounds.range === 0) return innerHeight / 2;
    return innerHeight - ((price - bounds.min) / bounds.range) * innerHeight;
  };

  return (
    <div className="h-full w-full rounded-lg overflow-hidden bg-black/40 p-1">
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Background */}
        <rect
          x={padding.left}
          y={padding.top}
          width={innerWidth}
          height={innerHeight}
          fill="rgba(0,0,0,0.3)"
          rx={2}
        />

        {/* Grid lines */}
        {[0, 1, 2].map((i) => {
          const y = padding.top + (i / 2) * innerHeight;
          return (
            <line
              key={`grid-${i}`}
              x1={padding.left}
              y1={y}
              x2={padding.left + innerWidth}
              y2={y}
              stroke="rgba(255,255,255,0.1)"
              strokeWidth={0.5}
            />
          );
        })}

        {/* Y-axis labels */}
        {yLabels.map((label, i) => {
          const y = padding.top + ((2 - i) / 2) * innerHeight;
          return (
            <text
              key={`y-label-${i}`}
              x={padding.left - 3}
              y={y}
              fill="#666"
              fontSize={6}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {label.text}
            </text>
          );
        })}

        {/* Candlesticks */}
        {displayData.map((candle, index) => {
          const x = padding.left + index * (candleWidth + candleGap) + candleWidth / 2;
          const isUp = candle.close >= candle.open;
          const color = isUp ? "#22c55e" : "#ef4444";

          const highY = normalizeY(candle.high) + padding.top;
          const lowY = normalizeY(candle.low) + padding.top;
          const openY = normalizeY(candle.open) + padding.top;
          const closeY = normalizeY(candle.close) + padding.top;

          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.max(Math.abs(closeY - openY), 1);

          const isLatest = index === displayData.length - 1;

          return (
            <g key={`${candle.timestamp}-${index}`}>
              {/* Wick */}
              <line
                x1={x}
                y1={highY}
                x2={x}
                y2={lowY}
                stroke={color}
                strokeWidth={1}
              />
              {/* Body */}
              <rect
                x={x - candleWidth / 2}
                y={bodyTop}
                width={candleWidth}
                height={bodyHeight}
                fill={color}
                stroke={isLatest ? "#fff" : "none"}
                strokeWidth={isLatest ? 0.5 : 0}
                rx={0.5}
              />
            </g>
          );
        })}

        {/* Latest price indicator */}
        {displayData.length > 0 && (
          <>
            <line
              x1={padding.left}
              y1={normalizeY(displayData[displayData.length - 1].close) + padding.top}
              x2={padding.left + innerWidth}
              y2={normalizeY(displayData[displayData.length - 1].close) + padding.top}
              stroke={displayData[displayData.length - 1].close >= displayData[displayData.length - 1].open ? "#22c55e" : "#ef4444"}
              strokeWidth={0.5}
              strokeDasharray="2,2"
              opacity={0.5}
            />
          </>
        )}
      </svg>
    </div>
  );
}
