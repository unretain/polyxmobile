"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { useThemeStore } from "@/stores/themeStore";
import { WalletOnboarding } from "@/components/wallet/WalletOnboarding";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";

// Dynamic import for TradingView Chart (2D)
const TradingViewChart = dynamic(
  () => import("@/components/charts/TradingViewChart").then((mod) => mod.TradingViewChart),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-transparent flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
      </div>
    ),
  }
);

const SOL_ADDRESS = "So11111111111111111111111111111111111111112";
const WETH_ADDRESS = "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs";
// API calls go through Next.js proxy routes (protects internal API key)

// Featured tokens for carousel
const FEATURED_TOKENS = [
  { address: SOL_ADDRESS, symbol: "SOL", name: "Solana", logo: "/solana-logo.png", fallbackColor: "#9945FF" },
  { address: WETH_ADDRESS, symbol: "WETH", name: "Wrapped Ether", logo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png", fallbackColor: "#627EEA" },
];

interface OHLCVCandle {
  open: number;
  high: number;
  close: number;
  low: number;
  volume: number;
  timestamp: number;
}

type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M";

// Background component with theme support
function StarBackground({ isDark }: { isDark: boolean }) {
  return (
    <div className="fixed inset-0 z-0 transition-colors duration-300">
      <div className={`absolute inset-0 ${isDark ? 'bg-[#0a0a0a]' : 'bg-[#f5f5f5]'}`} />
      <div className={`absolute inset-0 star-grid ${isDark ? 'opacity-20' : 'opacity-10'}`} />
    </div>
  );
}

// Mini sparkline chart for cards
function Sparkline({ data, positive, width = 120, height = 40 }: { data: number[]; positive: boolean; width?: number; height?: number }) {
  const padding = 4;

  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((value, index) => {
      const x = padding + (index / (data.length - 1)) * (width - padding * 2);
      const y = height - padding - ((value - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`spark-gradient-${positive ? "up" : "down"}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={positive ? "#22c55e" : "#ef4444"} stopOpacity="0.3" />
          <stop offset="100%" stopColor={positive ? "#22c55e" : "#ef4444"} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`${padding},${height - padding} ${points} ${width - padding},${height - padding}`}
        fill={`url(#spark-gradient-${positive ? "up" : "down"})`}
      />
      <polyline
        points={points}
        fill="none"
        stroke={positive ? "#22c55e" : "#ef4444"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}


// Timeframe selector component
function TimeframeSelector({
  timeframe,
  onTimeframeChange,
  isDark
}: {
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  isDark: boolean;
}) {
  // Show fewer timeframes on mobile
  const allTimeframes: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"];
  const mobileTimeframes: Timeframe[] = ["5m", "1h", "4h", "1d"];

  return (
    <div className={`flex items-center gap-0.5 md:gap-1 p-1 rounded-lg ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
      {/* Mobile: show limited timeframes */}
      <div className="flex md:hidden">
        {mobileTimeframes.map((tf) => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            className={`px-2 py-1 rounded-md text-xs font-mono transition-colors ${
              timeframe === tf
                ? 'bg-[#FF6B4A] text-white'
                : isDark
                  ? 'text-white/60 hover:text-white hover:bg-white/5'
                  : 'text-black/60 hover:text-black hover:bg-black/5'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>
      {/* Desktop: show all timeframes */}
      <div className="hidden md:flex gap-1">
        {allTimeframes.map((tf) => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
              timeframe === tf
                ? 'bg-[#FF6B4A] text-white'
                : isDark
                  ? 'text-white/60 hover:text-white hover:bg-white/5'
                  : 'text-black/60 hover:text-black hover:bg-black/5'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>
    </div>
  );
}

// Token Logo component - handles both image and fallback
function TokenLogo({ token, size = 48 }: { token: typeof FEATURED_TOKENS[0]; size?: number }) {
  if (token.logo) {
    return (
      <Image
        src={token.logo}
        alt={token.symbol}
        width={size}
        height={size}
        className="rounded-xl"
        unoptimized
      />
    );
  }

  // Fallback to colored box with symbol
  return (
    <div
      className="rounded-xl flex items-center justify-center font-bold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: token.fallbackColor,
        fontSize: size * 0.35,
      }}
    >
      {token.symbol.charAt(0)}
    </div>
  );
}

// Twitter/X icon component
function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function LandingPage() {
  const { isDark } = useThemeStore();
  const router = useRouter();
  const { wallet, _hasHydrated } = useMobileWalletStore();
  const [tokenIndex, setTokenIndex] = useState(0);
  const [tokenPrice, setTokenPrice] = useState<number | null>(null);
  const [candles, setCandles] = useState<OHLCVCandle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<Timeframe>("4h");
  const [isWalletOnboardingOpen, setIsWalletOnboardingOpen] = useState(false);

  const currentToken = FEATURED_TOKENS[tokenIndex];

  // Auto-show wallet onboarding on first load if no wallet (after hydration from localStorage)
  useEffect(() => {
    if (_hasHydrated && !wallet) {
      setIsWalletOnboardingOpen(true);
    }
  }, [wallet, _hasHydrated]);

  // Handle Launch App click - wallet only, no sign-in
  const handleLaunchApp = (e: React.MouseEvent) => {
    e.preventDefault();

    if (wallet) {
      // Already has wallet, go to app
      router.push("/pulse");
    } else {
      // Show wallet onboarding
      setIsWalletOnboardingOpen(true);
    }
  };

  // Navigate to previous token
  const goToPrevToken = () => {
    setTokenIndex((prev) => (prev === 0 ? FEATURED_TOKENS.length - 1 : prev - 1));
  };

  // Navigate to next token
  const goToNextToken = () => {
    setTokenIndex((prev) => (prev === FEATURED_TOKENS.length - 1 ? 0 : prev + 1));
  };

  // Fetch candles when timeframe or token changes
  useEffect(() => {
    setIsLoading(true);
    setTokenPrice(null);

    fetch(`/api/tokens/${currentToken.address}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.price) setTokenPrice(data.price);
      })
      .catch(() => setTokenPrice(currentToken.symbol === "SOL" ? 235 : 3018));

    fetch(`/api/tokens/${currentToken.address}/ohlcv?timeframe=${timeframe}&limit=100`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setCandles(data);
        }
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [timeframe, currentToken.address, currentToken.symbol]);

  // Auto-refresh data
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`/api/tokens/${currentToken.address}/ohlcv?timeframe=${timeframe}&limit=100`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            setCandles(data);
          }
        })
        .catch(() => {});
    }, 30000);

    return () => clearInterval(interval);
  }, [timeframe, currentToken.address]);

  const priceHistory = candles.map((c) => c.close);
  const isPositive = priceHistory.length > 1 ? priceHistory[priceHistory.length - 1] >= priceHistory[0] : true;

  return (
    <div className={`min-h-screen overflow-x-hidden transition-colors duration-300 ${isDark ? 'text-white' : 'text-black'}`}>
      <StarBackground isDark={isDark} />

      {/* Header */}
      <MobileHeader />

      {/* Main Content */}
      <main className="relative z-10 pt-16 md:pt-28 pb-6 md:pb-20 px-3 md:px-10 lg:px-16">
        <div className="max-w-[1600px] mx-auto">
          {/* Large Title - smaller on mobile */}
          <div className="text-center mb-4 md:mb-16">
            <h1 className="text-3xl sm:text-6xl md:text-8xl lg:text-9xl font-bold font-inter tracking-normal">
              <span className={isDark ? 'text-white' : 'text-black'}>[poly</span>
              <span className="text-[#FF6B4A]">x</span>
              <span className={isDark ? 'text-white' : 'text-black'}>]</span>
            </h1>
            <p className={`mt-2 md:mt-6 text-xs md:text-lg ${isDark ? 'text-white/50' : 'text-black/50'}`}>
              3D Trading Charts for Solana
            </p>
          </div>

          {/* Mobile: Chart first, then cards. Desktop: Two columns */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] gap-4 lg:gap-6">
            {/* Left Column - Cards (hidden on mobile, shown on desktop) */}
            <div className="hidden lg:block space-y-5">
              {/* Token Preview Card */}
              <div className={`rounded-2xl border p-5 card-shine ${
                isDark ? 'bg-[#1a1a1a] border-transparent' : 'bg-white border-transparent'
              }`}>
                <div className="flex items-center gap-4">
                  <TokenLogo token={currentToken} size={52} />
                  <div className="flex-1">
                    <div className={`text-xs font-mono ${isDark ? 'text-white/40' : 'text-black/40'}`}>${currentToken.symbol}</div>
                    <div className="text-xl font-bold">${tokenPrice?.toFixed(2) || "..."}</div>
                  </div>
                  <Sparkline data={priceHistory.slice(-30)} positive={isPositive} width={110} height={40} />
                </div>
              </div>

              {/* 3D Immersive Trading Card */}
              <div className={`rounded-2xl border p-5 card-shine ${
                isDark ? 'bg-[#1a1a1a] border-transparent' : 'bg-white border-transparent'
              }`}>
                <div className="flex items-center gap-4">
                  <div className={`text-center px-4 py-3 rounded-xl ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                    <div className="text-2xl font-bold">3D</div>
                    <div className={`text-xs uppercase ${isDark ? 'text-white/40' : 'text-black/40'}`}>Charts</div>
                  </div>
                  <div className="flex-1">
                    <div className={`text-xs uppercase tracking-wider ${isDark ? 'text-white/40' : 'text-black/40'}`}>[POLYX]</div>
                    <div className="font-medium">Immersive Trading</div>
                  </div>
                  <div className={`w-9 h-9 rounded-full border flex items-center justify-center ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v8M8 12h8" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Launch App Card */}
              <div className={`rounded-2xl border p-5 card-shine ${
                isDark ? 'bg-[#1a1a1a] border-transparent' : 'bg-white border-transparent'
              }`}>
                <button
                  onClick={handleLaunchApp}
                  className={`flex items-center justify-between w-full px-5 py-4 rounded-xl border transition-colors ${
                    isDark
                      ? 'bg-white/5 border-white/10 hover:bg-white/10'
                      : 'bg-black/5 border-black/10 hover:bg-black/10'
                  }`}
                >
                  <span className="font-medium">Launch App</span>
                  <span className={`text-sm ${isDark ? 'text-white/40' : 'text-black/40'}`}>Enter</span>
                </button>
              </div>
            </div>

            {/* Right Column - Featured Chart (shows first on mobile via order) */}
            <div
              className="relative rounded-2xl overflow-hidden group order-first lg:order-none"
            >
              {/* Chart container - base layer */}
              <div className="relative flex flex-col h-[65vh] min-h-[400px] max-h-[700px] lg:h-[640px]">
                {/* Top bar with token info and timeframe */}
                <div className="relative z-20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 md:p-5">
                  <div className="flex items-center gap-3 md:gap-4">
                    <TokenLogo token={currentToken} size={36} />
                    <div className="flex items-center gap-2 md:gap-3">
                      <Sparkline data={priceHistory.slice(-20)} positive={isPositive} width={60} height={24} />
                      <span className={`font-mono text-xs md:text-sm ${isDark ? 'text-white/60' : 'text-black/60'}`}>${currentToken.symbol}</span>
                    </div>
                  </div>
                  <TimeframeSelector
                    timeframe={timeframe}
                    onTimeframeChange={setTimeframe}
                    isDark={isDark}
                  />
                </div>

                {/* Chart Area - TradingView 2D */}
                <div className="flex-1 relative">
                  <div className="absolute inset-0">
                    <TradingViewChart
                      data={candles}
                      isLoading={isLoading}
                    />
                  </div>
                </div>

                {/* Token info bar at bottom - outside chart area */}
                <div className="relative z-20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 md:p-5 border-t border-white/5">
                  <div className="flex items-center gap-3 md:gap-6 flex-wrap">
                    <div className="text-xl md:text-3xl font-bold lowercase">{currentToken.symbol}</div>
                    <div className="flex items-center gap-3 md:gap-6 text-xs md:text-sm">
                      <div>
                        <div className={`text-[10px] md:text-xs uppercase ${isDark ? 'text-white/40' : 'text-black/40'}`}>Price</div>
                        <div className="font-mono">${tokenPrice?.toFixed(2) || "..."}</div>
                      </div>
                      <div>
                        <div className={`text-[10px] md:text-xs uppercase ${isDark ? 'text-white/40' : 'text-black/40'}`}>24h</div>
                        <div className={`font-mono ${isPositive ? "text-green-500" : "text-red-500"}`}>
                          {isPositive ? "+" : ""}{priceHistory.length > 1 ? ((priceHistory[priceHistory.length - 1] - priceHistory[0]) / priceHistory[0] * 100).toFixed(2) : 0}%
                        </div>
                      </div>
                      <div className="hidden sm:block">
                        <div className={`text-[10px] md:text-xs uppercase ${isDark ? 'text-white/40' : 'text-black/40'}`}>Token</div>
                        <div className="font-mono">{currentToken.name}</div>
                      </div>
                    </div>
                  </div>

                  {/* Navigation arrows */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={goToPrevToken}
                      className={`w-8 h-8 md:w-10 md:h-10 rounded-full border flex items-center justify-center transition-colors ${
                        isDark ? 'border-white/10 hover:bg-white/5 hover:border-[#FF6B4A]/30' : 'border-black/10 hover:bg-black/5'
                      }`}
                    >
                      <ChevronRight className="w-4 h-4 md:w-5 md:h-5 rotate-180" />
                    </button>
                    <button
                      onClick={goToNextToken}
                      className={`w-8 h-8 md:w-10 md:h-10 rounded-full border flex items-center justify-center transition-colors ${
                        isDark ? 'border-white/10 hover:bg-white/5 hover:border-[#FF6B4A]/30' : 'border-black/10 hover:bg-black/5'
                      }`}
                    >
                      <ChevronRight className="w-4 h-4 md:w-5 md:h-5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Coral/Orange glow overlay - on top of chart, pointer-events-none */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none z-10">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px]">
                  <div className="absolute inset-0 bg-gradient-radial from-[#FF6B4A]/30 via-[#FF6B4A]/10 to-transparent blur-[60px]" />
                </div>
              </div>

              {/* Vertical token ticker overlay - commented out for now
              <div
                className={`absolute top-0 bottom-0 flex items-center pointer-events-none select-none z-[1] transition-transform duration-500 ease-out ${isChartHovered ? 'translate-x-[20%]' : 'translate-x-0'}`}
                style={{ left: '15%' }}
              >
                <span
                  className={`text-[120px] md:text-[160px] font-black tracking-tight leading-none uppercase ${isDark ? 'text-white/[0.04]' : 'text-black/[0.04]'}`}
                  style={{ writingMode: 'vertical-rl' }}
                >
                  ${currentToken.symbol}
                </span>
              </div>
              */}
            </div>
          </div>

          {/* Mobile CTA - Simple launch button */}
          <div className="lg:hidden mt-4">
            <button
              onClick={handleLaunchApp}
              className="w-full rounded-2xl bg-[#FF6B4A] py-4 px-5 active:scale-[0.98] transition-all"
            >
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-white">Launch App</span>
                <ChevronRight className="w-5 h-5 text-white" />
              </div>
            </button>
          </div>

          {/* Desktop Bottom Row - CTA Cards */}
          <div className="hidden lg:grid grid-cols-[minmax(0,1fr)_minmax(0,3fr)] gap-6 mt-6">
            {/* Left: View Pulse Card */}
            <Link
              href="/pulse"
              className={`group rounded-2xl border py-6 px-5 card-shine hover:scale-[1.02] transition-all flex items-center gap-4 ${
                isDark ? 'bg-[#1a1a1a] hover:bg-[#252525] border-transparent' : 'bg-white hover:bg-gray-100 border-transparent'
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div className="ios-cylinder" style={{ width: "120px" }}>
                <div className="ios-cylinder-inner">
                  <div className="ios-cylinder-face ios-cylinder-front">
                    <span className="text-lg font-bold whitespace-nowrap">View Pulse</span>
                  </div>
                  <div className="ios-cylinder-face ios-cylinder-bottom">
                    <span className="text-lg font-bold text-[#FF6B4A] whitespace-nowrap">Trade now</span>
                  </div>
                </div>
              </div>
            </Link>

            {/* Right: cards under chart - 3 columns */}
            <div className="grid grid-cols-3 gap-4">
              <button
                onClick={handleLaunchApp}
                className="group rounded-2xl bg-[#FF6B4A] py-6 px-5 hover:scale-[1.02] transition-all relative overflow-hidden text-left"
              >
                <div className="relative flex flex-col justify-between h-full">
                  <div className="text-lg font-bold text-white">Ready to trade?</div>
                  <div className="flex items-center justify-end mt-3">
                    <span className="text-lg font-bold text-black whitespace-nowrap transition-transform duration-500 ease-out group-hover:-translate-x-6">
                      Launch the app
                    </span>
                    <div className="h-[2px] w-0 group-hover:w-20 bg-black transition-all duration-500 ease-out ml-2" />
                  </div>
                </div>
              </button>

              <Link
                href="/docs"
                className={`group rounded-2xl border py-6 px-5 card-shine hover:scale-[1.02] transition-all flex items-center justify-center relative overflow-hidden ${
                  isDark ? 'bg-[#1a1a1a] hover:bg-[#252525] border-transparent' : 'bg-white hover:bg-gray-100 border-transparent'
                }`}
              >
                <div className="absolute top-0 left-0 right-0 h-px animated-line" />
                <div className="flex items-center gap-3">
                  <svg className={`w-5 h-5 flex-shrink-0 ${isDark ? 'text-white/60' : 'text-black/60'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  <div className="ios-cylinder" style={{ width: "90px" }}>
                    <div className="ios-cylinder-inner">
                      <div className="ios-cylinder-face ios-cylinder-front">
                        <span className={`text-lg font-bold whitespace-nowrap ${isDark ? 'text-white' : 'text-black'}`}>The docs</span>
                      </div>
                      <div className="ios-cylinder-face ios-cylinder-bottom">
                        <span className="text-lg font-bold text-[#FF6B4A] whitespace-nowrap">Read now</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>

              <Link
                href="/markets"
                className={`group rounded-2xl border py-6 px-5 card-shine hover:scale-[1.02] transition-all flex items-center justify-center relative overflow-hidden ${
                  isDark ? 'bg-[#1a1a1a] hover:bg-[#252525] border-transparent' : 'bg-white hover:bg-gray-100 border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <svg className={`w-5 h-5 flex-shrink-0 ${isDark ? 'text-white/60' : 'text-black/60'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  <div className="ios-cylinder" style={{ width: "130px" }}>
                    <div className="ios-cylinder-inner">
                      <div className="ios-cylinder-face ios-cylinder-front">
                        <span className="text-lg font-bold whitespace-nowrap">Trade markets</span>
                      </div>
                      <div className="ios-cylinder-face ios-cylinder-bottom">
                        <span className="text-lg font-bold text-[#FF6B4A] whitespace-nowrap">Explore</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className={`relative z-10 border-t py-4 md:py-5 px-4 md:px-10 lg:px-16 ${isDark ? 'border-white/5' : 'border-black/10'}`}>
        <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <a
            href="https://x.com/solana"
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-1.5 text-xs md:text-sm transition-colors ${isDark ? 'text-white/40 hover:text-white/60' : 'text-black/40 hover:text-black/60'}`}
          >
            <span>Backed by</span>
            <Image src="/solana-logo.png" alt="Solana" width={14} height={14} className="rounded-sm" />
            <span className={isDark ? 'text-white/60' : 'text-black/60'}>Solana</span>
          </a>

          <div className={`flex items-center gap-3 md:gap-4 text-xs md:text-sm ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            <a
              href="https://x.com/tradeonpolyx"
              target="_blank"
              rel="noopener noreferrer"
              className={`transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}
            >
              @tradeonpolyx
            </a>
            <a
              href="https://x.com/unretain"
              target="_blank"
              rel="noopener noreferrer"
              className={`transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}
            >
              @unretain
            </a>
          </div>
        </div>
      </footer>

      {/* Wallet Onboarding */}
      <WalletOnboarding
        isOpen={isWalletOnboardingOpen}
        onClose={() => setIsWalletOnboardingOpen(false)}
      />
    </div>
  );
}
