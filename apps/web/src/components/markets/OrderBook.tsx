"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/themeStore";

interface OrderBookProps {
  yesProbability: number;
  volume: number;
  liquidity: number;
  className?: string;
}

interface OrderLevel {
  price: number;
  size: number;
  total: number;
}

// Generate realistic-looking order book data based on the current probability
function generateOrderBook(probability: number, volume: number, liquidity: number): {
  bids: OrderLevel[];
  asks: OrderLevel[];
} {
  const bids: OrderLevel[] = [];
  const asks: OrderLevel[] = [];

  const yesPrice = probability;
  const spread = 0.01; // 1 cent spread

  // Generate bid levels (buy orders below current price)
  let bidTotal = 0;
  for (let i = 0; i < 10; i++) {
    const price = Math.max(0.01, yesPrice - spread - i * 0.01);
    const baseSize = (liquidity / 20) * (1 - i * 0.08) * (0.8 + Math.random() * 0.4);
    const size = Math.max(100, Math.round(baseSize));
    bidTotal += size;
    bids.push({ price, size, total: bidTotal });
  }

  // Generate ask levels (sell orders above current price)
  let askTotal = 0;
  for (let i = 0; i < 10; i++) {
    const price = Math.min(0.99, yesPrice + spread + i * 0.01);
    const baseSize = (liquidity / 20) * (1 - i * 0.08) * (0.8 + Math.random() * 0.4);
    const size = Math.max(100, Math.round(baseSize));
    askTotal += size;
    asks.push({ price, size, total: askTotal });
  }

  return { bids, asks };
}

function formatPrice(price: number): string {
  return `${Math.round(price * 100)}¢`;
}

function formatSize(size: number): string {
  if (size >= 1000000) return `${(size / 1000000).toFixed(1)}M`;
  if (size >= 1000) return `${(size / 1000).toFixed(1)}K`;
  return size.toFixed(0);
}

export function OrderBook({ yesProbability, volume, liquidity, className }: OrderBookProps) {
  const { isDark } = useThemeStore();
  const { bids, asks } = useMemo(
    () => generateOrderBook(yesProbability, volume, liquidity),
    [yesProbability, volume, liquidity]
  );

  const maxBidTotal = bids.length > 0 ? bids[bids.length - 1].total : 1;
  const maxAskTotal = asks.length > 0 ? asks[asks.length - 1].total : 1;

  return (
    <div className={cn(
      "border overflow-hidden",
      isDark ? "bg-[#0a0a0a] border-white/10" : "bg-white border-black/10",
      className
    )}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${
        isDark ? 'border-white/10' : 'border-black/10'
      }`}>
        <h3 className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Order Book</h3>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-green-400">Bids</span>
          <span className={isDark ? 'text-white/30' : 'text-gray-300'}>/</span>
          <span className="text-red-400">Asks</span>
        </div>
      </div>

      {/* Spread indicator */}
      <div className={`flex items-center justify-center py-2 border-b ${
        isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
      }`}>
        <span className={`text-xs ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
          Spread: <span className={isDark ? 'text-white' : 'text-gray-900'}>1¢</span> (1.0%)
        </span>
      </div>

      {/* Column headers */}
      <div className={`grid grid-cols-3 gap-2 px-4 py-2 text-[10px] uppercase border-b ${
        isDark ? 'text-white/40 border-white/5' : 'text-gray-400 border-black/5'
      }`}>
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      {/* Order book content */}
      <div className="flex flex-col max-h-[400px] overflow-y-auto">
        {/* Asks (sell orders) - reversed so lowest ask is at bottom */}
        <div className="flex flex-col-reverse">
          {asks.map((level, i) => {
            const depthPercent = (level.total / maxAskTotal) * 100;
            return (
              <div
                key={`ask-${i}`}
                className={`relative grid grid-cols-3 gap-2 px-4 py-1.5 transition-colors group ${
                  isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'
                }`}
              >
                {/* Depth bar */}
                <div
                  className="absolute inset-y-0 right-0 bg-red-500/10 transition-all"
                  style={{ width: `${depthPercent}%` }}
                />
                <span className="relative z-10 text-xs text-red-400 font-mono">
                  {formatPrice(level.price)}
                </span>
                <span className={`relative z-10 text-xs text-right font-mono ${
                  isDark ? 'text-white/70' : 'text-gray-600'
                }`}>
                  {formatSize(level.size)}
                </span>
                <span className={`relative z-10 text-xs text-right font-mono ${
                  isDark ? 'text-white/50' : 'text-gray-400'
                }`}>
                  {formatSize(level.total)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Current price indicator */}
        <div className="flex items-center justify-center py-3 bg-[#FF6B4A]/10 border-y border-[#FF6B4A]/30">
          <span className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {formatPrice(yesProbability)}
          </span>
          <span className={`ml-2 text-sm ${isDark ? 'text-white/50' : 'text-gray-500'}`}>Yes</span>
        </div>

        {/* Bids (buy orders) */}
        <div className="flex flex-col">
          {bids.map((level, i) => {
            const depthPercent = (level.total / maxBidTotal) * 100;
            return (
              <div
                key={`bid-${i}`}
                className={`relative grid grid-cols-3 gap-2 px-4 py-1.5 transition-colors group ${
                  isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'
                }`}
              >
                {/* Depth bar */}
                <div
                  className="absolute inset-y-0 right-0 bg-green-500/10 transition-all"
                  style={{ width: `${depthPercent}%` }}
                />
                <span className="relative z-10 text-xs text-green-400 font-mono">
                  {formatPrice(level.price)}
                </span>
                <span className={`relative z-10 text-xs text-right font-mono ${
                  isDark ? 'text-white/70' : 'text-gray-600'
                }`}>
                  {formatSize(level.size)}
                </span>
                <span className={`relative z-10 text-xs text-right font-mono ${
                  isDark ? 'text-white/50' : 'text-gray-400'
                }`}>
                  {formatSize(level.total)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer stats */}
      <div className={`grid grid-cols-2 gap-4 px-4 py-3 border-t ${
        isDark ? 'border-white/10 bg-white/5' : 'border-black/10 bg-black/5'
      }`}>
        <div className="text-center">
          <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-400'}`}>Total Bids</p>
          <p className="text-sm font-bold text-green-400">${formatSize(maxBidTotal)}</p>
        </div>
        <div className="text-center">
          <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-400'}`}>Total Asks</p>
          <p className="text-sm font-bold text-red-400">${formatSize(maxAskTotal)}</p>
        </div>
      </div>
    </div>
  );
}
