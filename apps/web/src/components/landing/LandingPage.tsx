"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Image from "next/image";
import { ChevronRight, ExternalLink, Minus, TrendingUp, MoveHorizontal, MoveVertical, Pencil, Trash2, MousePointer2 } from "lucide-react";
import type { DrawingToolbarRenderProps } from "@/components/charts/Chart3D";
import { Header } from "@/components/layout/Header";
import { useThemeStore } from "@/stores/themeStore";
import { useSession } from "next-auth/react";
import { AuthModal } from "@/components/auth/AuthModal";

// Dynamic import for Chart3D
const Chart3D = dynamic(
  () => import("@/components/charts/Chart3D").then((mod) => mod.Chart3D),
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
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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

// Landing page drawing toolbar component
function LandingToolbar({
  activeTool,
  activeColor,
  onToolChange,
  onColorChange,
  onClearAll,
  drawingCount,
  isDark
}: DrawingToolbarRenderProps & { isDark: boolean }) {
  const colorInputRef = useRef<HTMLInputElement>(null);

  const tools: { type: "segment" | "ray" | "hline" | "vline" | "freehand" | "select"; icon: React.ReactNode; label: string }[] = [
    { type: "select", icon: <MousePointer2 className="w-4 h-4" />, label: "Select" },
    { type: "segment", icon: <Minus className="w-4 h-4" />, label: "Line" },
    { type: "ray", icon: <TrendingUp className="w-4 h-4" />, label: "Ray" },
    { type: "hline", icon: <MoveHorizontal className="w-4 h-4" />, label: "H-Line" },
    { type: "vline", icon: <MoveVertical className="w-4 h-4" />, label: "V-Line" },
    { type: "freehand", icon: <Pencil className="w-4 h-4" />, label: "Draw" },
  ];

  return (
    <div className="flex flex-col items-center py-2 px-1.5 h-full">
      <div className={`flex flex-col items-center py-2 px-1.5 gap-1 rounded-xl ${isDark ? 'bg-black/40' : 'bg-white/40'} backdrop-blur-sm`}>
        {tools.map((tool) => (
          <button
            key={tool.type}
            title={tool.label}
            onClick={() => onToolChange(tool.type === "select" ? null : tool.type)}
            className={`p-2 rounded-lg transition-all ${
              (tool.type === "select" && !activeTool) || activeTool === tool.type
                ? "bg-[#FF6B4A] text-white"
                : isDark
                  ? "text-white/50 hover:text-white hover:bg-white/10"
                  : "text-black/50 hover:text-black hover:bg-black/10"
            }`}
          >
            {tool.icon}
          </button>
        ))}

        <div className={`w-6 h-px my-1 ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />

        {/* Color picker */}
        <button
          title="Color"
          onClick={() => colorInputRef.current?.click()}
          className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
        >
          <div
            className={`w-4 h-4 rounded-full border ${isDark ? 'border-white/20' : 'border-black/20'}`}
            style={{ backgroundColor: activeColor }}
          />
        </button>
        <input
          ref={colorInputRef}
          type="color"
          value={activeColor}
          onChange={(e) => onColorChange(e.target.value)}
          className="absolute opacity-0 w-0 h-0 pointer-events-none"
        />

        {/* Clear all */}
        {drawingCount > 0 && (
          <>
            <div className={`w-6 h-px my-1 ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
            <button
              onClick={onClearAll}
              title={`Clear (${drawingCount})`}
              className="p-2 rounded-lg text-red-400/50 hover:text-red-400 hover:bg-red-400/10 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
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
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";
  const [tokenIndex, setTokenIndex] = useState(0);
  const [tokenPrice, setTokenPrice] = useState<number | null>(null);
  const [candles, setCandles] = useState<OHLCVCandle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<Timeframe>("4h");
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const currentToken = FEATURED_TOKENS[tokenIndex];

  // Handle Launch App click
  const handleLaunchApp = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isAuthenticated) {
      router.push("/pulse");
    } else {
      setIsAuthModalOpen(true);
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

    fetch(`${API_URL}/api/tokens/${currentToken.address}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.price) setTokenPrice(data.price);
      })
      .catch(() => setTokenPrice(currentToken.symbol === "SOL" ? 235 : 3018));

    fetch(`${API_URL}/api/tokens/${currentToken.address}/ohlcv?timeframe=${timeframe}&limit=100`)
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
      fetch(`${API_URL}/api/tokens/${currentToken.address}/ohlcv?timeframe=${timeframe}&limit=100`)
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
      <Header />

      {/* Main Content */}
      <main className="relative z-10 pt-20 md:pt-28 pb-12 md:pb-20 px-4 md:px-10 lg:px-16">
        <div className="max-w-[1600px] mx-auto">
          {/* Large Title */}
          <div className="text-center mb-8 md:mb-16">
            <h1 className="text-4xl sm:text-6xl md:text-8xl lg:text-9xl font-bold font-inter tracking-normal">
              <span className={isDark ? 'text-white' : 'text-black'}>[poly</span>
              <span className="text-[#FF6B4A]">x</span>
              <span className={isDark ? 'text-white' : 'text-black'}>]</span>
            </h1>
            <p className={`mt-4 md:mt-6 text-sm md:text-lg ${isDark ? 'text-white/50' : 'text-black/50'}`}>
              3D Trading Charts for Solana
            </p>
          </div>

          {/* Two Column Layout - Chart (right) 75%, left panel 25% */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] gap-6">
            {/* Left Column - Cards */}
            <div className="space-y-5">
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

              {/* Info Section */}
              <div className={`rounded-2xl border p-7 card-shine ${
                isDark ? 'bg-[#1a1a1a] border-transparent' : 'bg-white border-transparent'
              }`}>
                <h3 className="text-xl font-bold mb-5 flex items-center gap-2">
                  Solana Memecoins
                  <span className={`w-16 h-px ${isDark ? 'bg-white/20' : 'bg-black/20'}`} />
                </h3>

                <div className="mb-5">
                  <div className={`text-xs uppercase tracking-wider mb-3 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                    Created with real time OHLCV data
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-3 py-1.5 rounded text-xs font-mono ${isDark ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'}`}>Open</span>
                    <span className={`px-3 py-1.5 rounded text-xs font-mono ${isDark ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'}`}>High</span>
                    <span className={`px-3 py-1.5 rounded text-xs font-mono ${isDark ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'}`}>Low</span>
                    <span className={`px-3 py-1.5 rounded text-xs font-mono ${isDark ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'}`}>Close</span>
                    <span className={`px-3 py-1.5 rounded text-xs font-mono ${isDark ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'}`}>Volume</span>
                  </div>
                </div>

                <div className="mb-5">
                  <div className={`text-xs uppercase tracking-wider mb-3 ${isDark ? 'text-white/40' : 'text-black/40'}`}>Team</div>
                  <div className="space-y-3">
                    {/* Polyx Twitter */}
                    <a
                      href="https://x.com/tradeonpolyx"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}
                    >
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
                        <span className={`font-bold text-[10px] ${isDark ? 'text-white' : 'text-black'}`}>[poly<span className="text-[#FF6B4A]">x</span>]</span>
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">[polyx]</div>
                        <div className={`flex items-center gap-1 text-xs ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                          <XIcon className="w-3 h-3" />
                          <span>@polyx</span>
                        </div>
                      </div>
                      <ExternalLink className={`w-4 h-4 ${isDark ? 'text-white/20' : 'text-black/20'}`} />
                    </a>

                    {/* Unretains Twitter */}
                    <a
                      href="https://x.com/unretains"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}
                    >
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
                        <span className={`font-bold text-sm ${isDark ? 'text-white' : 'text-black'}`}>&lt;<span className="text-[#FF6B4A]">/</span>&gt;</span>
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">Developer</div>
                        <div className={`flex items-center gap-1 text-xs ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                          <XIcon className="w-3 h-3" />
                          <span>@unretains</span>
                        </div>
                      </div>
                      <ExternalLink className={`w-4 h-4 ${isDark ? 'text-white/20' : 'text-black/20'}`} />
                    </a>
                  </div>
                </div>

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

            {/* Right Column - Featured Chart */}
            <div
              className="relative rounded-2xl overflow-hidden group"
            >
              {/* Chart container - base layer */}
              <div className="relative flex flex-col h-[400px] md:h-[640px]">
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

                {/* Chart Area with Toolbar */}
                <div className="flex-1 relative flex">
                  {/* 3D Chart with custom toolbar */}
                  <div className="absolute inset-0">
                    {candles.length > 0 ? (
                      <Chart3D
                        data={candles}
                        isLoading={isLoading}
                        price={tokenPrice || undefined}
                        renderToolbar={(props: DrawingToolbarRenderProps) => (
                          <LandingToolbar {...props} isDark={isDark} />
                        )}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
                      </div>
                    )}
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

          {/* Bottom Row - CTA Cards - matching reference layout */}
          {/* Grid matches the two-column layout above: left card under left panel, 3 cards under chart */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] gap-4 md:gap-6 mt-4 md:mt-6">
            {/* Left: View Pulse Card - aligned under left panel */}
            <Link
              href="/pulse"
              className={`group rounded-2xl border py-4 md:py-6 px-4 md:px-5 card-shine hover:scale-[1.02] transition-all flex items-center gap-3 md:gap-4 ${
                isDark ? 'bg-[#1a1a1a] hover:bg-[#252525] border-transparent' : 'bg-white hover:bg-gray-100 border-transparent'
              }`}
            >
              <div className={`w-8 h-8 md:w-10 md:h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                <svg className="w-4 h-4 md:w-5 md:h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              {/* iOS Cylinder rotation text */}
              <div className="ios-cylinder" style={{ width: "120px" }}>
                <div className="ios-cylinder-inner">
                  <div className="ios-cylinder-face ios-cylinder-front">
                    <span className="text-base md:text-lg font-bold whitespace-nowrap">View Pulse</span>
                  </div>
                  <div className="ios-cylinder-face ios-cylinder-bottom">
                    <span className="text-base md:text-lg font-bold text-[#FF6B4A] whitespace-nowrap">Trade now</span>
                  </div>
                </div>
              </div>
            </Link>

            {/* Right: cards under chart - 3 equal columns on desktop */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
              {/* Ready to trade Card - Coral accent with line draw animation */}
              <button
                onClick={handleLaunchApp}
                className="group col-span-2 md:col-span-1 rounded-2xl bg-[#FF6B4A] py-4 md:py-6 px-4 md:px-5 hover:scale-[1.02] transition-all relative overflow-hidden text-left"
              >
                <div className="relative flex flex-col justify-between h-full">
                  <div className="text-base md:text-lg font-bold text-white">Ready to trade?</div>
                  {/* Text with line to the RIGHT that draws leftward, pushing text left */}
                  <div className="flex items-center justify-end mt-2 md:mt-3">
                    {/* "Launch the app" text - same style as Ready to trade but black */}
                    <span className="text-base md:text-lg font-bold text-black whitespace-nowrap transition-transform duration-500 ease-out group-hover:-translate-x-4 md:group-hover:-translate-x-6">
                      Launch the app
                    </span>
                    {/* Line appears to the RIGHT of text, grows leftward */}
                    <div className="h-[2px] w-0 group-hover:w-12 md:group-hover:w-20 bg-black transition-all duration-500 ease-out ml-2" />
                  </div>
                </div>
              </button>

              {/* Docs Card with iOS cylinder rotation */}
              <Link
                href="/docs"
                className={`group rounded-2xl border py-4 md:py-6 px-3 md:px-5 card-shine hover:scale-[1.02] transition-all flex items-center justify-between relative overflow-hidden ${
                  isDark ? 'bg-[#1a1a1a] hover:bg-[#252525] border-transparent' : 'bg-white hover:bg-gray-100 border-transparent'
                }`}
              >
                <div className="absolute top-0 left-0 right-0 h-px animated-line" />
                <div className="flex items-center gap-2 md:gap-3">
                  <svg className={`w-4 h-4 md:w-5 md:h-5 flex-shrink-0 ${isDark ? 'text-white/60' : 'text-black/60'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  {/* Simple text on mobile, iOS Cylinder on desktop */}
                  <span className={`text-base md:text-lg font-bold md:hidden ${isDark ? 'text-white' : 'text-black'}`}>Docs</span>
                  <div className="ios-cylinder hidden md:block" style={{ width: "90px" }}>
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

              {/* Trade Markets Card with iOS cylinder rotation - no arrow */}
              <Link
                href="/markets"
                className={`group rounded-2xl border py-4 md:py-6 px-3 md:px-5 card-shine hover:scale-[1.02] transition-all flex items-center relative overflow-hidden ${
                  isDark ? 'bg-[#1a1a1a] hover:bg-[#252525] border-transparent' : 'bg-white hover:bg-gray-100 border-transparent'
                }`}
              >
                <div className="flex items-center gap-2 md:gap-3">
                  <svg className={`w-4 h-4 md:w-5 md:h-5 flex-shrink-0 ${isDark ? 'text-white/60' : 'text-black/60'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  {/* Simple text on mobile, iOS Cylinder on desktop */}
                  <span className={`text-base md:text-lg font-bold md:hidden ${isDark ? 'text-white' : 'text-black'}`}>Markets</span>
                  <div className="ios-cylinder hidden md:block" style={{ width: "130px" }}>
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
          <div className={`flex items-center gap-3 md:gap-4 text-xs md:text-sm ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            <span className="flex items-center gap-1">
              <span>{currentToken.symbol}:</span>
              <span className={isDark ? 'text-white/60' : 'text-black/60'}>${tokenPrice?.toFixed(2) || "..."}</span>
            </span>
            <a href="mailto:omniscient@extraficial.dev" className={`transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}>Support</a>
            <a href="https://x.com/unretains" target="_blank" rel="noopener noreferrer" className={`hidden sm:inline transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}>Founders</a>
          </div>

          <div className={`flex items-center gap-3 md:gap-4 text-xs md:text-sm ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            <Link href="/privacy" className={`transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}>Privacy</Link>
            <Link href="/tos" className={`transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}>Terms</Link>
          </div>
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        mode="signin"
      />
    </div>
  );
}
