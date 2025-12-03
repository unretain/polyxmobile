"use client";

import { useMemo } from "react";
import type { OHLCV } from "@/stores/chartStore";

interface MiniSparklineProps {
  data: OHLCV[];
  isLoading?: boolean;
  height?: number;
}

export function MiniSparkline({ data, isLoading, height = 96 }: MiniSparklineProps) {
  // Calculate the sparkline path and fill area
  const { linePath, areaPath, isPositive, priceRange } = useMemo(() => {
    if (data.length < 2) {
      return { linePath: "", areaPath: "", isPositive: true, priceRange: { min: 0, max: 1 } };
    }

    // Get closing prices
    const prices = data.map((d) => d.close);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;

    // Determine if price went up or down overall
    const isUp = prices[prices.length - 1] >= prices[0];

    // Normalize prices to SVG coordinates
    const width = 100; // SVG viewBox width (percentage)
    const svgHeight = height - 8; // Leave some padding
    const padding = 4;

    const points = prices.map((price, i) => {
      const x = (i / (prices.length - 1)) * width;
      const y = padding + ((max - price) / range) * (svgHeight - padding * 2);
      return { x, y };
    });

    // Create line path
    const linePathStr = points
      .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
      .join(" ");

    // Create area path (line path + close to bottom)
    const areaPathStr = `${linePathStr} L ${width} ${svgHeight} L 0 ${svgHeight} Z`;

    return {
      linePath: linePathStr,
      areaPath: areaPathStr,
      isPositive: isUp,
      priceRange: { min, max },
    };
  }, [data, height]);

  if (isLoading) {
    return (
      <div
        className="w-full flex items-center justify-center bg-black/30 rounded-lg"
        style={{ height }}
      >
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (data.length < 2) {
    return (
      <div
        className="w-full flex items-center justify-center bg-black/30 rounded-lg text-muted-foreground text-xs"
        style={{ height }}
      >
        No chart data
      </div>
    );
  }

  const strokeColor = isPositive ? "#22c55e" : "#ef4444";
  const fillColor = isPositive ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)";

  return (
    <div
      className="w-full bg-black/30 rounded-lg overflow-hidden"
      style={{ height }}
    >
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full h-full"
      >
        {/* Gradient fill under the line */}
        <defs>
          <linearGradient id={`gradient-${isPositive ? 'up' : 'down'}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Area fill */}
        <path
          d={areaPath}
          fill={`url(#gradient-${isPositive ? 'up' : 'down'})`}
        />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Current price dot */}
        {data.length > 0 && (
          <circle
            cx="100"
            cy={4 + ((priceRange.max - data[data.length - 1].close) / (priceRange.max - priceRange.min || 1)) * (height - 16)}
            r="2"
            fill={strokeColor}
          />
        )}
      </svg>
    </div>
  );
}
