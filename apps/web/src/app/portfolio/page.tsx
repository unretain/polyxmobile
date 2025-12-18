"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { useThemeStore } from "@/stores/themeStore";
import {
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  Loader2,
  TrendingUp,
  TrendingDown,
  Wallet,
  History,
  RefreshCw,
} from "lucide-react";

const SOL_MINT = "So11111111111111111111111111111111111111112";

interface Trade {
  id: string;
  inputMint: string;
  inputSymbol: string;
  outputMint: string;
  outputSymbol: string;
  amountIn: string;
  amountOut: string;
  priceImpact: number | null;
  txSignature: string | null;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  errorMessage: string | null;
  platformFee: string | null;
  createdAt: string;
  confirmedAt: string | null;
  explorerUrl: string | null;
}

interface BalanceResponse {
  walletAddress: string;
  sol: {
    mint: string;
    balance: string;
    uiBalance: number;
    decimals: number;
  };
  tokens: Array<{
    mint: string;
    balance: string;
    uiBalance: number;
    decimals: number;
  }>;
}

interface HistoryResponse {
  trades: Trade[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export default function PortfolioPage() {
  const { isDark } = useThemeStore();
  const { data: session, status } = useSession();
  const router = useRouter();

  const [trades, setTrades] = useState<Trade[]>([]);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "CONFIRMED" | "PENDING" | "FAILED">("all");
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/");
    }
  }, [status, router]);

  // Fetch trade history
  const fetchTrades = async (reset = false) => {
    try {
      setLoading(true);
      const newOffset = reset ? 0 : offset;
      const statusParam = filter !== "all" ? `&status=${filter}` : "";
      const res = await fetch(`/api/trading/history?limit=20&offset=${newOffset}${statusParam}`);
      const data: HistoryResponse = await res.json();

      if (reset) {
        setTrades(data.trades);
      } else {
        setTrades((prev) => [...prev, ...data.trades]);
      }
      setHasMore(data.hasMore);
      setOffset(newOffset + data.trades.length);
    } catch (err) {
      console.error("Failed to fetch trades:", err);
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
      fetchTrades(true);
      fetchBalance();
    }
  }, [status, filter]);

  // Calculate stats from trades
  const stats = {
    totalTrades: trades.length,
    confirmedTrades: trades.filter((t) => t.status === "CONFIRMED").length,
    pendingTrades: trades.filter((t) => t.status === "PENDING").length,
    failedTrades: trades.filter((t) => t.status === "FAILED").length,
    totalBuys: trades.filter((t) => t.inputMint === SOL_MINT && t.status === "CONFIRMED").length,
    totalSells: trades.filter((t) => t.outputMint === SOL_MINT && t.status === "CONFIRMED").length,
  };

  const formatAmount = (amount: string, decimals: number = 9) => {
    const num = Number(amount) / Math.pow(10, decimals);
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    if (num >= 1) return num.toFixed(4);
    return num.toFixed(6);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
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

      <main className="max-w-6xl mx-auto px-6 py-8 pt-24">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Portfolio</h1>
            <p className={`text-sm ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
              Track your positions and trading history
            </p>
          </div>
          <button
            onClick={() => { fetchTrades(true); fetchBalance(); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              isDark
                ? 'bg-white/5 hover:bg-white/10 border border-white/10 text-white'
                : 'bg-white hover:bg-gray-100 border border-gray-200 text-gray-900'
            }`}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {/* SOL Balance */}
          <div className={`p-4 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="h-4 w-4 text-[#FF6B4A]" />
              <span className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>SOL Balance</span>
            </div>
            <p className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {balanceLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                `${balance?.sol.uiBalance.toFixed(4) || "0.0000"}`
              )}
            </p>
          </div>

          {/* Total Trades */}
          <div className={`p-4 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              <History className="h-4 w-4 text-[#FF6B4A]" />
              <span className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Total Trades</span>
            </div>
            <p className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{stats.totalTrades}</p>
          </div>

          {/* Buys */}
          <div className={`p-4 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Buys</span>
            </div>
            <p className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{stats.totalBuys}</p>
          </div>

          {/* Sells */}
          <div className={`p-4 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="h-4 w-4 text-red-500" />
              <span className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Sells</span>
            </div>
            <p className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{stats.totalSells}</p>
          </div>
        </div>

        {/* Token Holdings */}
        {balance && balance.tokens.length > 0 && (
          <div className={`mb-8 p-4 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
            <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Token Holdings
            </h2>
            <div className="grid gap-3">
              {balance.tokens.map((token) => (
                <div
                  key={token.mint}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    isDark ? 'bg-black/30' : 'bg-gray-50'
                  }`}
                >
                  <div>
                    <p className={`font-mono text-sm ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
                      {token.mint.slice(0, 8)}...{token.mint.slice(-4)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {formatAmount(token.balance, token.decimals)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trade History */}
        <div className={`rounded-xl border overflow-hidden ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
          <div className={`p-4 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between">
              <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Trade History
              </h2>
              <div className="flex gap-2">
                {(["all", "CONFIRMED", "PENDING", "FAILED"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => { setFilter(f); setOffset(0); }}
                    className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                      filter === f
                        ? 'bg-[#FF6B4A] text-white'
                        : isDark
                          ? 'bg-white/5 text-white/60 hover:bg-white/10'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {f === "all" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading && trades.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[#FF6B4A]" />
            </div>
          ) : trades.length === 0 ? (
            <div className={`text-center py-12 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
              <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No trades yet</p>
              <p className="text-sm mt-1">Start trading to see your history here</p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-white/5">
                {trades.map((trade) => {
                  const isBuy = trade.inputMint === SOL_MINT;
                  return (
                    <div
                      key={trade.id}
                      className={`p-4 ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'} transition-colors`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${isBuy ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                            {isBuy ? (
                              <ArrowDownRight className="h-4 w-4 text-green-500" />
                            ) : (
                              <ArrowUpRight className="h-4 w-4 text-red-500" />
                            )}
                          </div>
                          <div>
                            <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                              {isBuy ? "Buy" : "Sell"} {isBuy ? trade.outputSymbol : trade.inputSymbol}
                            </p>
                            <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                              {formatDate(trade.createdAt)}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <p className={`font-mono text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
                            {formatAmount(trade.amountIn)} {trade.inputSymbol} → {formatAmount(trade.amountOut)} {trade.outputSymbol}
                          </p>
                          <div className="flex items-center justify-end gap-2 mt-1">
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                trade.status === "CONFIRMED"
                                  ? "bg-green-500/20 text-green-400"
                                  : trade.status === "PENDING"
                                  ? "bg-yellow-500/20 text-yellow-400"
                                  : "bg-red-500/20 text-red-400"
                              }`}
                            >
                              {trade.status.toLowerCase()}
                            </span>
                            {trade.explorerUrl && (
                              <a
                                href={trade.explorerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`text-xs flex items-center gap-1 ${
                                  isDark ? 'text-white/40 hover:text-white' : 'text-gray-500 hover:text-gray-900'
                                } transition-colors`}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                      {trade.errorMessage && (
                        <p className="mt-2 text-xs text-red-400 bg-red-500/10 p-2 rounded">
                          {trade.errorMessage}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {hasMore && (
                <div className={`p-4 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                  <button
                    onClick={() => fetchTrades(false)}
                    disabled={loading}
                    className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                      isDark
                        ? 'bg-white/5 hover:bg-white/10 text-white'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
                    }`}
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    ) : (
                      "Load More"
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
