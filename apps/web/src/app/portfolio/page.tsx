"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { useThemeStore } from "@/stores/themeStore";
import { useToast } from "@/components/ui/Toast";
import {
  Loader2,
  History,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Calendar,
  TrendingUp,
  Share2,
  X,
  Upload,
  Download,
  Copy,
  Video,
  Image as ImageIcon,
} from "lucide-react";


interface DailyPnL {
  date: string;
  pnl: number;
  trades: number;
  volume: number;
}

interface Position {
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  totalBought: number;
  totalSold: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  totalBuyCost: number;
  totalSellRevenue: number;
  currentBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  trades: number;
  lastTradeAt: string | null;
  isOpen: boolean;
}

interface PnLSummary {
  totalRealizedPnl: number;
  totalVolume: number;
  totalTrades: number;
  currentStreak: number;
  bestStreak: number;
  winRate: number;
}

interface PnLResponse {
  period: string;
  startDate: string;
  endDate: string;
  cumulativePnLBaseline: number; // PnL from trades before the display period
  summary: PnLSummary;
  dailyPnL: DailyPnL[];
  calendarData?: Record<string, DailyPnL>;
  positions: Position[];
  activePositions: Position[];
  closedPositions: Position[];
}

interface BalanceResponse {
  walletAddress: string;
  sol: {
    mint: string;
    balance: string;
    uiBalance: number;
    decimals: number;
    priceUsd: number | null;
    valueUsd: number | null;
  };
  tokens: Array<{
    mint: string;
    balance: string;
    uiBalance: number;
    decimals: number;
    priceUsd: number | null;
    valueUsd: number | null;
  }>;
  totalValueUsd: number | null;
}

type ViewMode = "chart" | "calendar";
type Period = "1d" | "7d" | "30d" | "all";
type PositionFilter = "active" | "closed" | "all";
type CurrencyMode = "usd" | "sol";

