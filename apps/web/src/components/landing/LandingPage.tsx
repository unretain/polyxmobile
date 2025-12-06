"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Wallet, Mail, ChevronRight, ExternalLink, Minus, TrendingUp, MoveHorizontal, MoveVertical, Pencil, Trash2, MousePointer2, User, LogOut, Shield, Copy, Check, Key, ChevronDown, Sun, Moon } from "lucide-react";
import type { DrawingToolbarRenderProps } from "@/components/charts/Chart3D";
import { AuthModal } from "@/components/auth/AuthModal";
import { useSession, signOut } from "next-auth/react";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import { shortenAddress } from "@/lib/wallet";

// Extended session user type with our custom fields
interface SessionUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  walletAddress?: string;
  twoFactorEnabled?: boolean;
}

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
  const timeframes: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"];

  return (
    <div className={`flex items-center gap-1 p-1 rounded-lg ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
      {timeframes.map((tf) => (
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const { logout } = useAuthStore(); // Only used to clear legacy storage
  const { isDark, toggleTheme } = useThemeStore();
  const [tokenIndex, setTokenIndex] = useState(0);
  const [tokenPrice, setTokenPrice] = useState<number | null>(null);
  const [candles, setCandles] = useState<OHLCVCandle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [isChartHovered, setIsChartHovered] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [copied, setCopied] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [privateKeyCopied, setPrivateKeyCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentToken = FEATURED_TOKENS[tokenIndex];

  // Auth is now entirely from NextAuth session (stored in cookies)
  const currentUser = session?.user as SessionUser | undefined;
  const walletAddress = currentUser?.walletAddress;
  const twoFactorEnabled = currentUser?.twoFactorEnabled;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setShowDropdown(false);
    await signOut({ redirect: false });
    logout();
    router.push("/");
  };

  const handleOpenSecurity = () => {
    setShowDropdown(false);
    // Private key is now stored server-side - would need authenticated API call to retrieve
    // For security, we don't expose the private key directly in the client
    setPrivateKey(null);
    setShowSecurityModal(true);
  };

  const handleCopyPrivateKey = async () => {
    if (privateKey) {
      await navigator.clipboard.writeText(privateKey);
      setPrivateKeyCopied(true);
      setTimeout(() => setPrivateKeyCopied(false), 2000);
    }
  };

  // Check for auth query param to open modal
  useEffect(() => {
    if (searchParams.get("auth") === "true") {
      setIsAuthModalOpen(true);
      // Clean up the URL
      router.replace("/", { scroll: false });
    }
  }, [searchParams, router]);

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
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center relative">
          {/* Left - Logo */}
          <Link href="/" className={`flex items-center px-4 py-2 rounded-full border backdrop-blur-sm ${
            isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
          }`}>
            <span className={`font-medium text-sm ${isDark ? 'text-white' : 'text-black'}`}>[poly<span className="text-[#FF6B4A]">x</span>]</span>
          </Link>

          {/* Center - Navigation (absolutely positioned to stay centered) */}
          <nav className={`absolute left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-full border backdrop-blur-sm ${
            isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
          }`}>
            <Link
              href="/pulse"
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isDark ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-black/60 hover:text-black hover:bg-black/10'
              }`}
            >
              Pulse
            </Link>
            <Link
              href="/dashboard"
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isDark ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-black/60 hover:text-black hover:bg-black/10'
              }`}
            >
              Dashboard
            </Link>
            <Link
              href="/solutions"
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isDark ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-black/60 hover:text-black hover:bg-black/10'
              }`}
            >
              Solutions
            </Link>
            <Link
              href="/markets"
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isDark ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-black/60 hover:text-black hover:bg-black/10'
              }`}
            >
              Markets
            </Link>
          </nav>

          {/* Right - Actions (ml-auto pushes to right) */}
          <div className="flex items-center gap-2 ml-auto">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className={`p-2.5 rounded-full border backdrop-blur-md transition-colors ${
                isDark
                  ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white/60 hover:text-white'
                  : 'bg-black/5 border-black/10 hover:bg-black/10 text-black/60 hover:text-black'
              }`}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* Show wallet and user menu when logged in */}
            {currentUser ? (
              <>
                {/* Wallet Balance */}
                {walletAddress && (
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(walletAddress);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className={`flex items-center gap-2 rounded-full border backdrop-blur-md px-3 py-2 text-sm font-medium transition-colors ${
                      isDark
                        ? 'bg-white/5 border-white/10 hover:bg-white/10'
                        : 'bg-black/5 border-black/10 hover:bg-black/10'
                    }`}
                    title="Click to copy address"
                  >
                    <Image
                      src="/solana-logo.png"
                      alt="Solana"
                      width={20}
                      height={20}
                      className="rounded-full"
                    />
                    <span className={`font-medium ${isDark ? 'text-white' : 'text-black'}`}>0.00</span>
                    <span className={isDark ? 'text-white/40' : 'text-black/40'}>SOL</span>
                    <div className={`w-px h-4 ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
                    <span className={isDark ? 'text-white/60' : 'text-black/60'}>{shortenAddress(walletAddress)}</span>
                    {copied ? (
                      <Check className="h-3 w-3 text-green-400" />
                    ) : (
                      <Copy className={`h-3 w-3 ${isDark ? 'text-white/40' : 'text-black/40'}`} />
                    )}
                  </button>
                )}

                {/* User Account Dropdown */}
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setShowDropdown(!showDropdown)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-full border backdrop-blur-md transition-colors ${
                      isDark
                        ? 'bg-white/5 border-white/10 hover:bg-white/10'
                        : 'bg-black/5 border-black/10 hover:bg-black/10'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF8F6B] flex items-center justify-center">
                      <User className="h-4 w-4 text-white" />
                    </div>
                    {twoFactorEnabled && (
                      <Shield className="h-3 w-3 text-green-500" />
                    )}
                    <ChevronDown className={`h-4 w-4 transition-transform ${isDark ? 'text-white/40' : 'text-black/40'} ${showDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Dropdown Menu */}
                  {showDropdown && (
                    <div className={`absolute right-0 top-full mt-2 w-56 rounded-xl border backdrop-blur-md shadow-xl overflow-hidden ${
                      isDark ? 'bg-[#1a1a1a]/95 border-white/10' : 'bg-white/95 border-black/10'
                    }`}>
                      {/* User Info */}
                      <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                        <p className={`text-sm font-medium truncate ${isDark ? 'text-white' : 'text-black'}`}>{currentUser.name || currentUser.email}</p>
                        {walletAddress && (
                          <p className={`text-xs mt-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{shortenAddress(walletAddress)}</p>
                        )}
                      </div>

                      {/* Menu Items */}
                      <div className="py-1">
                        <button
                          onClick={handleOpenSecurity}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                            isDark ? 'text-white/70 hover:text-white hover:bg-white/5' : 'text-black/70 hover:text-black hover:bg-black/5'
                          }`}
                        >
                          <Key className="h-4 w-4" />
                          Security
                        </button>
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                        >
                          <LogOut className="h-4 w-4" />
                          Sign Out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Login/Signup buttons when not logged in */}
                <button
                  onClick={() => {
                    setAuthMode("signin");
                    setIsAuthModalOpen(true);
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-all ${
                    isDark
                      ? 'bg-white/5 border-white/10 text-white hover:bg-white/10'
                      : 'bg-black/5 border-black/10 text-black hover:bg-black/10'
                  }`}
                >
                  <Mail className="w-4 h-4" />
                  <span>Log In</span>
                </button>
                <button
                  onClick={() => {
                    setAuthMode("signup");
                    setIsAuthModalOpen(true);
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all bg-[#FF6B4A] text-white hover:bg-[#FF5A36]"
                >
                  <Wallet className="w-4 h-4" />
                  <span>Sign Up</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 pt-24 pb-16 px-6">
        <div className="max-w-7xl mx-auto">
          {/* Large Title */}
          <div className="text-center mb-12">
            <h1 className="text-6xl md:text-8xl lg:text-9xl font-bold font-inter tracking-normal">
              <span className={isDark ? 'text-white' : 'text-black'}>[poly</span>
              <span className="text-[#FF6B4A]">x</span>
              <span className={isDark ? 'text-white' : 'text-black'}>]</span>
            </h1>
            <p className={`mt-4 text-lg ${isDark ? 'text-white/50' : 'text-black/50'}`}>
              3D Trading Charts for Solana
            </p>
          </div>

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Left Column - Cards */}
            <div className="space-y-4">
              {/* Token Preview Card */}
              <div className={`rounded-2xl border p-4 card-shine ${
                isDark ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-black/10'
              }`}>
                <div className="flex items-center gap-4">
                  <TokenLogo token={currentToken} size={48} />
                  <div className="flex-1">
                    <div className={`text-xs font-mono ${isDark ? 'text-white/40' : 'text-black/40'}`}>${currentToken.symbol}</div>
                    <div className="text-lg font-bold">${tokenPrice?.toFixed(2) || "..."}</div>
                  </div>
                  <Sparkline data={priceHistory.slice(-30)} positive={isPositive} width={100} height={35} />
                </div>
              </div>

              {/* Event Card */}
              <div className={`rounded-2xl border p-4 card-shine ${
                isDark ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-black/10'
              }`}>
                <div className="flex items-center gap-4">
                  <div className={`text-center px-3 py-2 rounded-xl ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                    <div className="text-2xl font-bold">3D</div>
                    <div className={`text-xs uppercase ${isDark ? 'text-white/40' : 'text-black/40'}`}>Charts</div>
                  </div>
                  <div className="flex-1">
                    <div className={`text-xs uppercase tracking-wider ${isDark ? 'text-white/40' : 'text-black/40'}`}>[POLYX]</div>
                    <div className="font-medium">Immersive Trading</div>
                  </div>
                  <div className={`w-8 h-8 rounded-full border flex items-center justify-center ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v8M8 12h8" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Info Section */}
              <div className={`rounded-2xl border p-6 card-shine ${
                isDark ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-black/10'
              }`}>
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                  Solana Memecoins
                  <span className={`w-16 h-px ${isDark ? 'bg-white/20' : 'bg-black/20'}`} />
                </h3>

                <div className="mb-4">
                  <div className={`text-xs uppercase tracking-wider mb-2 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                    Created with real time OHLCV data
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-1 rounded text-xs font-mono ${isDark ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'}`}>Open</span>
                    <span className={`px-2 py-1 rounded text-xs font-mono ${isDark ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'}`}>High</span>
                    <span className={`px-2 py-1 rounded text-xs font-mono ${isDark ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'}`}>Low</span>
                    <span className={`px-2 py-1 rounded text-xs font-mono ${isDark ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'}`}>Close</span>
                    <span className={`px-2 py-1 rounded text-xs font-mono ${isDark ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'}`}>Volume</span>
                  </div>
                </div>

                <div className="mb-4">
                  <div className={`text-xs uppercase tracking-wider mb-2 ${isDark ? 'text-white/40' : 'text-black/40'}`}>Team</div>
                  <div className="space-y-3">
                    {/* Polyx Twitter */}
                    <a
                      href="https://x.com/polyx"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center gap-3 p-2 rounded-xl transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}
                    >
                      <div className="w-10 h-10 rounded-xl bg-[#FF6B4A] flex items-center justify-center">
                        <span className="text-white font-bold text-sm">[x]</span>
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
                      className={`flex items-center gap-3 p-2 rounded-xl transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
                        <span className="text-lg">👨‍💻</span>
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

                <Link
                  href="/dashboard"
                  className={`flex items-center justify-between w-full px-4 py-3 rounded-xl border transition-colors ${
                    isDark
                      ? 'bg-white/5 border-white/10 hover:bg-white/10'
                      : 'bg-black/5 border-black/10 hover:bg-black/10'
                  }`}
                >
                  <span className="font-medium">Launch App</span>
                  <span className={`text-sm ${isDark ? 'text-white/40' : 'text-black/40'}`}>Enter</span>
                </Link>
              </div>
            </div>

            {/* Right Column - Featured Chart */}
            <div
              className="relative rounded-2xl overflow-hidden group"
              onMouseEnter={() => setIsChartHovered(true)}
              onMouseLeave={() => setIsChartHovered(false)}
            >
              {/* Chart container - base layer */}
              <div className="relative flex flex-col h-[600px]">
                {/* Top bar with token info and timeframe */}
                <div className="relative z-20 flex items-center justify-between p-4">
                  <div className="flex items-center gap-4">
                    <TokenLogo token={currentToken} size={48} />
                    <div className="flex items-center gap-3">
                      <Sparkline data={priceHistory.slice(-20)} positive={isPositive} width={80} height={30} />
                      <div className={`text-sm ${isDark ? 'text-white/40' : 'text-black/40'}`}>———</div>
                      <span className={`font-mono text-sm ${isDark ? 'text-white/60' : 'text-black/60'}`}>${currentToken.symbol}</span>
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
                <div className="relative z-20 flex items-center justify-between p-4 border-t border-white/5">
                  <div className="flex items-center gap-6">
                    <div className="text-3xl font-bold lowercase">{currentToken.symbol}</div>
                    <div className="flex items-center gap-6 text-sm">
                      <div>
                        <div className={`text-xs uppercase ${isDark ? 'text-white/40' : 'text-black/40'}`}>Price</div>
                        <div className="font-mono">${tokenPrice?.toFixed(4) || "..."}</div>
                      </div>
                      <div>
                        <div className={`text-xs uppercase ${isDark ? 'text-white/40' : 'text-black/40'}`}>24h Change</div>
                        <div className={`font-mono ${isPositive ? "text-green-500" : "text-red-500"}`}>
                          {isPositive ? "+" : ""}{priceHistory.length > 1 ? ((priceHistory[priceHistory.length - 1] - priceHistory[0]) / priceHistory[0] * 100).toFixed(2) : 0}%
                        </div>
                      </div>
                      <div>
                        <div className={`text-xs uppercase ${isDark ? 'text-white/40' : 'text-black/40'}`}>Token</div>
                        <div className="font-mono">{currentToken.name}</div>
                      </div>
                    </div>
                  </div>

                  {/* Navigation arrows */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={goToPrevToken}
                      className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors ${
                        isDark ? 'border-white/10 hover:bg-white/5 hover:border-[#FF6B4A]/30' : 'border-black/10 hover:bg-black/5'
                      }`}
                    >
                      <ChevronRight className="w-5 h-5 rotate-180" />
                    </button>
                    <button
                      onClick={goToNextToken}
                      className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors ${
                        isDark ? 'border-white/10 hover:bg-white/5 hover:border-[#FF6B4A]/30' : 'border-black/10 hover:bg-black/5'
                      }`}
                    >
                      <ChevronRight className="w-5 h-5" />
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

              {/* Vertical token ticker overlay - like $STAR reference */}
              <div
                className={`absolute left-0 top-0 bottom-0 flex items-center pointer-events-none select-none z-10 transition-transform duration-500 ease-out ${isChartHovered ? 'translate-x-4' : 'translate-x-0'}`}
              >
                <span
                  className={`text-[120px] md:text-[150px] font-black tracking-tight leading-none uppercase ${isDark ? 'text-white/[0.08]' : 'text-black/[0.08]'}`}
                  style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)' }}
                >
                  ${currentToken.symbol}
                </span>
              </div>
            </div>
          </div>

          {/* Bottom Row - CTA Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* View Pulse Card with iOS cylinder rotation */}
            <Link
              href="/pulse"
              className={`group rounded-2xl border p-4 card-shine hover:scale-[1.02] transition-all flex items-center gap-3 ${
                isDark ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-black/10'
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                    <span className="font-medium">View Pulse Feed</span>
                  </div>
                  <div className="ios-cylinder-face ios-cylinder-bottom">
                    <span className="font-medium text-[#FF6B4A]">Trade now</span>
                  </div>
                </div>
              </div>
            </Link>

            {/* Ready to trade Card - Coral accent */}
            <Link
              href="/dashboard"
              className="group rounded-2xl bg-[#FF6B4A] p-4 hover:scale-[1.02] transition-all relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              <div className="relative flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold text-white">Ready to trade?</div>
                  <div className="text-white/70 text-sm">Launch the app</div>
                </div>
                <ChevronRight className="w-6 h-6 text-white group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>

            {/* Docs Card with iOS cylinder rotation */}
            <Link
              href="/docs"
              className={`group rounded-2xl border p-4 card-shine hover:scale-[1.02] transition-all flex items-center justify-between relative overflow-hidden ${
                isDark ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-black/10'
              }`}
            >
              <div className="absolute top-0 left-0 right-0 h-px animated-line" />
              <div className="flex items-center gap-2">
                <svg className={`w-4 h-4 ${isDark ? 'text-white/60' : 'text-black/60'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                {/* iOS Cylinder rotation text */}
                <div className="ios-cylinder">
                  <div className="ios-cylinder-inner">
                    <div className="ios-cylinder-face ios-cylinder-front">
                      <span className="font-medium">The docs</span>
                    </div>
                    <div className="ios-cylinder-face ios-cylinder-bottom">
                      <span className="font-medium text-[#FF6B4A]">Read now</span>
                    </div>
                  </div>
                </div>
              </div>
              <ChevronRight className={`w-4 h-4 transition-colors ${isDark ? 'text-white/40 group-hover:text-[#FF6B4A]' : 'text-black/40 group-hover:text-[#FF6B4A]'}`} />
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className={`relative z-10 border-t py-4 px-6 ${isDark ? 'border-white/5' : 'border-black/10'}`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className={`flex items-center gap-4 text-sm ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            <span className="flex items-center gap-1">
              <span className={isDark ? 'text-white/20' : 'text-black/20'}>≡</span>
              <span>{currentToken.symbol}:</span>
              <span className={isDark ? 'text-white/60' : 'text-black/60'}>${tokenPrice?.toFixed(2) || "..."}</span>
            </span>
            <a href="#" className={`transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}>Support</a>
            <a href="#" className={`transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}>Founders</a>
          </div>

          <div className={`flex items-center gap-4 text-sm ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            <a href="#" className={`transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}>Privacy Policy</a>
            <a href="#" className={`transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}>Terms of Service</a>
            <a href="https://x.com/polyx" target="_blank" rel="noopener noreferrer" className={`transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}>
              𝕏
            </a>
            <a href="https://t.me" target="_blank" rel="noopener noreferrer" className={`transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </a>
          </div>
        </div>
      </footer>

      {/* Security Modal */}
      {showSecurityModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowSecurityModal(false)} />
          <div className={`relative w-full max-w-md border rounded-2xl shadow-2xl ${isDark ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-black/10'}`}>
            <div className={`p-6 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
              <h2 className={`text-xl font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-black'}`}>
                <Shield className="h-5 w-5 text-[#FF6B4A]" />
                Security
              </h2>
            </div>

            <div className="p-6 space-y-4">
              {/* 2FA Status */}
              <div className={`flex items-center justify-between p-4 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                <div className="flex items-center gap-3">
                  <Shield className={`h-5 w-5 ${twoFactorEnabled ? 'text-green-500' : isDark ? 'text-white/40' : 'text-black/40'}`} />
                  <div>
                    <p className={`text-sm font-medium ${isDark ? 'text-white' : 'text-black'}`}>Two-Factor Authentication</p>
                    <p className={`text-xs ${isDark ? 'text-white/40' : 'text-black/40'}`}>{twoFactorEnabled ? 'Enabled' : 'Not enabled'}</p>
                  </div>
                </div>
                <div className={`px-2 py-1 rounded-full text-xs font-medium ${twoFactorEnabled ? 'bg-green-500/20 text-green-400' : isDark ? 'bg-white/10 text-white/40' : 'bg-black/10 text-black/40'}`}>
                  {twoFactorEnabled ? 'Active' : 'Off'}
                </div>
              </div>

              {/* Wallet Info */}
              {walletAddress && (
                <div className={`p-4 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <Image
                      src="/solana-logo.png"
                      alt="Solana"
                      width={20}
                      height={20}
                      className="rounded-full"
                    />
                    <p className={`text-sm font-medium ${isDark ? 'text-white' : 'text-black'}`}>Wallet Address</p>
                  </div>
                  <p className={`font-mono text-xs break-all select-all rounded-lg p-3 ${isDark ? 'text-white/60 bg-black/30' : 'text-black/60 bg-black/5'}`}>
                    {walletAddress}
                  </p>
                </div>
              )}

              {/* Private Key Section */}
              {currentUser && (
                <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                  <div className="flex items-center gap-3 mb-3">
                    <Key className="h-5 w-5 text-red-400" />
                    <p className="text-sm font-medium text-red-400">Private Key</p>
                  </div>
                  <p className={`text-xs mb-3 ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                    Warning: Never share your private key with anyone. Anyone with your private key can access your funds.
                  </p>
                  {privateKey ? (
                    <div className="space-y-2">
                      <p className={`font-mono text-xs break-all select-all rounded-lg p-3 ${isDark ? 'text-white/60 bg-black/30' : 'text-black/60 bg-black/5'}`}>
                        {privateKey}
                      </p>
                      <button
                        onClick={handleCopyPrivateKey}
                        className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        {privateKeyCopied ? (
                          <>
                            <Check className="h-3 w-3" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            Copy Private Key
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <p className={`text-xs italic ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                      Private key not available (Phantom wallet or external wallet)
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className={`p-6 border-t ${isDark ? 'border-white/10' : 'border-black/10'}`}>
              <button
                onClick={() => setShowSecurityModal(false)}
                className={`w-full font-medium py-2.5 rounded-lg transition-colors ${
                  isDark
                    ? 'bg-white/5 hover:bg-white/10 border border-white/10 text-white'
                    : 'bg-black/5 hover:bg-black/10 border border-black/10 text-black'
                }`}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        mode={authMode}
      />
    </div>
  );
}
