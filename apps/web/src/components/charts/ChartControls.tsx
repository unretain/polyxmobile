"use client";

import { cn } from "@/lib/utils";
import { LINE_PERIODS, CANDLE_PERIODS, PULSE_PERIODS, type ChartType } from "@/stores/chartStore";
import { useThemeStore } from "@/stores/themeStore";

interface ChartControlsProps {
  period: string;
  chartType: ChartType;
  onPeriodChange: (period: string) => void;
  showPulseOption?: boolean; // Show 1s option for Pulse tokens
  isLoading?: boolean; // Show loading state on the selected timeframe button
}

export function ChartControls({ period, chartType, onPeriodChange, showPulseOption = false, isLoading = false }: ChartControlsProps) {
  const { isDark } = useThemeStore();

  // Line chart: periods are TIME RANGES (1m = last minute, 15m = last 15 minutes)
  // Candle chart: periods are CANDLE INTERVALS (1m = 1-minute candles, 1s = per-trade)
  const basePeriods = chartType === "candle" ? CANDLE_PERIODS : LINE_PERIODS;

  // 1s (per-trade) option is ONLY for candlestick chart on Pulse tokens
  const periods = (showPulseOption && chartType === "candle")
    ? [...PULSE_PERIODS, ...basePeriods]
    : basePeriods;

  return (
    // Scrolls horizontally on its own: with the sub-minute tiers there are now 12
    // timeframes, far more than fits on a phone. Only THIS row scrolls, so the rest
    // of the chart header stays put.
    <div
      className={`tf-scroll flex items-center gap-0.5 md:gap-1 p-0.5 md:p-1 overflow-x-auto max-w-full ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}
    >
      {periods.map((p) => (
        <button
          key={p.value}
          // Never let a label wrap or shrink — they must stay tappable while scrolling.
          onClick={() => onPeriodChange(p.value)}
          disabled={isLoading}
          className={cn(
            "px-2 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium transition-colors relative flex-shrink-0 whitespace-nowrap",
            period === p.value
              ? "bg-[#FF6B4A] text-white"
              : isDark
                ? "text-white/60 hover:bg-white/10 hover:text-white"
                : "text-gray-600 hover:bg-gray-200 hover:text-gray-900",
            // Highlight 1s option with a different color when available
            ["1s", "5s", "15s", "30s"].includes(p.value) && period !== p.value && "text-[#FF6B4A]/70 hover:text-[#FF6B4A]",
            // Disabled state when loading
            isLoading && "opacity-50 cursor-wait"
          )}
        >
          {/* Show spinner on the selected button when loading */}
          {isLoading && period === p.value ? (
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span className="hidden md:inline">{p.label}</span>
            </span>
          ) : (
            p.label
          )}
        </button>
      ))}
    </div>
  );
}
