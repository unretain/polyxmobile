"use client";

import { cn } from "@/lib/utils";
import { LINE_PERIODS, CANDLE_PERIODS, PULSE_PERIOD, type ChartType } from "@/stores/chartStore";
import { useThemeStore } from "@/stores/themeStore";

interface ChartControlsProps {
  period: string;
  chartType: ChartType;
  onPeriodChange: (period: string) => void;
  showPulseOption?: boolean; // Show 1s option for Pulse tokens
}

export function ChartControls({ period, chartType, onPeriodChange, showPulseOption = false }: ChartControlsProps) {
  const { isDark } = useThemeStore();

  // Line chart: periods are TIME RANGES (1m = last minute, 15m = last 15 minutes)
  // Candle chart: periods are CANDLE INTERVALS (1m = 1-minute candles, 1s = per-trade)
  const basePeriods = chartType === "candle" ? CANDLE_PERIODS : LINE_PERIODS;

  // 1s (per-trade) option is ONLY for candlestick chart on Pulse tokens
  const periods = (showPulseOption && chartType === "candle")
    ? [PULSE_PERIOD, ...basePeriods]
    : basePeriods;

  return (
    <div className={`flex items-center gap-0.5 md:gap-1 p-0.5 md:p-1 ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
      {periods.map((p) => (
        <button
          key={p.value}
          onClick={() => onPeriodChange(p.value)}
          className={cn(
            "px-2 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium transition-colors",
            period === p.value
              ? "bg-[#FF6B4A] text-white"
              : isDark
                ? "text-white/60 hover:bg-white/10 hover:text-white"
                : "text-gray-600 hover:bg-gray-200 hover:text-gray-900",
            // Highlight 1s option with a different color when available
            p.value === "1s" && period !== "1s" && "text-[#FF6B4A]/70 hover:text-[#FF6B4A]"
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
