"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { useThemeStore } from "@/stores/themeStore";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { formatNumber, shortenAddress, cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Flame,
  Trophy,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  Share2,
  X,
  Download,
  Copy,
  Image as ImageIcon,
  Loader2,
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

  // Share card state
  const [showShareModal, setShowShareModal] = useState(false);
  const [customBgImage, setCustomBgImage] = useState<string | null>(null);
  const [isGeneratingCard, setIsGeneratingCard] = useState(false);
  const [selectedDayForShare, setSelectedDayForShare] = useState<DailyPnL | null>(null);
  const shareCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Generate PnL card on canvas
  const generatePnLCard = useCallback(async (): Promise<Blob | null> => {
    const canvas = shareCanvasRef.current;
    if (!canvas) return null;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const width = 800;
    const height = 600;
    canvas.width = width;
    canvas.height = height;

    // Draw background
    if (customBgImage) {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          // Cover fit
          const scale = Math.max(width / img.width, height / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          const x = (width - w) / 2;
          const y = (height - h) / 2;
          ctx.drawImage(img, x, y, w, h);
          resolve();
        };
        img.onerror = reject;
        img.src = customBgImage;
      });
    } else {
      // Default gradient background
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#FF6B4A");
      gradient.addColorStop(0.5, "#FF8F6B");
      gradient.addColorStop(1, "#FFB088");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }

    // Dark overlay
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fillRect(0, 0, width, height);

    // Get PnL data
    const pnl = selectedDayForShare?.pnl ?? data?.summary.totalRealizedPnl ?? 0;
    const isPositive = pnl >= 0;
    const trades = selectedDayForShare?.trades ?? data?.summary.totalTrades ?? 0;
    const winRate = ((data?.summary.winRate || 0) * 100).toFixed(0);

    // Logo
    ctx.font = "bold 36px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "white";
    ctx.fillText("[poly", 40, 60);
    ctx.fillStyle = "#FF6B4A";
    ctx.fillText("x", 40 + ctx.measureText("[poly").width, 60);
    ctx.fillStyle = "white";
    ctx.fillText("]", 40 + ctx.measureText("[polyx").width, 60);

    // Period label
    ctx.textAlign = "center";
    ctx.font = "20px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    const periodLabel = selectedDayForShare
      ? new Date(selectedDayForShare.date).toLocaleDateString(undefined, {
          weekday: "long", month: "long", day: "numeric", year: "numeric"
        })
      : period === "calendar"
        ? `${monthNames[calendarMonth - 1]} ${calendarYear}`
        : period === "all" ? "All Time" : `Last ${period.toUpperCase()}`;
    ctx.fillText(`${periodLabel} PnL`, width / 2, height * 0.38);

    // PnL value
    ctx.font = "bold 72px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = isPositive ? "#4ade80" : "#f87171";
    const pnlText = `${isPositive ? "+" : ""}${pnl.toFixed(4)} SOL`;
    ctx.fillText(pnlText, width / 2, height * 0.52);

    // Stats
    ctx.font = "18px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    const statsText = selectedDayForShare
      ? `${trades} trade${trades !== 1 ? "s" : ""} • ${(selectedDayForShare.volume || 0).toFixed(4)} SOL volume`
      : `${trades} trades • ${winRate}% win rate`;
    ctx.fillText(statsText, width / 2, height * 0.62);

    // Footer
    ctx.font = "16px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), 40, height - 40);
    ctx.textAlign = "right";
    ctx.fillText("polyx.trade", width - 40, height - 40);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    });
  }, [customBgImage, selectedDayForShare, data, period, calendarMonth, calendarYear, monthNames]);

  // Download card
  const handleDownloadCard = async () => {
    setIsGeneratingCard(true);
    try {
      const blob = await generatePnLCard();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `polyx-pnl-${new Date().toISOString().split("T")[0]}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setIsGeneratingCard(false);
    }
  };

  // Copy card to clipboard
  const handleCopyCard = async () => {
    setIsGeneratingCard(true);
    try {
      const blob = await generatePnLCard();
      if (blob) {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob })
        ]);
      }
    } catch (err) {
      console.error("Failed to copy:", err);
    } finally {
      setIsGeneratingCard(false);
    }
  };

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
            <div className="flex items-center gap-2">
              {/* Share Button */}
              <button
                onClick={() => {
                  setSelectedDayForShare(null);
                  setShowShareModal(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FF6B4A] text-white text-xs font-medium"
              >
                <Share2 className="w-3.5 h-3.5" />
                Share
              </button>
              {wallet && (
                <div className={`text-xs font-mono px-2 py-1 rounded ${isDark ? "bg-white/10 text-white/60" : "bg-black/5 text-gray-500"}`}>
                  {shortenAddress(wallet.publicKey, 4)}
                </div>
              )}
            </div>
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
                  onDayClick={(day) => {
                    setSelectedDayForShare(day);
                    setShowShareModal(true);
                  }}
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

        {/* Hidden canvas for generating share card */}
        <canvas ref={shareCanvasRef} className="hidden" />

        {/* Hidden file input for custom background */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = (ev) => {
                setCustomBgImage(ev.target?.result as string);
              };
              reader.readAsDataURL(file);
            }
          }}
        />

        {/* Share Modal */}
        {showShareModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className={`relative w-full max-w-sm rounded-2xl overflow-hidden ${isDark ? "bg-[#111] border border-white/10" : "bg-white border border-gray-200"}`}>
              {/* Modal Header */}
              <div className={`flex items-center justify-between p-4 border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
                <h3 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Share PnL Card</h3>
                <button
                  onClick={() => setShowShareModal(false)}
                  className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-white/10 text-white/60" : "hover:bg-gray-100 text-gray-500"}`}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Card Preview */}
              <div className="p-4">
                <div
                  className="relative w-full aspect-[4/3] rounded-xl overflow-hidden"
                  style={{
                    background: customBgImage
                      ? `url(${customBgImage}) center/cover`
                      : "linear-gradient(135deg, #FF6B4A 0%, #FF8F6B 50%, #FFB088 100%)"
                  }}
                >
                  {/* Overlay */}
                  <div className="absolute inset-0 bg-black/30" />

                  {/* Card Content */}
                  <div className="relative h-full flex flex-col justify-between p-4 text-white">
                    {/* Logo */}
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold">[poly<span className="text-[#FF6B4A]">x</span>]</span>
                    </div>

                    {/* PnL Display */}
                    <div className="text-center">
                      {selectedDayForShare ? (
                        <>
                          <p className="text-xs opacity-80 mb-1">
                            {new Date(selectedDayForShare.date).toLocaleDateString(undefined, {
                              weekday: "long", month: "long", day: "numeric"
                            })}
                          </p>
                          <p className={`text-3xl font-bold ${selectedDayForShare.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {selectedDayForShare.pnl >= 0 ? "+" : ""}{selectedDayForShare.pnl.toFixed(4)} SOL
                          </p>
                          <p className="text-xs opacity-60 mt-1">
                            {selectedDayForShare.trades} trade{selectedDayForShare.trades !== 1 ? "s" : ""}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs opacity-80 mb-1">
                            {period === "calendar"
                              ? `${monthNames[calendarMonth - 1]} ${calendarYear}`
                              : period === "all" ? "All Time" : `Last ${period.toUpperCase()}`} PnL
                          </p>
                          <p className={`text-3xl font-bold ${(data?.summary.totalRealizedPnl || 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {(data?.summary.totalRealizedPnl || 0) >= 0 ? "+" : ""}{(data?.summary.totalRealizedPnl || 0).toFixed(4)} SOL
                          </p>
                          <p className="text-xs opacity-60 mt-1">
                            {data?.summary.totalTrades || 0} trades • {((data?.summary.winRate || 0) * 100).toFixed(0)}% win rate
                          </p>
                        </>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between text-[10px] opacity-60">
                      <span>{new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                      <span>polyx.trade</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className={`p-4 border-t ${isDark ? "border-white/10" : "border-gray-200"}`}>
                {/* Background selector */}
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-xs ${isDark ? "text-white/40" : "text-gray-500"}`}>Background:</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setCustomBgImage(null)}
                      className={cn(
                        "px-2 py-1 text-xs rounded transition-colors",
                        !customBgImage
                          ? "bg-[#FF6B4A] text-white"
                          : isDark ? "bg-white/5 text-white/60 hover:bg-white/10" : "bg-gray-100 text-gray-600"
                      )}
                    >
                      Default
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        "px-2 py-1 text-xs rounded transition-colors flex items-center gap-1",
                        customBgImage
                          ? "bg-[#FF6B4A] text-white"
                          : isDark ? "bg-white/5 text-white/60 hover:bg-white/10" : "bg-gray-100 text-gray-600"
                      )}
                    >
                      <ImageIcon className="w-3 h-3" />
                      Custom
                    </button>
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyCard}
                    disabled={isGeneratingCard}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50",
                      isDark ? "bg-white/5 hover:bg-white/10 border border-white/10 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-900"
                    )}
                  >
                    <Copy className="h-4 w-4" />
                    <span className="text-sm font-medium">Copy</span>
                  </button>
                  <button
                    onClick={handleDownloadCard}
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
                </div>
              </div>
            </div>
          </div>
        )}
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
  onDayClick,
  monthName,
  isDark,
}: {
  year: number;
  month: number;
  data: Record<string, DailyPnL>;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onDayClick?: (day: DailyPnL) => void;
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
              onClick={() => hasTrades && dayData && onDayClick?.(dayData)}
              className={cn(
                "aspect-square rounded-md flex flex-col items-center justify-center text-[10px] relative transition-transform",
                hasTrades
                  ? pnl > 0
                    ? "bg-green-500/20 text-green-500 cursor-pointer active:scale-95"
                    : pnl < 0
                    ? "bg-red-500/20 text-red-500 cursor-pointer active:scale-95"
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
