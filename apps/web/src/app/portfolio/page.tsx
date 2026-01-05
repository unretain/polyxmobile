"use client";

import { useState, useEffect, useMemo } from "react";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { useThemeStore } from "@/stores/themeStore";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { formatNumber, shortenAddress, cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Flame,
  Trophy,
  BarChart3,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
} from "lucide-react";
import Image from "next/image";

type Period = "1d" | "7d" | "30d" | "all" | "calendar";

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

interface PnLData {
  period: string;
  startDate: string;
  endDate: string;
  cumulativePnLBaseline: number;
  summary: {
    totalRealizedPnl: number;
    totalVolume: number;
    totalTrades: number;
    currentStreak: number;
    bestStreak: number;
    winRate: number;
  };
  dailyPnL: DailyPnL[];
  calendarData?: Record<string, DailyPnL>;
  positions: Position[];
  activePositions: Position[];
  closedPositions: Position[];
}

export default function PortfolioPage() {
  const { isDark } = useThemeStore();
  const { wallet } = useMobileWalletStore();
  const [period, setPeriod] = useState<Period>("30d");
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth() + 1);
  const [data, setData] = useState<PnLData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "positions">("overview");

  // Fetch PnL data
  useEffect(() => {
    async function fetchPnL() {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ period });
        if (period === "calendar") {
          params.set("year", calendarYear.toString());
          params.set("month", calendarMonth.toString());
        }
        const res = await fetch(`/api/trading/pnl?${params}`);
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (error) {
        console.error("Failed to fetch PnL:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchPnL();
  }, [period, calendarYear, calendarMonth]);

  // Calculate cumulative PnL for chart
  const cumulativePnL = useMemo(() => {
    if (!data?.dailyPnL) return [];
    let cumulative = data.cumulativePnLBaseline || 0;
    return data.dailyPnL.map((d) => {
      cumulative += d.pnl;
      return { date: d.date, value: cumulative, dailyPnl: d.pnl };
    });
  }, [data]);

  // Calendar navigation
  const prevMonth = () => {
    if (calendarMonth === 1) {
      setCalendarMonth(12);
      setCalendarYear(calendarYear - 1);
    } else {
      setCalendarMonth(calendarMonth - 1);
    }
  };

  const nextMonth = () => {
    if (calendarMonth === 12) {
      setCalendarMonth(1);
      setCalendarYear(calendarYear + 1);
    } else {
      setCalendarMonth(calendarMonth + 1);
    }
  };

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  return (
    <AuthGuard>
      <div className={`min-h-screen ${isDark ? "bg-[#0a0a0a] text-white" : "bg-[#f5f5f5] text-black"}`}>
        <MobileHeader />

        <main className="pt-20 px-4 pb-24">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
              Portfolio
            </h1>
            {wallet && (
              <div className={`text-xs font-mono px-2 py-1 rounded ${isDark ? "bg-white/10 text-white/60" : "bg-black/5 text-gray-500"}`}>
                {shortenAddress(wallet.publicKey, 4)}
              </div>
            )}
          </div>

          {/* Period Selector */}
          <div className="flex gap-1 mb-4 overflow-x-auto pb-2">
            {(["1d", "7d", "30d", "all", "calendar"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors",
                  period === p
                    ? "bg-[#FF6B4A] text-white"
                    : isDark
                    ? "bg-white/10 text-white/60 hover:bg-white/20"
                    : "bg-black/5 text-gray-500 hover:bg-black/10"
                )}
              >
                {p === "calendar" ? "Calendar" : p.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveTab("overview")}
              className={cn(
                "flex-1 py-2 text-sm font-medium rounded-lg transition-colors",
                activeTab === "overview"
                  ? isDark ? "bg-white/20 text-white" : "bg-black/10 text-black"
                  : isDark ? "text-white/50" : "text-gray-400"
              )}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab("positions")}
              className={cn(
                "flex-1 py-2 text-sm font-medium rounded-lg transition-colors",
                activeTab === "positions"
                  ? isDark ? "bg-white/20 text-white" : "bg-black/10 text-black"
                  : isDark ? "text-white/50" : "text-gray-400"
              )}
            >
              Positions
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
            </div>
          ) : activeTab === "overview" ? (
            <>
              {/* Stats Cards */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <StatCard
                  icon={<TrendingUp className="w-4 h-4" />}
                  label="Total PnL"
                  value={`${data?.summary.totalRealizedPnl && data.summary.totalRealizedPnl >= 0 ? "+" : ""}${(data?.summary.totalRealizedPnl || 0).toFixed(4)} SOL`}
                  positive={(data?.summary.totalRealizedPnl || 0) >= 0}
                  isDark={isDark}
                />
                <StatCard
                  icon={<BarChart3 className="w-4 h-4" />}
                  label="Volume"
                  value={`${formatNumber(data?.summary.totalVolume || 0, 2)} SOL`}
                  isDark={isDark}
                />
                <StatCard
                  icon={<Flame className="w-4 h-4" />}
                  label="Current Streak"
                  value={`${data?.summary.currentStreak || 0} days`}
                  isDark={isDark}
                />
                <StatCard
                  icon={<Trophy className="w-4 h-4" />}
                  label="Win Rate"
                  value={`${((data?.summary.winRate || 0) * 100).toFixed(0)}%`}
                  isDark={isDark}
                />
              </div>

              {/* PnL Chart or Calendar */}
              {period === "calendar" ? (
                <PnLCalendar
                  year={calendarYear}
                  month={calendarMonth}
                  data={data?.calendarData || {}}
                  onPrevMonth={prevMonth}
                  onNextMonth={nextMonth}
                  monthName={monthNames[calendarMonth - 1]}
                  isDark={isDark}
                />
              ) : (
                <PnLChart data={cumulativePnL} isDark={isDark} />
              )}

              {/* Recent Activity */}
              <div className={`mt-4 p-4 rounded-xl border ${isDark ? "bg-white/5 border-white/10" : "bg-white border-gray-200"}`}>
                <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Recent Daily PnL
                </h3>
                <div className="space-y-2">
                  {data?.dailyPnL.slice(-5).reverse().map((day) => (
                    <div key={day.date} className="flex items-center justify-between">
                      <span className={`text-xs ${isDark ? "text-white/60" : "text-gray-500"}`}>
                        {new Date(day.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs ${isDark ? "text-white/40" : "text-gray-400"}`}>
                          {day.trades} trades
                        </span>
                        <span className={cn(
                          "text-xs font-medium",
                          day.pnl >= 0 ? "text-green-500" : "text-red-500"
                        )}>
                          {day.pnl >= 0 ? "+" : ""}{day.pnl.toFixed(4)} SOL
                        </span>
                      </div>
                    </div>
                  ))}
                  {(!data?.dailyPnL || data.dailyPnL.length === 0) && (
                    <p className={`text-xs text-center py-4 ${isDark ? "text-white/40" : "text-gray-400"}`}>
                      No trading activity
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* Positions Tab */
            <div className="space-y-4">
              {/* Active Positions */}
              <div>
                <h3 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  Active Positions ({data?.activePositions?.length || 0})
                </h3>
                <div className="space-y-2">
                  {data?.activePositions?.map((pos) => (
                    <PositionCard key={pos.mint} position={pos} isDark={isDark} />
                  ))}
                  {(!data?.activePositions || data.activePositions.length === 0) && (
                    <p className={`text-xs text-center py-4 ${isDark ? "text-white/40" : "text-gray-400"}`}>
                      No active positions
                    </p>
                  )}
                </div>
              </div>

              {/* Closed Positions */}
              <div>
                <h3 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                  <div className="w-2 h-2 rounded-full bg-gray-500" />
                  Closed Positions ({data?.closedPositions?.length || 0})
                </h3>
                <div className="space-y-2">
                  {data?.closedPositions?.slice(0, 10).map((pos) => (
                    <PositionCard key={pos.mint} position={pos} isDark={isDark} />
                  ))}
                  {(!data?.closedPositions || data.closedPositions.length === 0) && (
                    <p className={`text-xs text-center py-4 ${isDark ? "text-white/40" : "text-gray-400"}`}>
                      No closed positions
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </AuthGuard>
  );
}

// Stat Card Component
function StatCard({
  icon,
  label,
  value,
  positive,
  isDark,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  positive?: boolean;
  isDark: boolean;
}) {
  return (
    <div className={`p-3 rounded-xl border ${isDark ? "bg-white/5 border-white/10" : "bg-white border-gray-200"}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={isDark ? "text-[#FF6B4A]" : "text-[#FF6B4A]"}>{icon}</span>
        <span className={`text-xs ${isDark ? "text-white/50" : "text-gray-500"}`}>{label}</span>
      </div>
      <p className={cn(
        "text-sm font-semibold",
        positive !== undefined
          ? positive ? "text-green-500" : "text-red-500"
          : isDark ? "text-white" : "text-gray-900"
      )}>
        {value}
      </p>
    </div>
  );
}

// PnL Chart Component
function PnLChart({ data, isDark }: { data: { date: string; value: number; dailyPnl: number }[]; isDark: boolean }) {
  if (!data || data.length === 0) {
    return (
      <div className={`h-48 rounded-xl border flex items-center justify-center ${isDark ? "bg-white/5 border-white/10" : "bg-white border-gray-200"}`}>
        <p className={`text-sm ${isDark ? "text-white/40" : "text-gray-400"}`}>No data to display</p>
      </div>
    );
  }

  const minValue = Math.min(...data.map((d) => d.value));
  const maxValue = Math.max(...data.map((d) => d.value));
  const range = maxValue - minValue || 1;
  const height = 160;
  const width = 100;

  // Generate SVG path
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((d.value - minValue) / range) * height;
    return `${x},${y}`;
  }).join(" ");

  const isPositive = data[data.length - 1]?.value >= 0;

  return (
    <div className={`p-4 rounded-xl border ${isDark ? "bg-white/5 border-white/10" : "bg-white border-gray-200"}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
          Cumulative PnL
        </h3>
        <span className={cn(
          "text-xs font-medium",
          isPositive ? "text-green-500" : "text-red-500"
        )}>
          {isPositive ? "+" : ""}{data[data.length - 1]?.value.toFixed(4)} SOL
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-40">
        {/* Zero line */}
        {minValue < 0 && maxValue > 0 && (
          <line
            x1="0"
            y1={height - ((0 - minValue) / range) * height}
            x2={width}
            y2={height - ((0 - minValue) / range) * height}
            stroke={isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.1)"}
            strokeWidth="0.5"
            strokeDasharray="2,2"
          />
        )}
        {/* Area fill */}
        <polygon
          points={`0,${height} ${points} ${width},${height}`}
          fill={isPositive ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)"}
        />
        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke={isPositive ? "#22c55e" : "#ef4444"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

// PnL Calendar Component
function PnLCalendar({
  year,
  month,
  data,
  onPrevMonth,
  onNextMonth,
  monthName,
  isDark,
}: {
  year: number;
  month: number;
  data: Record<string, DailyPnL>;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  monthName: string;
  isDark: boolean;
}) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfMonth = new Date(year, month - 1, 1).getDay();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className={`p-4 rounded-xl border ${isDark ? "bg-white/5 border-white/10" : "bg-white border-gray-200"}`}>
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={onPrevMonth} className={`p-1 rounded ${isDark ? "hover:bg-white/10" : "hover:bg-black/5"}`}>
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h3 className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
          {monthName} {year}
        </h3>
        <button onClick={onNextMonth} className={`p-1 rounded ${isDark ? "hover:bg-white/10" : "hover:bg-black/5"}`}>
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Week Days Header */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {weekDays.map((day) => (
          <div key={day} className={`text-center text-[10px] font-medium ${isDark ? "text-white/40" : "text-gray-400"}`}>
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {/* Empty cells for days before first of month */}
        {Array.from({ length: firstDayOfMonth }).map((_, i) => (
          <div key={`empty-${i}`} className="aspect-square" />
        ))}

        {/* Day cells */}
        {days.map((day) => {
          const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayData = data[dateStr];
          const pnl = dayData?.pnl || 0;
          const hasTrades = dayData && dayData.trades > 0;

          return (
            <div
              key={day}
              className={cn(
                "aspect-square rounded-md flex flex-col items-center justify-center text-[10px] relative",
                hasTrades
                  ? pnl > 0
                    ? "bg-green-500/20 text-green-500"
                    : pnl < 0
                    ? "bg-red-500/20 text-red-500"
                    : isDark ? "bg-white/5 text-white/60" : "bg-black/5 text-gray-500"
                  : isDark ? "text-white/30" : "text-gray-300"
              )}
            >
              <span className="font-medium">{day}</span>
              {hasTrades && (
                <span className="text-[8px] font-medium">
                  {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Position Card Component
function PositionCard({ position, isDark }: { position: Position; isDark: boolean }) {
  const pnlPercent = position.totalBuyCost > 0
    ? ((position.realizedPnl / position.totalBuyCost) * 100)
    : 0;

  return (
    <div className={`p-3 rounded-xl border ${isDark ? "bg-white/5 border-white/10" : "bg-white border-gray-200"}`}>
      <div className="flex items-center gap-3">
        {/* Token Image */}
        <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10 flex-shrink-0">
          {position.image ? (
            <Image src={position.image} alt={position.symbol} width={40} height={40} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs font-bold text-white/50">
              {position.symbol?.slice(0, 2)}
            </div>
          )}
        </div>

        {/* Token Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-semibold text-sm truncate ${isDark ? "text-white" : "text-gray-900"}`}>
              {position.symbol || shortenAddress(position.mint, 4)}
            </span>
            <a
              href={`https://solscan.io/token/${position.mint}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#FF6B4A]"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className={`text-xs ${isDark ? "text-white/50" : "text-gray-500"}`}>
            {position.trades} trades
            {position.isOpen && ` | ${formatNumber(position.currentBalance, 0)} held`}
          </div>
        </div>

        {/* PnL */}
        <div className="text-right">
          <div className={cn(
            "text-sm font-semibold flex items-center gap-1",
            position.realizedPnl >= 0 ? "text-green-500" : "text-red-500"
          )}>
            {position.realizedPnl >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {position.realizedPnl >= 0 ? "+" : ""}{position.realizedPnl.toFixed(4)}
          </div>
          <div className={`text-xs ${isDark ? "text-white/40" : "text-gray-400"}`}>
            {pnlPercent >= 0 ? "+" : ""}{pnlPercent.toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}
