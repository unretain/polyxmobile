"use client";

import { useMemo } from "react";
import { Text } from "@react-three/drei";
import type { OHLCV } from "@/stores/chartStore";

// pump.fun tokens have 1 billion supply
const PUMP_FUN_SUPPLY = 1_000_000_000;

// Format value for Y-axis labels - handles both high-value and low-value tokens
// For market cap: shows larger values (K, M, B)
// For price: shows smaller decimal values
function formatAxisValue(value: number, isMarketCap: boolean): string {
  if (isMarketCap) {
    // Market cap formatting (larger numbers)
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  }
  // Price formatting (smaller numbers for micro-cap tokens)
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  if (value >= 0.0001) return `$${value.toFixed(6)}`;
  return `$${value.toExponential(2)}`;
}

// Format date based on timeframe - intelligently chooses format based on data range
function formatDateLabel(timestamp: number, showYear: boolean, showTime: boolean): string {
  const date = new Date(timestamp);

  if (showTime) {
    // For short timeframes (intraday), show time
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    if (minutes === 0) {
      return `${hour12}${ampm}`;
    }
    return `${hour12}:${minutes.toString().padStart(2, '0')}`;
  }

  const month = date.toLocaleString('default', { month: 'short' });
  const day = date.getDate();

  if (showYear) {
    const year = date.getFullYear().toString().slice(-2);
    return `${month} '${year}`;
  }

  return `${month} ${day}`;
}

interface ChartAxisProps {
  minPrice: number;
  maxPrice: number;
  candleCount: number;
  chartWidth: number;
  chartHeight: number;
  showMarketCap?: boolean;
  // NEW: Pass actual OHLCV data for date labels
  data?: OHLCV[];
  spacing?: number;
  isDark?: boolean;
}

export function ChartAxis({
  minPrice,
  maxPrice,
  candleCount,
  chartWidth,
  chartHeight,
  showMarketCap = false,
  data = [],
  spacing = 1.2,
  isDark = true,
}: ChartAxisProps) {
  // Theme-aware colors
  const labelColor = isDark ? "#888" : "#666";
  const axisLabelColor = isDark ? "#aaa" : "#555";
  // For Pulse tokens (showMarketCap=true): multiply price by supply to show market cap
  // For Dashboard tokens (showMarketCap=false): show actual price
  const multiplier = showMarketCap ? PUMP_FUN_SUPPLY : 1;
  const minValue = minPrice * multiplier;
  const maxValue = maxPrice * multiplier;

  // Generate price labels
  const priceLabels = useMemo(() => {
    const labels = [];
    const priceSteps = 5;
    const valueRange = maxValue - minValue;

    for (let i = 0; i <= priceSteps; i++) {
      const value = minValue + (valueRange * i) / priceSteps;
      const yPosition = (i / priceSteps) * chartHeight;

      labels.push({
        value,
        position: [-2, yPosition, 0] as [number, number, number],
      });
    }
    return labels;
  }, [minValue, maxValue, chartHeight]);

  // Generate date labels from actual OHLCV timestamps
  const dateLabels = useMemo(() => {
    if (data.length === 0) return [];

    const labels: { text: string; position: [number, number, number] }[] = [];

    // Determine time range to decide formatting
    const firstTimestamp = data[0].timestamp;
    const lastTimestamp = data[data.length - 1].timestamp;
    const timeRangeMs = lastTimestamp - firstTimestamp;
    const timeRangeHours = timeRangeMs / (1000 * 60 * 60);
    const timeRangeDays = timeRangeHours / 24;

    // Decide format based on time range
    const showTime = timeRangeHours <= 48; // Show time for data under 2 days
    const showYear = timeRangeDays > 180; // Show year for data over 6 months

    // Calculate how many labels to show (5-8 labels)
    const labelCount = Math.min(8, Math.max(5, Math.floor(data.length / 15)));

    // Evenly space labels across the data
    for (let i = 0; i < labelCount; i++) {
      const dataIndex = Math.floor((i / (labelCount - 1)) * (data.length - 1));
      const candle = data[dataIndex];
      if (!candle) continue;

      // X position based on candle index and spacing
      const xPosition = dataIndex * spacing;

      labels.push({
        text: formatDateLabel(candle.timestamp, showYear, showTime),
        position: [xPosition, -1.8, 0] as [number, number, number],
      });
    }

    return labels;
  }, [data, spacing]);

  return (
    <group>
      {/* Y-axis (Price) */}
      <mesh position={[-0.5, chartHeight / 2, 0]}>
        <boxGeometry args={[0.03, chartHeight, 0.03]} />
        <meshBasicMaterial color="#FF6B4A" transparent opacity={0.4} />
      </mesh>

      {/* Price/Market Cap labels */}
      {priceLabels.map(({ value, position }, index) => (
        <Text
          key={`price-${index}`}
          position={position}
          fontSize={0.32}
          color={labelColor}
          anchorX="right"
          anchorY="middle"
        >
          {formatAxisValue(value, showMarketCap)}
        </Text>
      ))}

      {/* X-axis (Time) */}
      <mesh position={[chartWidth / 2, 0, 0]}>
        <boxGeometry args={[chartWidth, 0.03, 0.03]} />
        <meshBasicMaterial color="#FF6B4A" transparent opacity={0.4} />
      </mesh>

      {/* Date labels - positioned below X axis, in front of volume bars */}
      {dateLabels.map(({ text, position }, index) => (
        <Text
          key={`date-${index}`}
          position={[position[0], position[1], 8]}
          fontSize={0.7}
          color={axisLabelColor}
          anchorX="center"
          anchorY="top"
          renderOrder={10}
        >
          {text}
        </Text>
      ))}

      {/* Axis labels */}
      <Text
        position={[-5, chartHeight / 2, 0]}
        fontSize={0.35}
        color={axisLabelColor}
        anchorX="center"
        anchorY="middle"
        rotation={[0, 0, Math.PI / 2]}
      >
        {showMarketCap ? "Market Cap" : "Price (USD)"}
      </Text>

      <Text
        position={[chartWidth / 2, -2.8, 8]}
        fontSize={0.5}
        color={axisLabelColor}
        anchorX="center"
        anchorY="middle"
        renderOrder={10}
      >
        Time
      </Text>
    </group>
  );
}
