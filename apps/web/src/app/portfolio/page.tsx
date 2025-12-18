"use client";

import { useEffect, useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { useThemeStore } from "@/stores/themeStore";
import {
  ExternalLink,
  Loader2,
  History,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Calendar,
  BarChart3,
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

export default function PortfolioPage() {
  const { isDark } = useThemeStore();
  const { status } = useSession();
  const router = useRouter();

  const [pnlData, setPnlData] = useState<PnLResponse | null>(null);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [balanceLoading, setBalanceLoading] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>("chart");
  const [period, setPeriod] = useState<Period>("30d");
  const [positionFilter, setPositionFilter] = useState<PositionFilter>("all");

  // Calendar state
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth() + 1);
  const [calendarData, setCalendarData] = useState<Record<string, DailyPnL>>({});

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

      const res = await fetch(url);
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

  // Fetch balance
  const fetchBalance = async () => {
    try {
      setBalanceLoading(true);
      const res = await fetch("/api/trading/balance");
      if (res.ok) {
        const data = await res.json();
        setBalance(data);
      }
    } catch (err) {
      console.error("Failed to fetch balance:", err);
    } finally {
      setBalanceLoading(false);
    }
  };

  useEffect(() => {
    if (status === "authenticated") {
      fetchPnL();
      fetchBalance();
    }
  }, [status, period, viewMode, calendarYear, calendarMonth]);

  // Calculate chart max value for scaling
  const chartMax = useMemo(() => {
    if (!pnlData?.dailyPnL.length) return 1;
    const max = Math.max(...pnlData.dailyPnL.map(d => Math.abs(d.pnl)));
    return max || 1;
  }, [pnlData]);

  // Total portfolio value from balance API (includes SOL + all tokens)
  const totalPortfolioValueUsd = balance?.totalValueUsd ?? null;

  // Filter positions
  const filteredPositions = useMemo(() => {
    if (!pnlData) return [];
    switch (positionFilter) {
      case "active":
        return pnlData.activePositions;
      case "closed":
        return pnlData.closedPositions;
      default:
        return pnlData.positions;
    }
  }, [pnlData, positionFilter]);

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
                {totalPortfolioValueUsd !== null
                  ? `$${totalPortfolioValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : balanceLoading ? "..." : "$0.00"}
              </p>
              <p className={`text-sm mt-1 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                {balance?.sol.uiBalance.toFixed(4) || "0"} SOL {balance?.sol.priceUsd ? `@ $${balance.sol.priceUsd.toFixed(2)}` : ""}
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
                  <BarChart3 className="h-4 w-4" />
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
            </div>
          </div>

          {/* Content */}
          <div className="p-4">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-[#FF6B4A]" />
              </div>
            ) : viewMode === "chart" ? (
              /* Bar Chart View */
              <div className="h-[200px] flex items-end gap-1">
                {pnlData?.dailyPnL.length ? (
                  pnlData.dailyPnL.map((day) => {
                    const height = Math.abs(day.pnl) / chartMax * 100;
                    const isPositive = day.pnl >= 0;
                    return (
                      <div
                        key={day.date}
                        className="flex-1 flex flex-col items-center justify-end group relative"
                        style={{ minWidth: "8px", maxWidth: "40px" }}
                      >
                        <div
                          className={`w-full rounded-t transition-all ${
                            isPositive ? 'bg-green-500' : 'bg-red-500'
                          } hover:opacity-80`}
                          style={{ height: `${Math.max(height, 2)}%` }}
                        />
                        {/* Tooltip */}
                        <div className={`absolute bottom-full mb-2 px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 ${
                          isDark ? 'bg-white/10 text-white' : 'bg-gray-800 text-white'
                        }`}>
                          <div className="font-medium">{new Date(day.date).toLocaleDateString()}</div>
                          <div className={isPositive ? 'text-green-400' : 'text-red-400'}>
                            {formatPnL(day.pnl)}
                          </div>
                          <div className="text-white/60">{day.trades} trades</div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className={`w-full h-full flex items-center justify-center ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
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
                    const pnl = dayData?.pnl || 0;
                    const hasTrades = dayData?.trades > 0;
                    const isToday = new Date().toISOString().split("T")[0] === dateStr;
                    const intensity = hasTrades ? Math.min(Math.abs(pnl) / (chartMax || 1), 1) : 0;

                    return (
                      <div
                        key={day}
                        className={`aspect-square p-1.5 rounded-lg flex flex-col transition-colors ${
                          isToday ? 'ring-2 ring-[#FF6B4A]' : ''
                        }`}
                        style={{
                          backgroundColor: hasTrades ? getPnLBgColor(pnl, intensity) : (isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'),
                        }}
                      >
                        <span className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>{day}</span>
                        <div className="flex-1 flex items-center justify-center">
                          <span className={`text-xs sm:text-sm font-bold ${getPnLColor(pnl, isDark)}`}>
                            {hasTrades ? (
                              <>{pnl >= 0 ? "+" : ""}{pnl >= 100 || pnl <= -100 ? `$${Math.round(pnl)}` : `$${pnl.toFixed(2)}`}</>
                            ) : (
                              <span className={isDark ? 'text-white/20' : 'text-gray-300'}>$0</span>
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
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${pos.isOpen ? 'bg-green-500' : 'bg-white/20'}`} />
                          <div>
                            <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{pos.symbol}</p>
                            <Link
                              href={`/token/${pos.mint}`}
                              className={`text-xs ${isDark ? 'text-white/40 hover:text-[#FF6B4A]' : 'text-gray-500 hover:text-[#FF6B4A]'} flex items-center gap-1`}
                            >
                              View <ExternalLink className="h-3 w-3" />
                            </Link>
                          </div>
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
      </main>
    </div>
  );
}