export default function PortfolioPage() {
  const { isDark } = useThemeStore();
  const { status } = useSession();
  const router = useRouter();
  const { showToast } = useToast();

  const [pnlData, setPnlData] = useState<PnLResponse | null>(null);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [balanceLoading, setBalanceLoading] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>("chart");
  const [period, setPeriod] = useState<Period>("30d");
  const [positionFilter, setPositionFilter] = useState<PositionFilter>("all");
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>("usd");

  // Calendar state
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth() + 1);
  const [calendarData, setCalendarData] = useState<Record<string, DailyPnL>>({});

  // Share card state
  const [showShareModal, setShowShareModal] = useState(false);
  const [customBgImage, setCustomBgImage] = useState<string | null>(null);
  const [customBgVideo, setCustomBgVideo] = useState<string | null>(null);
  const [bgType, setBgType] = useState<"default" | "image" | "video">("default");
  const [isGeneratingCard, setIsGeneratingCard] = useState(false);
  const shareCardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Selected day for share card (null = show period summary)
  const [selectedDayForShare, setSelectedDayForShare] = useState<DailyPnL | null>(null);

  // Chart crosshair state
  const [chartHover, setChartHover] = useState<{ x: number; y: number } | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/");
    }
  }, [status, router]);

  // Fetch PnL data
  const fetchPnL = async () => {
    try {
      setLoading(true);
      const periodParam = viewMode === "calendar" ? "calendar" : period;
      const url = viewMode === "calendar"
        ? `/api/trading/pnl?period=calendar&year=${calendarYear}&month=${calendarMonth}`
        : `/api/trading/pnl?period=${periodParam}`;

      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const data: PnLResponse = await res.json();
        setPnlData(data);
        if (data.calendarData) {
          setCalendarData(data.calendarData);
        }
      }
    } catch (err) {
      console.error("Failed to fetch PnL:", err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch balance (isRefresh = true means don't show loading spinner)
  const fetchBalance = async (isRefresh = false) => {
    try {
      // Only show loading on initial fetch, not on auto-refresh
      if (!isRefresh) {
        setBalanceLoading(true);
      }
      const res = await fetch("/api/trading/balance");
      if (res.ok) {
        const data = await res.json();
        setBalance(data);
      }
    } catch (err) {
      console.error("Failed to fetch balance:", err);
    } finally {
      if (!isRefresh) {
        setBalanceLoading(false);
      }
    }
  };

  useEffect(() => {
    if (status === "authenticated") {
      fetchPnL();
      fetchBalance(false); // Initial fetch with loading state
      // Auto-refresh balance every 30 seconds (user can click refresh for instant update)
      const interval = setInterval(() => fetchBalance(true), 30000);
      return () => clearInterval(interval);
    }
  }, [status, period, viewMode, calendarYear, calendarMonth]);

  // Only include days with actual trades (no empty days)
  const chartData = useMemo(() => {
    if (!pnlData) return [];

    // Filter to only days with trades, sorted by date
    return pnlData.dailyPnL
      .filter(d => d.trades > 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [pnlData]);

  // Calculate chart max value for scaling (using filled chart data)
  const chartMax = useMemo(() => {
    if (!chartData.length) return 1;
    const max = Math.max(...chartData.map(d => Math.abs(d.pnl)));
    return max || 0.0001; // Small default for when all values are 0
  }, [chartData]);

  // Total portfolio value from balance API (includes SOL + all tokens)
  const totalPortfolioValueUsd = balance?.totalValueUsd ?? null;

  // Filter positions and merge with actual wallet balances
  const filteredPositions = useMemo(() => {
    if (!pnlData) return [];

    // Create a map of actual wallet balances by mint
    const walletBalances = new Map<string, number>();
    if (balance?.tokens) {
      for (const token of balance.tokens) {
        walletBalances.set(token.mint, token.uiBalance);
      }
    }

    // Get positions based on filter
    let positions: Position[];
    switch (positionFilter) {
      case "active":
        positions = pnlData.activePositions;
        break;
      case "closed":
        positions = pnlData.closedPositions;
        break;
      default:
        positions = pnlData.positions;
    }

    // Override currentBalance with actual wallet balance if available
    return positions.map(pos => {
      const actualBalance = walletBalances.get(pos.mint);
      if (actualBalance !== undefined) {
        return { ...pos, currentBalance: actualBalance };
      }
      return pos;
    });
  }, [pnlData, positionFilter, balance]);

  // Format helpers
  const formatSOL = (value: number) => {
    if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)}K`;
    if (Math.abs(value) >= 1) return value.toFixed(4);
    return value.toFixed(6);
  };

  const formatPnL = (value: number, showSign = true) => {
    const prefix = showSign ? (value >= 0 ? "+" : "") : "";
    if (Math.abs(value) >= 1000) return `${prefix}${(value / 1000).toFixed(2)}K SOL`;
    if (Math.abs(value) >= 1) return `${prefix}${value.toFixed(4)} SOL`;
    return `${prefix}${value.toFixed(6)} SOL`;
  };

  // Calendar helpers
  const getDaysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month - 1, 1).getDay();
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const navigateMonth = (delta: number) => {
    let newMonth = calendarMonth + delta;
    let newYear = calendarYear;
    if (newMonth > 12) {
      newMonth = 1;
      newYear++;
    } else if (newMonth < 1) {
      newMonth = 12;
      newYear--;
    }
    setCalendarMonth(newMonth);
    setCalendarYear(newYear);
  };

  // Get color for PnL
  const getPnLColor = (pnl: number, isDark: boolean) => {
    if (pnl > 0) return isDark ? "text-green-400" : "text-green-600";
    if (pnl < 0) return isDark ? "text-red-400" : "text-red-600";
    return isDark ? "text-white/40" : "text-gray-500";
  };

  const getPnLBgColor = (pnl: number, intensity: number = 1) => {
    if (pnl > 0) return `rgba(34, 197, 94, ${0.1 + intensity * 0.3})`;
    if (pnl < 0) return `rgba(239, 68, 68, ${0.1 + intensity * 0.3})`;
    return "transparent";
  };

  if (status === "loading") {
    return (
      <div className={`min-h-screen ${isDark ? 'bg-[#0a0a0a]' : 'bg-[#f5f5f5]'}`}>
        <Header />
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-[#FF6B4A]" />
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${isDark ? 'bg-[#0a0a0a] text-white' : 'bg-[#f5f5f5] text-black'}`}>
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pt-24">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Portfolio</h1>
            <p className={`text-sm ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
              Track your positions and PnL
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { fetchPnL(); fetchBalance(); }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                isDark
                  ? 'bg-white/5 hover:bg-white/10 border border-white/10 text-white'
                  : 'bg-white hover:bg-gray-100 border border-gray-200 text-gray-900'
              }`}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Total Portfolio Value Banner */}
        <div className={`mb-6 p-6 rounded-xl border ${isDark ? 'bg-gradient-to-r from-[#FF6B4A]/10 to-transparent border-white/10' : 'bg-gradient-to-r from-[#FF6B4A]/5 to-transparent border-gray-200'}`}>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <p className={`text-sm ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Total Portfolio Value</p>
              <p className={`text-4xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {balanceLoading ? "..." : totalPortfolioValueUsd !== null
                  ? `$${totalPortfolioValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : "Price unavailable"}
              </p>
              <p className={`text-sm mt-1 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                {balance?.sol.uiBalance.toFixed(4) || "0"} SOL {balance?.sol.priceUsd ? `@ $${balance.sol.priceUsd.toFixed(2)}` : "(price error)"}
                {balance?.tokens && balance.tokens.length > 0 && ` + ${balance.tokens.length} token${balance.tokens.length > 1 ? 's' : ''}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-6">
              <div>
                <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Realized PnL</p>
                <p className={`text-lg font-semibold ${pnlData ? getPnLColor(pnlData.summary.totalRealizedPnl, isDark) : (isDark ? 'text-white' : 'text-gray-900')}`}>
                  {pnlData ? formatPnL(pnlData.summary.totalRealizedPnl) : "0 SOL"}
                </p>
              </div>
              <div>
                <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Volume</p>
                <p className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {pnlData ? `${formatSOL(pnlData.summary.totalVolume)} SOL` : "0 SOL"}
                </p>
              </div>
              <div>
                <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Trades</p>
                <p className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {pnlData?.summary.totalTrades || 0}
                </p>
              </div>
              <div>
                <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Win Rate</p>
                <p className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {pnlData ? `${(pnlData.summary.winRate * 100).toFixed(0)}%` : "0%"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* PnL Chart/Calendar Section */}
        <div className={`mb-6 rounded-xl border overflow-hidden ${isDark ? 'bg-[#111] border-white/10' : 'bg-white border-gray-200'}`}>
          {/* Toolbar */}
          <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2">
              <span className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>PNL Calendar</span>
            </div>

            <div className="flex items-center gap-3">
              {/* View Toggle */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setViewMode("chart")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    viewMode === "chart"
                      ? 'bg-[#FF6B4A] text-white'
                      : isDark ? 'bg-white/5 text-white/60 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <TrendingUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setViewMode("calendar")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    viewMode === "calendar"
                      ? 'bg-[#FF6B4A] text-white'
                      : isDark ? 'bg-white/5 text-white/60 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <Calendar className="h-4 w-4" />
                </button>
              </div>

              {viewMode === "chart" && (
                /* Period selector for chart view */
                <div className="flex items-center gap-1">
                  {(["1d", "7d", "30d", "all"] as Period[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        period === p
                          ? 'bg-[#FF6B4A] text-white'
                          : isDark ? 'text-white/60 hover:bg-white/10' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {p === "all" ? "All" : p.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}

              {viewMode === "calendar" && (
                /* Month navigation for calendar view */
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigateMonth(-1)}
                    className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <span className={`text-sm font-medium min-w-[120px] text-center ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {monthNames[calendarMonth - 1]} {calendarYear}
                  </span>
                  <button
                    onClick={() => navigateMonth(1)}
                    className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              )}

              {/* USD/SOL toggle - available for both chart and calendar */}
              <div className={`flex items-center rounded-lg overflow-hidden border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                <button
                  onClick={() => setCurrencyMode("usd")}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    currencyMode === "usd"
                      ? 'bg-[#FF6B4A] text-white'
                      : isDark ? 'bg-white/5 text-white/60 hover:bg-white/10' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  USD
                </button>
                <button
                  onClick={() => setCurrencyMode("sol")}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    currencyMode === "sol"
                      ? 'bg-[#FF6B4A] text-white'
                      : isDark ? 'bg-white/5 text-white/60 hover:bg-white/10' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  SOL
                </button>
              </div>

              {/* Share Button */}
              <button
                onClick={() => {
                  setSelectedDayForShare(null);
                  setShowShareModal(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FF6B4A] hover:bg-[#ff5a35] text-white transition-colors"
                title="Share PnL Card"
              >
                <Share2 className="h-4 w-4" />
                <span className="text-sm font-medium">Share</span>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-4">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-[#FF6B4A]" />
              </div>
            ) : viewMode === "chart" ? (
              /* Clean TradingView-style Line Chart */
              <div
                ref={chartContainerRef}
                className={`h-[250px] relative rounded-lg overflow-hidden ${isDark ? 'bg-[#0a0a0a]' : 'bg-gray-100'}`}
                onMouseMove={(e) => {
                  if (!chartContainerRef.current) return;
                  const rect = chartContainerRef.current.getBoundingClientRect();
                  setChartHover({
                    x: (e.clientX - rect.left) / rect.width,
                    y: (e.clientY - rect.top) / rect.height
                  });
                }}
                onMouseLeave={() => setChartHover(null)}
              >
                {/* Only show chart if there are trades in the selected period */}
                {chartData.length > 0 ? (
                  <>
                    {/* SVG Line Chart */}
                    <svg
                      viewBox="0 0 800 200"
                      preserveAspectRatio="none"
                      className="w-full h-full pointer-events-none"
                    >
                      {/* Gradient for negative - fills from line UP to top, solid at line fading up */}
                      <defs>
                        <linearGradient id="negativeGradient" x1="0%" y1="100%" x2="0%" y2="0%">
                          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.5" />
                          <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
                        </linearGradient>
                      </defs>

                      {(() => {
                        const width = 800;
                        const height = 200;
                        const padding = { top: 10, bottom: 10, left: 10, right: 10 };
                        const chartWidth = width - padding.left - padding.right;
                        const chartHeight = height - padding.top - padding.bottom;

                        // Get time range based on period
                        const now = new Date();
                        let periodStart: Date;
                        let periodEnd: Date = now; // Default end is now

                        switch (period) {
                          case "1d":
                            periodStart = new Date(now);
                            periodStart.setHours(0, 0, 0, 0);
                            break;
                          case "7d":
                            periodStart = new Date(now);
                            periodStart.setDate(periodStart.getDate() - 7);
                            periodStart.setHours(0, 0, 0, 0);
                            break;
                          case "30d":
                            periodStart = new Date(now);
                            periodStart.setDate(periodStart.getDate() - 30);
                            periodStart.setHours(0, 0, 0, 0);
                            break;
                          default:
                            // For "all", use first trade date to last trade date (+ small buffer)
                            if (chartData.length > 0) {
                              periodStart = new Date(chartData[0].date);
                              periodStart.setHours(0, 0, 0, 0);
                              // End at last trade date + 1 day buffer (or now if last trade is recent)
                              const lastTradeDate = new Date(chartData[chartData.length - 1].date);
                              lastTradeDate.setDate(lastTradeDate.getDate() + 1);
                              lastTradeDate.setHours(23, 59, 59, 999);
                              periodEnd = lastTradeDate < now ? lastTradeDate : now;
                            } else {
                              periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                            }
                        }
                        const timeRange = periodEnd.getTime() - periodStart.getTime();

                        // Build time-based data points with step chart logic
                        // Start at 0, then step to new value on each trade day, hold until next
                        const dataPoints: { time: number; cumPnl: number; label: string }[] = [];

                        // Start point at period start
                        dataPoints.push({ time: periodStart.getTime(), cumPnl: 0, label: 'Start' });

                        // Add each trade day - step chart style
                        let cumulative = 0;
                        chartData.forEach(d => {
                          const tradeTime = new Date(d.date).getTime();
                          // Add point just before trade at previous value (horizontal line)
                          if (dataPoints.length > 0) {
                            dataPoints.push({ time: tradeTime, cumPnl: cumulative, label: d.date });
                          }
                          // Add point at trade with new value (vertical step)
                          cumulative += d.pnl;
                          dataPoints.push({ time: tradeTime, cumPnl: cumulative, label: d.date });
                        });

                        // End point at period end with final value (horizontal line to end)
                        dataPoints.push({ time: periodEnd.getTime(), cumPnl: cumulative, label: 'End' });

                        // Scale Y values
                        const values = dataPoints.map(d => d.cumPnl);
                        let minVal = Math.min(...values);
                        let maxVal = Math.max(...values);
                        const range = maxVal - minVal || 0.0001;
                        minVal -= range * 0.1;
                        maxVal += range * 0.1;

                        const timeToX = (time: number) => {
                          const normalized = (time - periodStart.getTime()) / timeRange;
                          return padding.left + normalized * chartWidth;
                        };

                        const valueToY = (val: number) => {
                          const normalized = (val - minVal) / (maxVal - minVal);
                          return padding.top + (1 - normalized) * chartHeight;
                        };

                        // Generate points
                        const points = dataPoints.map(d => ({
                          x: timeToX(d.time),
                          y: valueToY(d.cumPnl),
                          data: d
                        }));

                        // Create line path
                        const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

                        const finalPnl = cumulative;
                        const isPositive = finalPnl >= 0;
                        const lineColor = isPositive ? '#22c55e' : '#ef4444';

                        // Area fill to TOP for negative (red gradient), no fill for positive (green)
                        const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top} L ${points[0].x} ${padding.top} Z`;

                        return (
                          <>
                            {/* Only show gradient fill for negative/red */}
                            {!isPositive && (
                              <path d={areaPath} fill="url(#negativeGradient)" />
                            )}
                            <path d={linePath} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </>
                        );
                      })()}
                    </svg>

                    {/* Continuous crosshair tooltip */}
                    {chartHover && (() => {
                      const solPrice = balance?.sol.priceUsd || 0;

                      // Get time range based on period (same logic as SVG chart)
                      const now = new Date();
                      let periodStart: Date;
                      let periodEnd: Date = now;

                      switch (period) {
                        case "1d":
                          periodStart = new Date(now);
                          periodStart.setHours(0, 0, 0, 0);
                          break;
                        case "7d":
                          periodStart = new Date(now);
                          periodStart.setDate(periodStart.getDate() - 7);
                          periodStart.setHours(0, 0, 0, 0);
                          break;
                        case "30d":
                          periodStart = new Date(now);
                          periodStart.setDate(periodStart.getDate() - 30);
                          periodStart.setHours(0, 0, 0, 0);
                          break;
                        default:
                          // For "all", use first trade date to last trade date (+ small buffer)
                          if (chartData.length > 0) {
                            periodStart = new Date(chartData[0].date);
                            periodStart.setHours(0, 0, 0, 0);
                            const lastTradeDate = new Date(chartData[chartData.length - 1].date);
                            lastTradeDate.setDate(lastTradeDate.getDate() + 1);
                            lastTradeDate.setHours(23, 59, 59, 999);
                            periodEnd = lastTradeDate < now ? lastTradeDate : now;
                          } else {
                            periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                          }
                      }
                      const timeRange = periodEnd.getTime() - periodStart.getTime();

                      // Convert mouse X position to time
                      const hoverTime = periodStart.getTime() + chartHover.x * timeRange;

                      // Build step chart data to find PnL at hover time
                      const steps: { time: number; cumPnl: number }[] = [];
                      steps.push({ time: periodStart.getTime(), cumPnl: 0 });

                      let cumulative = 0;
                      chartData.forEach(day => {
                        const tradeTime = new Date(day.date).getTime();
                        cumulative += day.pnl;
                        steps.push({ time: tradeTime, cumPnl: cumulative });
                      });
                      steps.push({ time: periodEnd.getTime(), cumPnl: cumulative });

                      // Find the PnL value at hoverTime (step chart - use value from last step before hoverTime)
                      let pnlAtHover = 0;
                      for (let i = steps.length - 1; i >= 0; i--) {
                        if (steps[i].time <= hoverTime) {
                          pnlAtHover = steps[i].cumPnl;
                          break;
                        }
                      }

                      const isPositive = pnlAtHover >= 0;
                      const displayValue = currencyMode === "usd" ? pnlAtHover * solPrice : pnlAtHover;

                      // Format value
                      let formattedValue: string;
                      if (currencyMode === "usd") {
                        const absVal = Math.abs(displayValue);
                        if (absVal >= 1000) {
                          formattedValue = `${isPositive ? '' : '-'}$${(absVal / 1000).toFixed(2)}K`;
                        } else {
                          formattedValue = `${isPositive ? '' : '-'}$${absVal.toFixed(2)}`;
                        }
                      } else {
                        formattedValue = `${isPositive ? '' : '-'}${Math.abs(pnlAtHover).toFixed(6)} SOL`;
                      }

                      // Format date
                      const hoverDate = new Date(hoverTime);
                      const dateLabel = hoverDate.toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit'
                      });

                      // Check tooltip positioning (flip if too close to right edge)
                      const tooltipOnLeft = chartHover.x > 0.7;

                      return (
                        <div className="absolute inset-0 pointer-events-none">
                          {/* Vertical crosshair line */}
                          <div
                            className={`absolute top-0 bottom-0 w-px ${isDark ? 'bg-white/40' : 'bg-black/40'}`}
                            style={{ left: `${chartHover.x * 100}%` }}
                          />
                          {/* Horizontal crosshair line */}
                          <div
                            className={`absolute left-0 right-0 h-px ${isDark ? 'bg-white/20' : 'bg-black/20'}`}
                            style={{ top: `${chartHover.y * 100}%` }}
                          />
                          {/* Tooltip */}
                          <div
                            className={`absolute px-3 py-2 rounded-lg text-sm whitespace-nowrap z-10 shadow-xl ${isDark ? 'bg-[#1a1a1a] border border-white/10' : 'bg-white border border-gray-200'}`}
                            style={{
                              left: tooltipOnLeft ? 'auto' : `${chartHover.x * 100}%`,
                              right: tooltipOnLeft ? `${(1 - chartHover.x) * 100}%` : 'auto',
                              top: '8px',
                              transform: tooltipOnLeft ? 'translateX(-8px)' : 'translateX(8px)'
                            }}
                          >
                            <div className={`text-base font-semibold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                              {formattedValue}
                            </div>
                            <div className={`text-xs ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
                              {dateLabel}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Logo watermark */}
                    <div className="absolute bottom-3 left-3 opacity-40">
                      <span className={`font-medium text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>[poly<span className="text-[#FF6B4A]">x</span>]</span>
                    </div>
                  </>
                ) : (
                  <div className={`w-full h-full flex items-center justify-center ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
                    No trading data for this period
                  </div>
                )}
              </div>
            ) : (
              /* Calendar View */
              <div>
                {/* Weekday Headers */}
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => (
                    <div key={i} className={`text-center text-xs py-1 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                      {day}
                    </div>
                  ))}
                </div>

                {/* Calendar Grid */}
                <div className="grid grid-cols-7 gap-1">
                  {/* Empty cells for days before month starts */}
                  {Array.from({ length: (getFirstDayOfMonth(calendarYear, calendarMonth) + 6) % 7 }).map((_, i) => (
                    <div key={`empty-${i}`} className="aspect-square" />
                  ))}

                  {/* Days */}
                  {Array.from({ length: getDaysInMonth(calendarYear, calendarMonth) }).map((_, i) => {
                    const day = i + 1;
                    const dateStr = `${calendarYear}-${String(calendarMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const dayData = calendarData[dateStr];
                    const pnlSol = dayData?.pnl || 0;
                    const hasTrades = dayData?.trades > 0;
                    const intensity = hasTrades ? Math.min(Math.abs(pnlSol) / (chartMax || 1), 1) : 0;

                    // Convert to display value based on currency mode
                    const solPrice = balance?.sol.priceUsd || 0;
                    const displayValue = currencyMode === "usd" ? pnlSol * solPrice : pnlSol;
                    const formatCalendarPnL = (val: number) => {
                      if (currencyMode === "usd") {
                        if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(1)}k`;
                        if (Math.abs(val) >= 100) return `$${val.toFixed(0)}`;
                        if (Math.abs(val) >= 1) return `$${val.toFixed(2)}`;
                        return `$${val.toFixed(2)}`;
                      } else {
                        if (Math.abs(val) >= 1) return val.toFixed(4);
                        return val.toFixed(6);
                      }
                    };

                    return (
                      <div
                        key={day}
                        onClick={() => {
                          if (hasTrades && dayData) {
                            setSelectedDayForShare(dayData);
                            setShowShareModal(true);
                          }
                        }}
                        className={`aspect-square p-1.5 rounded-lg flex flex-col transition-colors ${hasTrades ? 'cursor-pointer hover:bg-white/10' : ''}`}
                        style={{
                          backgroundColor: hasTrades ? getPnLBgColor(pnlSol, intensity) : (isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'),
                        }}
                      >
                        <span className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>{day}</span>
                        <div className="flex-1 flex items-center justify-center">
                          <span className={`text-xs sm:text-sm font-bold ${getPnLColor(pnlSol, isDark)}`}>
                            {hasTrades ? (
                              <>{displayValue >= 0 ? "+" : ""}{formatCalendarPnL(displayValue)}</>
                            ) : (
                              <span className={isDark ? 'text-white/20' : 'text-gray-300'}>0</span>
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Streak Info */}
                {pnlData && (
                  <div className={`flex items-center justify-between mt-4 pt-4 border-t text-sm ${isDark ? 'border-white/10 text-white/60' : 'border-gray-200 text-gray-600'}`}>
                    <span>Current Positive Streak: <span className={isDark ? 'text-white' : 'text-gray-900'}>{pnlData.summary.currentStreak} days</span></span>
                    <span>Best Positive Streak in {monthNames[calendarMonth - 1]}: <span className={isDark ? 'text-white' : 'text-gray-900'}>{pnlData.summary.bestStreak} day{pnlData.summary.bestStreak !== 1 ? 's' : ''}</span></span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Positions Section */}
        <div className={`rounded-xl border overflow-hidden ${isDark ? 'bg-[#111] border-white/10' : 'bg-white border-gray-200'}`}>
          <div className={`flex items-center justify-between p-4 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Positions</h2>
            <div className="flex items-center gap-1">
              {(["all", "active", "closed"] as PositionFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setPositionFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-sm capitalize transition-colors ${
                    positionFilter === f
                      ? 'bg-[#FF6B4A] text-white'
                      : isDark ? 'text-white/60 hover:bg-white/10' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {f} {f === "active" && pnlData ? `(${pnlData.activePositions.length})` : f === "closed" && pnlData ? `(${pnlData.closedPositions.length})` : ""}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[#FF6B4A]" />
            </div>
          ) : filteredPositions.length === 0 ? (
            <div className={`text-center py-12 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
              <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No {positionFilter !== "all" ? positionFilter : ""} positions</p>
              <p className="text-sm mt-1">Start trading to see your positions here</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={`text-xs ${isDark ? 'text-white/40 bg-white/5' : 'text-gray-500 bg-gray-50'}`}>
                    <th className="text-left px-4 py-3 font-medium">Token</th>
                    <th className="text-right px-4 py-3 font-medium">Bought</th>
                    <th className="text-right px-4 py-3 font-medium">Sold</th>
                    <th className="text-right px-4 py-3 font-medium">Avg Buy</th>
                    <th className="text-right px-4 py-3 font-medium">Balance</th>
                    <th className="text-right px-4 py-3 font-medium">Realized PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredPositions.map((pos) => (
                    <tr
                      key={pos.mint}
                      className={`${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'} transition-colors`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {/* Token image */}
                          {pos.image ? (
                            <img
                              src={pos.image}
                              alt={pos.symbol}
                              className="w-8 h-8 rounded-full object-cover"
                              onError={(e) => {
                                // Fallback to initials on error
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.nextElementSibling?.classList.remove('hidden');
                              }}
                            />
                          ) : null}
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${pos.image ? 'hidden' : ''} ${isDark ? 'bg-white/10 text-white/60' : 'bg-gray-200 text-gray-600'}`}>
                            {pos.symbol.slice(0, 2).toUpperCase()}
                          </div>
                          {/* Status dot */}
                          <div className={`w-2 h-2 rounded-full ${pos.isOpen ? 'bg-green-500' : isDark ? 'bg-white/20' : 'bg-gray-300'}`} />
                          {/* Token name/symbol - clickable */}
                          <Link
                            href={`/token/${pos.mint}?source=pulse`}
                            className={`font-medium transition-colors ${isDark ? 'text-white hover:text-[#FF6B4A]' : 'text-gray-900 hover:text-[#FF6B4A]'}`}
                          >
                            {pos.name || pos.symbol}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {pos.totalBought.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                        <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                          {formatSOL(pos.totalBuyCost)} SOL
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {pos.totalSold.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                        <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                          {formatSOL(pos.totalSellRevenue)} SOL
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {pos.avgBuyPrice > 0 ? pos.avgBuyPrice.toFixed(9) : "-"}
                        </p>
                        <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>SOL/token</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className={`text-sm ${pos.currentBalance > 0 ? (isDark ? 'text-white' : 'text-gray-900') : (isDark ? 'text-white/40' : 'text-gray-500')}`}>
                          {pos.currentBalance > 0.000001
                            ? pos.currentBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })
                            : "0"}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className={`text-sm font-medium ${getPnLColor(pos.realizedPnl, isDark)}`}>
                          {formatPnL(pos.realizedPnl)}
                        </p>
                        <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                          {pos.trades} trades
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Token Holdings from Wallet */}
        {balance && balance.tokens.length > 0 && (
          <div className={`mt-6 rounded-xl border overflow-hidden ${isDark ? 'bg-[#111] border-white/10' : 'bg-white border-gray-200'}`}>
            <div className={`p-4 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
              <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Wallet Holdings
              </h2>
            </div>
            <div className="p-4 grid gap-2">
              {balance.tokens.map((token) => (
                <div
                  key={token.mint}
                  className={`flex items-center justify-between p-3 rounded-lg ${isDark ? 'bg-black/30' : 'bg-gray-50'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isDark ? 'bg-white/10 text-white/60' : 'bg-gray-200 text-gray-600'}`}>
                      {token.mint.slice(0, 2)}
                    </div>
                    <div>
                      <Link
                        href={`/token/${token.mint}`}
                        className={`font-mono text-sm ${isDark ? 'text-white/60 hover:text-[#FF6B4A]' : 'text-gray-600 hover:text-[#FF6B4A]'}`}
                      >
                        {token.mint.slice(0, 8)}...{token.mint.slice(-4)}
                      </Link>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {token.uiBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </p>
                    {token.valueUsd !== null && (
                      <p className={`text-sm ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                        ${token.valueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Share PnL Card Modal */}
        {showShareModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className={`relative w-full max-w-lg rounded-2xl overflow-hidden ${isDark ? 'bg-[#111] border border-white/10' : 'bg-white border border-gray-200'}`}>
              {/* Modal Header */}
              <div className={`flex items-center justify-between p-4 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Share PnL Card</h3>
                <button
                  onClick={() => setShowShareModal(false)}
                  className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10 text-white/60' : 'hover:bg-gray-100 text-gray-500'}`}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Card Preview */}
              <div className="p-4">
                <div
                  ref={shareCardRef}
                  className="relative w-full aspect-[4/3] rounded-xl overflow-hidden"
                  style={{
                    background: bgType === "image" && customBgImage
                      ? `url(${customBgImage}) center/cover`
                      : bgType === "video" ? '#000'
                      : 'linear-gradient(135deg, #FF6B4A 0%, #FF8F6B 50%, #FFB088 100%)'
                  }}
                >
                  {/* Video background */}
                  {bgType === "video" && customBgVideo && (
                    <video
                      ref={videoRef}
                      src={customBgVideo}
                      autoPlay
                      loop
                      muted={false}
                      playsInline
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                  {/* Overlay for readability */}
                  <div className="absolute inset-0 bg-black/30" />

                  {/* Card Content */}
                  <div className="relative h-full flex flex-col justify-between p-6 text-white">
                    {/* Logo */}
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold">[poly<span className="text-[#FF6B4A]">x</span>]</span>
                    </div>

                    {/* PnL Display */}
                    <div className="text-center">
                      {selectedDayForShare ? (
                        // Showing specific day's PnL
                        <>
                          <p className="text-sm opacity-80 mb-1">
                            {new Date(selectedDayForShare.date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                          </p>
                          <p className={`text-5xl font-bold ${selectedDayForShare.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {currencyMode === "usd"
                              ? `${selectedDayForShare.pnl >= 0 ? '+' : '-'}$${Math.abs(selectedDayForShare.pnl * (balance?.sol.priceUsd || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : `${selectedDayForShare.pnl >= 0 ? '+' : '-'}${Math.abs(selectedDayForShare.pnl).toFixed(6)} SOL`
                            }
                          </p>
                          <p className="text-sm opacity-60 mt-2">
                            {selectedDayForShare.trades} trade{selectedDayForShare.trades !== 1 ? 's' : ''} • {selectedDayForShare.volume.toFixed(4)} SOL volume
                          </p>
                        </>
                      ) : (
                        // Showing period summary
                        <>
                          <p className="text-sm opacity-80 mb-1">
                            {viewMode === "calendar"
                              ? `${monthNames[calendarMonth - 1]} ${calendarYear}`
                              : period === "all" ? "All Time" : `Last ${period.toUpperCase()}`
                            } PnL
                          </p>
                          <p className={`text-5xl font-bold ${(pnlData?.summary.totalRealizedPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {currencyMode === "usd"
                              ? `${(pnlData?.summary.totalRealizedPnl || 0) >= 0 ? '+' : '-'}$${Math.abs((pnlData?.summary.totalRealizedPnl || 0) * (balance?.sol.priceUsd || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : `${(pnlData?.summary.totalRealizedPnl || 0) >= 0 ? '+' : '-'}${Math.abs(pnlData?.summary.totalRealizedPnl || 0).toFixed(4)} SOL`
                            }
                          </p>
                          <p className="text-sm opacity-60 mt-2">
                            {pnlData?.summary.totalTrades || 0} trades • {((pnlData?.summary.winRate || 0) * 100).toFixed(0)}% win rate
                          </p>
                        </>
                      )}
                    </div>

                    {/* Date */}
                    <div className="flex items-center justify-between text-sm opacity-60">
                      <span>{new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      <span>polyx.trade</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className={`p-4 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                {/* Background Type Selector */}
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Background:</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setBgType("default")}
                      className={`px-3 py-1.5 text-xs transition-colors ${
                        bgType === "default"
                          ? 'bg-[#FF6B4A] text-white'
                          : isDark ? 'bg-white/5 text-white/60 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      Default
                    </button>
                    <label className={`px-3 py-1.5 text-xs cursor-pointer transition-colors flex items-center gap-1.5 ${
                      bgType === "image"
                        ? 'bg-[#FF6B4A] text-white'
                        : isDark ? 'bg-white/5 text-white/60 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>
                      <ImageIcon className="h-3 w-3" />
                      Image
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              setCustomBgImage(ev.target?.result as string);
                              setBgType("image");
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </label>
                    <label className={`px-3 py-1.5 text-xs cursor-pointer transition-colors flex items-center gap-1.5 ${
                      bgType === "video"
                        ? 'bg-[#FF6B4A] text-white'
                        : isDark ? 'bg-white/5 text-white/60 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>
                      <Video className="h-3 w-3" />
                      Video
                      <input
                        type="file"
                        accept="video/mp4,video/webm,video/mov"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const url = URL.createObjectURL(file);
                            setCustomBgVideo(url);
                            setBgType("video");
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>

                <div className="flex items-center gap-3">

                  {bgType === "video" ? (
                    /* Video Export - Record video with sound */
                    <button
                      onClick={async () => {
                        if (!shareCardRef.current || !videoRef.current) return;
                        setIsGeneratingCard(true);
                        try {
                          const video = videoRef.current;
                          video.currentTime = 0;
                          video.muted = false;
                          await video.play();

                          // Create canvas for compositing
                          const canvas = document.createElement('canvas');
                          canvas.width = 800;
                          canvas.height = 600;
                          const ctx = canvas.getContext('2d')!;

                          // Get audio from video
                          const audioCtx = new AudioContext();
                          const source = audioCtx.createMediaElementSource(video);
                          const dest = audioCtx.createMediaStreamDestination();
                          source.connect(dest);
                          source.connect(audioCtx.destination);

                          // Capture canvas stream
                          const canvasStream = canvas.captureStream(30);

                          // Add audio track to canvas stream
                          const audioTrack = dest.stream.getAudioTracks()[0];
                          if (audioTrack) {
                            canvasStream.addTrack(audioTrack);
                          }

                          const mediaRecorder = new MediaRecorder(canvasStream, {
                            mimeType: 'video/webm;codecs=vp9,opus'
                          });

                          const chunks: Blob[] = [];
                          mediaRecorder.ondataavailable = (e) => chunks.push(e.data);

                          // Render loop - draw video and overlay text
                          const renderFrame = () => {
                            if (video.paused || video.ended) return;

                            // Draw video
                            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                            // Draw overlay
                            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                            ctx.fillRect(0, 0, canvas.width, canvas.height);

                            // Draw logo
                            ctx.font = 'bold 28px Inter, sans-serif';
                            ctx.fillStyle = 'white';
                            ctx.fillText('[poly', 24, 48);
                            ctx.fillStyle = '#FF6B4A';
                            ctx.fillText('x', 24 + ctx.measureText('[poly').width, 48);
                            ctx.fillStyle = 'white';
                            ctx.fillText(']', 24 + ctx.measureText('[polyx').width, 48);

                            // Draw PnL in center
                            const pnl = selectedDayForShare?.pnl ?? pnlData?.summary.totalRealizedPnl ?? 0;
                            const isPositive = pnl >= 0;
                            const solPrice = balance?.sol.priceUsd || 0;
                            const displayVal = currencyMode === "usd" ? pnl * solPrice : pnl;
                            const pnlText = currencyMode === "usd"
                              ? `${isPositive ? '+' : '-'}$${Math.abs(displayVal).toFixed(2)}`
                              : `${isPositive ? '+' : '-'}${Math.abs(pnl).toFixed(4)} SOL`;

                            ctx.font = 'bold 56px Inter, sans-serif';
                            ctx.fillStyle = isPositive ? '#4ade80' : '#f87171';
                            ctx.textAlign = 'center';
                            ctx.fillText(pnlText, canvas.width / 2, canvas.height / 2 + 20);
                            ctx.textAlign = 'left';

                            // Draw date and site
                            ctx.font = '16px Inter, sans-serif';
                            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                            ctx.fillText(new Date().toLocaleDateString(), 24, canvas.height - 24);
                            ctx.textAlign = 'right';
                            ctx.fillText('polyx.trade', canvas.width - 24, canvas.height - 24);
                            ctx.textAlign = 'left';

                            requestAnimationFrame(renderFrame);
                          };

                          mediaRecorder.onstart = () => {
                            renderFrame();
                          };

                          mediaRecorder.onstop = async () => {
                            const webmBlob = new Blob(chunks, { type: 'video/webm' });

                            // Convert WebM to MP4 using FFmpeg.wasm
                            try {
                              showToast('Converting to MP4...', 'info');
                              const { FFmpeg } = await import('@ffmpeg/ffmpeg');
                              const { fetchFile } = await import('@ffmpeg/util');

                              const ffmpeg = new FFmpeg();
                              await ffmpeg.load();

                              await ffmpeg.writeFile('input.webm', await fetchFile(webmBlob));
                              await ffmpeg.exec(['-i', 'input.webm', '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', 'output.mp4']);

                              const data = await ffmpeg.readFile('output.mp4');
                              const mp4Blob = new Blob([data], { type: 'video/mp4' });

                              const link = document.createElement('a');
                              link.download = `polyx-pnl-${new Date().toISOString().split('T')[0]}.mp4`;
                              link.href = URL.createObjectURL(mp4Blob);
                              link.click();
                              showToast('Video downloaded!', 'success');
                            } catch (convErr) {
                              console.error('FFmpeg conversion failed, falling back to WebM:', convErr);
                              // Fallback to WebM if FFmpeg fails
                              const link = document.createElement('a');
                              link.download = `polyx-pnl-${new Date().toISOString().split('T')[0]}.webm`;
                              link.href = URL.createObjectURL(webmBlob);
                              link.click();
                              showToast('Downloaded as WebM (MP4 conversion failed)', 'info');
                            }

                            setIsGeneratingCard(false);
                            video.pause();
                            audioCtx.close();
                          };

                          // Record for 5 seconds or video duration
                          const duration = Math.min(video.duration * 1000, 5000);
                          mediaRecorder.start();

                          setTimeout(() => {
                            mediaRecorder.stop();
                          }, duration);

                        } catch (err) {
                          console.error('Failed to record video:', err);
                          showToast('Video recording failed. Try a different browser.', 'error');
                          setIsGeneratingCard(false);
                        }
                      }}
                      disabled={isGeneratingCard}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#FF6B4A] hover:bg-[#ff5a35] text-white transition-colors disabled:opacity-50"
                    >
                      {isGeneratingCard ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Video className="h-4 w-4" />
                      )}
                      <span className="text-sm font-medium">Export Video</span>
                    </button>
                  ) : (
                    /* Image Export - Copy and Download */
                    <>
                      {/* Copy Button */}
                      <button
                        onClick={async () => {
                          if (!shareCardRef.current) return;
                          setIsGeneratingCard(true);
                          try {
                            const html2canvas = (await import('html2canvas')).default;
                            const canvas = await html2canvas(shareCardRef.current, {
                              scale: 2,
                              useCORS: true,
                              backgroundColor: null,
                            });
                            canvas.toBlob(async (blob) => {
                              if (blob) {
                                try {
                                  await navigator.clipboard.write([
                                    new ClipboardItem({ 'image/png': blob })
                                  ]);
                                  showToast('Copied to clipboard!', 'success');
                                } catch {
                                  showToast('Copy failed. Try downloading instead.', 'error');
                                }
                              }
                            }, 'image/png');
                          } catch (err) {
                            console.error('Failed to copy card:', err);
                            showToast('Failed to copy. Try downloading instead.', 'error');
                          } finally {
                            setIsGeneratingCard(false);
                          }
                        }}
                        disabled={isGeneratingCard}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 ${
                          isDark ? 'bg-white/5 hover:bg-white/10 border border-white/10 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
                        }`}
                      >
                        <Copy className="h-4 w-4" />
                        <span className="text-sm font-medium">Copy</span>
                      </button>

                      {/* Download Button */}
                      <button
                        onClick={async () => {
                          if (!shareCardRef.current) return;
                          setIsGeneratingCard(true);
                          try {
                            const html2canvas = (await import('html2canvas')).default;
                            const canvas = await html2canvas(shareCardRef.current, {
                              scale: 2,
                              useCORS: true,
                              backgroundColor: null,
                            });
                            const link = document.createElement('a');
                            link.download = `polyx-pnl-${new Date().toISOString().split('T')[0]}.png`;
                            link.href = canvas.toDataURL('image/png');
                            link.click();
                            showToast('Image downloaded!', 'success');
                          } catch (err) {
                            console.error('Failed to generate card:', err);
                            showToast('Failed to generate image. Please try again.', 'error');
                          } finally {
                            setIsGeneratingCard(false);
                          }
                        }}
                        disabled={isGeneratingCard}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#FF6B4A] hover:bg-[#ff5a35] text-white transition-colors disabled:opacity-50"
                      >
                        {isGeneratingCard ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        <span className="text-sm font-medium">Download</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
