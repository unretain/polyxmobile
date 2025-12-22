"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Copy,
  TrendingUp,
  TrendingDown,
  Globe,
  Twitter,
  RefreshCw,
} from "lucide-react";
import { formatPrice, formatNumber, formatPercent, shortenAddress, cn } from "@/lib/utils";
import { useTokenStore } from "@/stores/tokenStore";
import { usePulseStore, type OHLCV } from "@/stores/pulseStore";
import { useThemeStore } from "@/stores/themeStore";
import { Chart3D } from "@/components/charts/Chart3D";
import { Line3DChart } from "@/components/charts/Line3DChart";
import { ChartControls } from "@/components/charts/ChartControls";
import { type ChartType, LINE_PERIODS, CANDLE_PERIODS, PULSE_PERIOD } from "@/stores/chartStore";
import { BarChart3, LineChart } from "lucide-react";
import { SwapWidget } from "@/components/trading";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const PUMP_FUN_SUPPLY = 1_000_000_000;

// Token logo overrides - use local images for specific tokens
const TOKEN_LOGO_OVERRIDES: Record<string, string> = {
  "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn": "/pump-logo.jpg", // PUMP
};

// Get token logo URL with overrides
function getTokenLogoUrl(logoUri: string | undefined, tokenAddress: string): string | null {
  if (TOKEN_LOGO_OVERRIDES[tokenAddress]) {
    return TOKEN_LOGO_OVERRIDES[tokenAddress];
  }
  return logoUri || null;
}

// ============================================================================
// BIRDEYE API CONFIGS (for Dashboard tokens like ETH, SOL, etc.)
// Birdeye intervals: "1m" | "5m" | "15m" | "1h" | "4h" | "1d"
// ============================================================================
// LINE CHART: period = time range (how far back to show)
const BIRDEYE_LINE_CONFIG: Record<string, { interval: string; seconds: number }> = {
  "1m": { interval: "1m", seconds: 60 },          // 1 min candles for last 1 minute (will show 1 point)
  "15m": { interval: "1m", seconds: 900 },        // 1 min candles for last 15 minutes
  "1h": { interval: "1m", seconds: 3600 },        // 1 min candles for 1 hour
  "24h": { interval: "5m", seconds: 86400 },      // 5 min candles for 24 hours
  "7d": { interval: "1h", seconds: 86400 * 7 },   // 1 hour candles for 7 days
  "30d": { interval: "4h", seconds: 86400 * 30 }, // 4 hour candles for 30 days
  "3m": { interval: "1d", seconds: 86400 * 90 },  // 1 day candles for 3 months
  "1y": { interval: "1d", seconds: 86400 * 365 }, // 1 day candles for 1 year
  "5y": { interval: "1d", seconds: 86400 * 365 * 5 }, // 1 day candles for 5 years
};

const BIRDEYE_CANDLE_CONFIG: Record<string, { interval: string; seconds: number }> = {
  "1m": { interval: "1m", seconds: 7200 },        // 1 min candles, 2 hours of data
  "5m": { interval: "5m", seconds: 36000 },       // 5 min candles, 10 hours of data
  "15m": { interval: "15m", seconds: 86400 },     // 15 min candles, 24 hours of data
  "1h": { interval: "1h", seconds: 86400 * 5 },   // 1 hour candles, 5 days of data
  "4h": { interval: "4h", seconds: 86400 * 20 },  // 4 hour candles, 20 days of data
  "1d": { interval: "1d", seconds: 86400 * 180 }, // 1 day candles, 6 months of data
  "1w": { interval: "1d", seconds: 86400 * 365 * 2 }, // Daily candles aggregated (Birdeye doesn't support 1w directly)
  "1M": { interval: "1d", seconds: 86400 * 365 * 10 }, // Daily candles for 10 years (monthly aggregated)
};

// ============================================================================
// MORALIS API CONFIGS (for Pulse tokens - pump.fun memecoins)
// Moralis intervals: "1s" | "10s" | "30s" | "1min" | "5min" | "10min" | "30min" | "1h" | "4h" | "12h" | "1d" | "1w" | "1M"
// ============================================================================
// LINE CHART: period = time range (how far back to show)
const MORALIS_LINE_CONFIG: Record<string, { interval: string; seconds: number }> = {
  "1m": { interval: "1s", seconds: 60 },          // 1s candles for last 1 minute
  "15m": { interval: "1s", seconds: 900 },        // 1s candles for last 15 minutes
  "1h": { interval: "1min", seconds: 3600 },      // 1 min candles for 1 hour
  "24h": { interval: "5min", seconds: 86400 },    // 5 min candles for 24 hours
  "7d": { interval: "1h", seconds: 86400 * 7 },   // 1 hour candles for 7 days
  "30d": { interval: "4h", seconds: 86400 * 30 }, // 4 hour candles for 30 days
  "3m": { interval: "1d", seconds: 86400 * 90 },  // 1 day candles for 3 months
  "1y": { interval: "1d", seconds: 86400 * 365 }, // 1 day candles for 1 year
  "5y": { interval: "1w", seconds: 86400 * 365 * 5 }, // 1 week candles for 5 years
};

// CANDLESTICK CHART: period = candle interval (size of each candle)
const MORALIS_CANDLE_CONFIG: Record<string, { interval: string; seconds: number }> = {
  "1s": { interval: "1s", seconds: 0 },           // Per-trade candles (pump.fun style), fetch ALL
  "1m": { interval: "1min", seconds: 7200 },      // 1 min candles, 2 hours of data
  "5m": { interval: "5min", seconds: 36000 },     // 5 min candles, 10 hours of data
  "15m": { interval: "30min", seconds: 86400 },   // 30 min candles, 24 hours of data
  "1h": { interval: "1h", seconds: 86400 * 5 },   // 1 hour candles, 5 days of data
  "4h": { interval: "4h", seconds: 86400 * 20 },  // 4 hour candles, 20 days of data
  "1d": { interval: "1d", seconds: 86400 * 180 }, // 1 day candles, 6 months of data
  "1w": { interval: "1w", seconds: 86400 * 365 * 2 }, // 1 week candles, 2 years of data
};

// Get the appropriate config based on API source, chart type, and period
function getChartConfig(chartType: ChartType, period: string, isPulse: boolean) {
  if (isPulse) {
    // Pulse tokens use Moralis API
    if (chartType === "candle") {
      return MORALIS_CANDLE_CONFIG[period] || MORALIS_CANDLE_CONFIG["1m"];
    }
    return MORALIS_LINE_CONFIG[period] || MORALIS_LINE_CONFIG["24h"];
  } else {
    // Dashboard tokens use Birdeye API
    if (chartType === "candle") {
      return BIRDEYE_CANDLE_CONFIG[period] || BIRDEYE_CANDLE_CONFIG["1m"];
    }
    return BIRDEYE_LINE_CONFIG[period] || BIRDEYE_LINE_CONFIG["24h"];
  }
}

interface PulseTokenData {
  address: string;
  symbol: string;
  name: string;
  logoUri?: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  txCount: number;
  createdAt: number;
  source?: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  totalSupply?: number;
  maxSupply?: number;
  circulatingSupply?: number;
  complete?: boolean; // Whether bonding curve is complete (token graduated to Raydium)
}

// Trade type for trade history
interface Trade {
  txHash: string;
  timestamp: number;
  type: "buy" | "sell";
  wallet: string;
  tokenAmount: string;
  tokenAmountUsd: number;
  tokenSymbol?: string;
  otherAmount: string;
  otherSymbol: string;
  otherAmountUsd: number;
  priceUsd: number;
  totalValueUsd: number;
  exchangeName?: string;
}

// Holder stats type - matches Moralis API response
interface HolderChangeEntry {
  change: number;
  changePercent: number;
}

interface HolderStats {
  totalHolders: number;
  holderChange?: Record<string, HolderChangeEntry>;
  holdersByAcquisition?: {
    swap?: number;
    transfer?: number;
    airdrop?: number;
  };
  holderDistribution?: Record<string, number>;
}

interface TopHolder {
  address: string;
  balance: string;
  percentOfSupply: number;
  usdValue?: number;
}

// Format large numbers for display
function formatTokenAmount(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  if (num >= 1) return num.toFixed(2);
  return num.toFixed(6);
}

// Trades Table Component
function TradesTable({ trades, isLoading, symbol, isDark = true }: { trades: Trade[]; isLoading: boolean; symbol: string; isDark?: boolean }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className={`flex items-center justify-center h-48 text-sm ${isDark ? 'text-white/50' : 'text-black/50'}`}>
        No trades found
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className={`border-b text-left ${isDark ? 'border-white/10 text-white/50' : 'border-black/10 text-black/50'}`}>
            <th className="pb-2 pr-4 font-medium">Time</th>
            <th className="pb-2 pr-4 font-medium">Type</th>
            <th className="pb-2 pr-4 font-medium">Amount</th>
            <th className="pb-2 pr-4 font-medium">Price</th>
            <th className="pb-2 pr-4 font-medium">Value</th>
            <th className="pb-2 pr-4 font-medium">Wallet</th>
            <th className="pb-2 font-medium">Tx</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade, i) => (
            <tr key={trade.txHash + i} className={`border-b ${isDark ? 'border-white/5 hover:bg-white/5' : 'border-black/5 hover:bg-black/5'}`}>
              <td className={`py-2 pr-4 text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                {new Date(trade.timestamp).toLocaleTimeString()}
              </td>
              <td className="py-2 pr-4">
                <span className={cn(
                  "px-2 py-0.5 text-xs font-medium",
                  trade.type === "buy" ? "bg-up/20 text-up" : "bg-down/20 text-down"
                )}>
                  {trade.type.toUpperCase()}
                </span>
              </td>
              <td className="py-2 pr-4 font-mono text-xs">
                <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{formatTokenAmount(trade.tokenAmount || "0")}</span>
                <span className={`ml-1 ${isDark ? 'text-white/50' : 'text-black/50'}`}>{trade.tokenSymbol || symbol}</span>
              </td>
              <td className={`py-2 pr-4 font-mono text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                ${trade.priceUsd?.toFixed(8) || "—"}
              </td>
              <td className="py-2 pr-4 font-mono text-xs">
                <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>${trade.totalValueUsd?.toFixed(2) || "0.00"}</span>
                <span className={`ml-1 ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                  ({trade.otherAmount ? formatTokenAmount(trade.otherAmount) : "—"} {trade.otherSymbol || "SOL"})
                </span>
              </td>
              <td className="py-2 pr-4">
                <a
                  href={`https://solscan.io/account/${trade.wallet}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#FF6B4A] hover:underline font-mono text-xs"
                >
                  {shortenAddress(trade.wallet, 4)}
                </a>
              </td>
              <td className="py-2">
                <a
                  href={`https://solscan.io/tx/${trade.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={isDark ? 'text-white/50 hover:text-white' : 'text-black/50 hover:text-black'}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Holder Stats Sidebar Component
function HoldersSidebar({
  stats,
  topHolders,
  isLoading,
  isDark = true
}: {
  stats: HolderStats | null;
  topHolders: TopHolder[];
  isLoading: boolean;
  isDark?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Holder Stats */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDark ? 'text-white/50' : 'text-black/50'}`}>Total Holders</span>
          <span className={`font-bold text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>{stats?.totalHolders?.toLocaleString() || "—"}</span>
        </div>

        {stats?.holderChange && Object.keys(stats.holderChange).length > 0 && (
          <div className="space-y-2">
            <span className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>Holder Change</span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {stats.holderChange["1h"] && (
                <div className={`flex justify-between px-2 py-1 ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                  <span className={isDark ? 'text-white/50' : 'text-black/50'}>1h</span>
                  <span className={stats.holderChange["1h"].change >= 0 ? "text-up" : "text-down"}>
                    {stats.holderChange["1h"].change >= 0 ? "+" : ""}{stats.holderChange["1h"].change}
                  </span>
                </div>
              )}
              {stats.holderChange["24h"] && (
                <div className={`flex justify-between px-2 py-1 ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                  <span className={isDark ? 'text-white/50' : 'text-black/50'}>24h</span>
                  <span className={stats.holderChange["24h"].change >= 0 ? "text-up" : "text-down"}>
                    {stats.holderChange["24h"].change >= 0 ? "+" : ""}{stats.holderChange["24h"].change}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Top Holders */}
      {topHolders.length > 0 && (
        <div className="space-y-2">
          <h4 className={`text-sm font-medium ${isDark ? 'text-white/50' : 'text-black/50'}`}>Top Holders</h4>
          <div className="space-y-1">
            {topHolders.slice(0, 10).map((holder, i) => (
              <div key={holder.address} className={`flex items-center justify-between text-xs py-1.5 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-4 ${isDark ? 'text-white/50' : 'text-black/50'}`}>{i + 1}.</span>
                  <a
                    href={`https://solscan.io/account/${holder.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[#FF6B4A] hover:underline"
                  >
                    {shortenAddress(holder.address, 4)}
                  </a>
                </div>
                <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{holder.percentOfSupply?.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TokenPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { isDark } = useThemeStore();
  const address = params.address as string;
  const fromPulse = searchParams.get("source") === "pulse";
  const [pulseToken, setPulseToken] = useState<PulseTokenData | null>(null);
  const [pulseTokenLoading, setPulseTokenLoading] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [ohlcv, setOhlcv] = useState<OHLCV[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [holderStats, setHolderStats] = useState<HolderStats | null>(null);
  const [topHolders, setTopHolders] = useState<TopHolder[]>([]);
  const [holdersLoading, setHoldersLoading] = useState(false);
  const [chartType, setChartType] = useState<ChartType>("candle");
  const [chartPeriod, setChartPeriod] = useState("1s"); // Will be set by useEffect based on source
  const [supplyData, setSupplyData] = useState<{
    totalSupply: number | null;
    maxSupply: number | null;
    circulatingSupply: number | null;
  } | null>(null);
  // State for dashboard token data (from Birdeye API)
  const [dashboardToken, setDashboardToken] = useState<PulseTokenData | null>(null);
  const [dashboardTokenLoading, setDashboardTokenLoading] = useState(false);
  const ohlcvIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const tradesIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const tokenDataIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Set chart defaults based on source (Pulse = 1s real-time, Dashboard = 24h)
  useEffect(() => {
    if (fromPulse) {
      setChartPeriod("1s");
      setChartType("candle");
    } else {
      setChartPeriod("24h");
    }
  }, [fromPulse]);

  const { tokens, fetchTokens } = useTokenStore();
  const { getTokenByAddress, fetchTokenOHLCV } = usePulseStore();

  const storeToken = useMemo(
    () => tokens.find((t) => t.address === address),
    [tokens, address]
  );

  const cachedPulseToken = useMemo(
    () => (hasMounted ? getTokenByAddress(address) : undefined),
    [getTokenByAddress, address, hasMounted]
  );

  // For Pulse tokens: ALWAYS prefer freshly fetched pulseToken (from API) over cached data
  // Cached data (storeToken, cachedPulseToken) may have stale prices/market cap
  // For Dashboard tokens: ALWAYS prefer dashboardToken (fresh Birdeye data) over storeToken (stale DB data)
  const token = fromPulse
    ? (pulseToken || storeToken || cachedPulseToken)
    : (dashboardToken || storeToken);

  // Fetch dashboard token from Birdeye API (for non-pulse tokens)
  // ALWAYS fetch fresh data - don't skip if storeToken exists (it has stale DB data)
  const fetchDashboardToken = useCallback(async () => {
    if (dashboardTokenLoading || dashboardToken) return;

    setDashboardTokenLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/tokens/${address}`);
      if (response.ok) {
        const data = await response.json();
        // Map Birdeye token data to PulseTokenData format
        setDashboardToken({
          address: data.address,
          symbol: data.symbol,
          name: data.name,
          logoUri: data.logoUri,
          price: data.price || 0,
          priceChange24h: data.priceChange24h || 0,
          volume24h: data.volume24h || 0,
          liquidity: data.liquidity || 0,
          marketCap: data.marketCap || 0,
          txCount: 0,
          createdAt: data.createdAt ? new Date(data.createdAt).getTime() : Date.now(),
        });
      }
    } catch (error) {
      console.error("Failed to fetch dashboard token:", error);
    } finally {
      setDashboardTokenLoading(false);
    }
  }, [address, dashboardTokenLoading, dashboardToken]);

  // Fetch pulse token from Pulse API (for pump.fun tokens)
  // Called on initial load and periodically for real-time price/market cap updates
  const fetchPulseToken = useCallback(async (isPolling = false) => {
    // Only block concurrent fetches on initial load, not polling
    if (!isPolling && pulseTokenLoading) return;

    if (!isPolling) setPulseTokenLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/pulse/token/${address}`);
      if (response.ok) {
        const data = await response.json();
        setPulseToken(data);
      }
    } catch (error) {
      console.error("Failed to fetch pulse token:", error);
    } finally {
      if (!isPolling) setPulseTokenLoading(false);
    }
  }, [address, pulseTokenLoading]);

  useEffect(() => {
    if (tokens.length === 0) {
      fetchTokens();
    }
  }, [tokens.length, fetchTokens]);

  // Fetch token data based on source with periodic polling for real-time updates
  useEffect(() => {
    if (!address) return;

    if (fromPulse) {
      // For Pulse tokens, fetch immediately and poll every 1 second for real-time trading
      fetchPulseToken(false);
      tokenDataIntervalRef.current = setInterval(() => fetchPulseToken(true), 1000);
    } else {
      // For Dashboard tokens, fetch fresh data from Birdeye API (no polling needed)
      fetchDashboardToken();
    }

    return () => {
      if (tokenDataIntervalRef.current) {
        clearInterval(tokenDataIntervalRef.current);
        tokenDataIntervalRef.current = null;
      }
    };
  }, [address, fromPulse]); // Note: intentionally exclude fetchPulseToken/fetchDashboardToken to avoid infinite loops

  // Fetch supply data for dashboard tokens only (from CoinGecko)
  useEffect(() => {
    if (!address || fromPulse) return;

    const fetchSupply = async () => {
      try {
        const response = await fetch(`${API_URL}/api/tokens/${address}/supply`);
        if (response.ok) {
          const data = await response.json();
          setSupplyData(data);
        }
      } catch (err) {
        console.error("Failed to fetch supply data:", err);
      }
    };

    fetchSupply();
  }, [address, fromPulse]);

  // Fetch OHLCV data based on chart type and period
  // CRITICAL: Dashboard tokens use Birdeye API, Pulse tokens use Moralis API
  // IMPORTANT: Never overwrite existing data with empty array (prevents chart crashes)
  useEffect(() => {
    if (!address) return;

    const config = getChartConfig(chartType, chartPeriod, fromPulse);
    let isInitialFetch = true;

    const fetchOhlcv = async () => {
      try {
        // Calculate time range
        const now = Math.floor(Date.now() / 1000);
        const fromDate = now - config.seconds;

        let response;
        let ohlcvData: OHLCV[] = [];

        if (fromPulse) {
          // PULSE TOKENS: Use Moralis API via /api/pulse/ohlcv
          response = await fetch(
            `${API_URL}/api/pulse/ohlcv/${address}?timeframe=${config.interval}&fromDate=${fromDate}&toDate=${now}`
          );

          if (!response.ok) {
            throw new Error(`Pulse API error: ${response.status}`);
          }

          const result = await response.json();
          ohlcvData = result.data || [];
        } else {
          // DASHBOARD TOKENS: Use Birdeye API via /api/tokens/:address/ohlcv
          // Birdeye has proper OHLCV data with correct price continuity
          response = await fetch(
            `${API_URL}/api/tokens/${address}/ohlcv?timeframe=${config.interval}&from=${fromDate}&to=${now}&limit=500`
          );

          if (!response.ok) {
            throw new Error(`Tokens API error: ${response.status}`);
          }

          // Birdeye returns array directly, not wrapped in {data: [...]}
          ohlcvData = await response.json();
        }

        // CRITICAL: Only update state if we got valid data
        // Never overwrite existing data with empty array (causes chart crash!)
        if (ohlcvData.length > 0) {
          setOhlcv(ohlcvData);
        } else if (isInitialFetch) {
          // Only set empty on initial fetch if there's truly no data
          setOhlcv([]);
        }
        // If polling returns empty but we have existing data, keep the existing data

        setChartLoading(false);
        isInitialFetch = false;
      } catch (err) {
        console.error("Failed to fetch OHLCV:", err);
        // On error, don't clear existing data - just stop loading
        setChartLoading(false);
        isInitialFetch = false;
      }
    };

    setChartLoading(true);
    fetchOhlcv();

    // Poll interval depends on timeframe:
    // - 1s real-time: poll every 2 seconds (reduced from 1s to prevent race conditions)
    // - Short timeframes (1min-15min): poll every 5 seconds
    // - Longer timeframes: poll every 15 seconds
    const pollInterval = chartPeriod === "1s" ? 2000 :
                         ["1m", "5m", "15m", "1h"].includes(chartPeriod) ? 5000 : 15000;
    ohlcvIntervalRef.current = setInterval(fetchOhlcv, pollInterval);

    return () => {
      if (ohlcvIntervalRef.current) clearInterval(ohlcvIntervalRef.current);
    };
  }, [address, chartType, chartPeriod, fromPulse]);

  // Fetch trades
  useEffect(() => {
    if (!address) return;

    const fetchTrades = async () => {
      try {
        const response = await fetch(`${API_URL}/api/pulse/trades/${address}?limit=50`);
        if (response.ok) {
          const data = await response.json();
          setTrades(data.trades || []);
        }
        setTradesLoading(false);
      } catch (err) {
        console.error("Failed to fetch trades:", err);
        setTradesLoading(false);
      }
    };

    setTradesLoading(true);
    fetchTrades();
    tradesIntervalRef.current = setInterval(fetchTrades, 10000);

    return () => {
      if (tradesIntervalRef.current) clearInterval(tradesIntervalRef.current);
    };
  }, [address]);

  // Fetch holder stats
  useEffect(() => {
    if (!address) return;

    const fetchHolders = async () => {
      try {
        const response = await fetch(`${API_URL}/api/pulse/holders/${address}`);
        if (response.ok) {
          const data = await response.json();
          setHolderStats(data.stats || null);
          setTopHolders(data.topHolders || []);
        }
        setHoldersLoading(false);
      } catch (err) {
        console.error("Failed to fetch holders:", err);
        setHoldersLoading(false);
      }
    };

    setHoldersLoading(true);
    fetchHolders();
  }, [address]);

  const [copied, setCopied] = useState(false);

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = address;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isPositive = (token?.priceChange24h ?? 0) >= 0;

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {/* Header */}
      <div className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between flex-shrink-0 px-3 md:px-4 py-3 backdrop-blur-md border ${
        isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
      }`}>
        <div className="flex items-start gap-3 md:gap-4">
          <Link
            href={fromPulse ? "/pulse" : "/dashboard"}
            className={`p-1.5 md:p-2 transition-colors ${isDark ? 'hover:bg-white/10 text-white' : 'hover:bg-black/10 text-black'}`}
          >
            <ArrowLeft className="h-4 w-4 md:h-5 md:w-5" />
          </Link>

          <div className="flex items-center gap-3 md:gap-4">
            <div className={`relative h-10 w-10 md:h-12 md:w-12 overflow-hidden rounded-full ring-2 ${
              isDark ? 'bg-white/5 ring-white/10' : 'bg-black/5 ring-black/10'
            }`}>
              {getTokenLogoUrl(token?.logoUri, address) ? (
                <Image
                  src={getTokenLogoUrl(token?.logoUri, address)!}
                  alt={token?.symbol || "Token"}
                  fill
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className={`flex h-full w-full items-center justify-center text-lg md:text-xl font-bold bg-gradient-to-br from-[#FF6B4A]/20 ${
                  isDark ? 'to-white/5 text-white/40' : 'to-black/5 text-black/40'
                }`}>
                  {token?.symbol?.charAt(0) ?? "?"}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-1.5 md:gap-2 flex-wrap">
                <h1 className={`text-lg md:text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{token?.symbol ?? "Loading..."}</h1>
                <span className={`hidden md:inline px-2 py-0.5 text-xs ${isDark ? 'bg-white/10 text-white/60' : 'bg-black/10 text-black/60'}`}>
                  {token?.name}
                </span>
                {fromPulse && (
                  <span className="bg-[#FF6B4A]/20 text-[#FF6B4A] px-1.5 md:px-2 py-0.5 text-[10px] md:text-xs font-medium">
                    Pulse
                  </span>
                )}
              </div>

              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleCopyAddress}
                  className={`flex items-center gap-1 text-[10px] md:text-xs transition-colors ${
                    copied ? 'text-[#00ffa3]' : isDark ? 'text-white/50 hover:text-white' : 'text-black/50 hover:text-black'
                  }`}
                >
                  {copied ? "Copied!" : shortenAddress(address, 4)}
                  <Copy className="h-3 w-3" />
                </button>

                <a
                  href={`https://solscan.io/token/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`hidden md:flex items-center gap-1 text-xs transition-colors ${
                    isDark ? 'text-white/50 hover:text-white' : 'text-black/50 hover:text-black'
                  }`}
                >
                  Solscan <ExternalLink className="h-3 w-3" />
                </a>

                <a
                  href={`https://pump.fun/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`hidden md:flex items-center gap-1 text-xs transition-colors ${
                    isDark ? 'text-white/50 hover:text-white' : 'text-black/50 hover:text-black'
                  }`}
                >
                  pump.fun <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-2">
          {token?.website && (
            <a
              href={token.website.startsWith("http") ? token.website : `https://${token.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`p-2 transition-colors ${isDark ? 'text-white/50 hover:bg-white/10 hover:text-white' : 'text-black/50 hover:bg-black/10 hover:text-black'}`}
              title="Website"
            >
              <Globe className="h-5 w-5" />
            </a>
          )}
          {token?.twitter && (
            <a
              href={token.twitter.startsWith("http") ? token.twitter : `https://twitter.com/${token.twitter.replace("@", "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`p-2 transition-colors ${isDark ? 'text-white/50 hover:bg-white/10 hover:text-white' : 'text-black/50 hover:bg-black/10 hover:text-black'}`}
              title="Twitter"
            >
              <Twitter className="h-5 w-5" />
            </a>
          )}
          {!token?.website && !token?.twitter && (
            <span className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>No social links</span>
          )}
        </div>
      </div>

      {/* Main Content: Chart + Sidebar */}
      <div className="flex-1 flex flex-col md:flex-row gap-3 md:gap-4 min-h-0 overflow-y-auto md:overflow-hidden px-3 md:px-0">
        {/* Left: Chart + Trades */}
        <div className="flex-1 flex flex-col gap-3 md:gap-4 min-w-0 overflow-visible md:overflow-hidden">
          {/* Stats Row */}
          <div className="grid gap-2 md:gap-3 grid-cols-2 md:grid-cols-4 flex-shrink-0">
            <div className={`border backdrop-blur-md p-3 ${isDark ? 'border-white/10 bg-white/5' : 'border-black/10 bg-black/5'}`}>
              <p className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>Price</p>
              <p className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>${formatPrice(token?.price ?? 0)}</p>
              <div className={cn("flex items-center gap-1 text-xs font-medium", isPositive ? "text-up" : "text-down")}>
                {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {formatPercent(token?.priceChange24h ?? 0)}
              </div>
            </div>

            <div className={`border backdrop-blur-md p-3 ${isDark ? 'border-white/10 bg-white/5' : 'border-black/10 bg-black/5'}`}>
              <p className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>Market Cap</p>
              <p className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>${formatNumber(token?.marketCap ?? 0)}</p>
            </div>

            <div className={`border backdrop-blur-md p-3 ${isDark ? 'border-white/10 bg-white/5' : 'border-black/10 bg-black/5'}`}>
              <p className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>24h Volume</p>
              <p className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>${formatNumber(token?.volume24h ?? 0)}</p>
            </div>

            <div className={`border backdrop-blur-md p-3 ${isDark ? 'border-white/10 bg-white/5' : 'border-black/10 bg-black/5'}`}>
              <p className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>Liquidity</p>
              <p className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>${formatNumber(token?.liquidity ?? 0)}</p>
            </div>
          </div>

          {/* Chart Controls */}
          <div className="flex items-center justify-between gap-2 md:gap-4 flex-shrink-0 overflow-x-auto">
            {/* Chart Type Toggle */}
            <div className={`flex items-center gap-0.5 md:gap-1 border p-0.5 md:p-1 flex-shrink-0 ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
              <button
                onClick={() => {
                  setChartType("line");
                  // Reset to default line chart period (line chart doesn't have 1s)
                  if (chartPeriod === "1s") {
                    setChartPeriod("15m"); // Default for line chart
                  }
                }}
                className={cn(
                  "flex items-center gap-1 md:gap-1.5 px-2 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium transition-colors",
                  chartType === "line"
                    ? "bg-[#FF6B4A] text-white"
                    : isDark ? "text-white/60 hover:text-white" : "text-black/60 hover:text-black"
                )}
              >
                <LineChart className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden md:inline">Line</span>
              </button>
              <button
                onClick={() => {
                  setChartType("candle");
                  // For Pulse tokens on candlestick, default to 1s (per-trade)
                  if (fromPulse && (chartPeriod === "15m" || chartPeriod === "30d" || chartPeriod === "all")) {
                    setChartPeriod("1s");
                  }
                }}
                className={cn(
                  "flex items-center gap-1 md:gap-1.5 px-2 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium transition-colors",
                  chartType === "candle"
                    ? "bg-[#FF6B4A] text-white"
                    : isDark ? "text-white/60 hover:text-white" : "text-black/60 hover:text-black"
                )}
              >
                <BarChart3 className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden md:inline">Candle</span>
              </button>
            </div>

            {/* Period/Timeframe Controls */}
            <ChartControls
              period={chartPeriod}
              chartType={chartType}
              onPeriodChange={setChartPeriod}
              showPulseOption={fromPulse}
            />
          </div>

          {/* 3D Chart */}
          {/* Pass actual token price to ensure chart header shows correct current price */}
          <div className={`flex-shrink-0 h-[300px] md:h-[400px] border overflow-hidden ${isDark ? 'border-white/10' : 'border-black/10'}`}>
            {chartType === "line" ? (
              <Line3DChart
                data={ohlcv}
                isLoading={chartLoading && ohlcv.length === 0}
                showMarketCap={fromPulse}
                marketCap={token?.marketCap}
                price={token?.price}
              />
            ) : (
              <Chart3D
                data={ohlcv}
                isLoading={chartLoading && ohlcv.length === 0}
                showMarketCap={fromPulse}
                marketCap={token?.marketCap}
                price={token?.price}
              />
            )}
          </div>

          {/* Pulse tokens: Show Trades Table | Dashboard tokens: Show Market Stats */}
          {/* Hide trades table on mobile for pulse tokens */}
          {fromPulse ? (
            <div className={`hidden md:flex flex-1 min-h-0 border backdrop-blur-md p-4 overflow-hidden flex-col ${
              isDark ? 'border-white/10 bg-white/5' : 'border-black/10 bg-black/5'
            }`}>
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Recent Trades</h3>
                <span className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>{trades.length} trades</span>
              </div>
              <div className="flex-1 overflow-auto">
                <TradesTable trades={trades} isLoading={tradesLoading} symbol={token?.symbol || "TOKEN"} isDark={isDark} />
              </div>
            </div>
          ) : (
            <div className={`hidden md:block flex-1 min-h-0 border backdrop-blur-md p-4 overflow-hidden ${
              isDark ? 'border-white/10 bg-white/5' : 'border-black/10 bg-black/5'
            }`}>
              <h3 className={`font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>Market Statistics</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>Market Cap</p>
                  <p className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>${formatNumber(token?.marketCap ?? 0)}</p>
                  <div className={cn("flex items-center gap-1 text-xs font-medium", isPositive ? "text-up" : "text-down")}>
                    {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {formatPercent(token?.priceChange24h ?? 0)}
                  </div>
                </div>

                <div className="space-y-1">
                  <p className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>Volume (24h)</p>
                  <p className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>${formatNumber(token?.volume24h ?? 0)}</p>
                  <div className={cn("flex items-center gap-1 text-xs font-medium", isPositive ? "text-up" : "text-down")}>
                    {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {formatPercent(token?.priceChange24h ?? 0)}
                  </div>
                </div>

                <div className="space-y-1">
                  <p className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>Fully Diluted Valuation</p>
                  <p className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    ${formatNumber(
                      supplyData?.totalSupply && token?.price
                        ? token.price * supplyData.totalSupply
                        : token?.marketCap ?? 0
                    )}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>Vol/Mkt Cap (24h)</p>
                  <p className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {token?.marketCap && token?.volume24h
                      ? ((token.volume24h / token.marketCap) * 100).toFixed(2) + "%"
                      : "N/A"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Pulse tokens: Show Swap Widget + Holder Stats | Dashboard tokens: Show Supply Stats */}
        {fromPulse ? (
          <div className={`w-full md:w-80 flex-shrink-0 flex flex-col gap-4 overflow-visible md:overflow-auto`}>
            {/* Swap Widget - Compact on mobile */}
            <div className="hidden md:block">
              <SwapWidget
                defaultOutputMint={address}
                outputSymbol={token?.symbol || "TOKEN"}
                outputDecimals={6}
                isGraduated={(token as PulseTokenData)?.complete !== false}
              />
            </div>
            {/* Mobile Swap Widget - Compact version */}
            <div className="block md:hidden">
              <SwapWidget
                defaultOutputMint={address}
                outputSymbol={token?.symbol || "TOKEN"}
                outputDecimals={6}
                isGraduated={(token as PulseTokenData)?.complete !== false}
                compactMobile={true}
              />
            </div>

            {/* Holder Stats - hidden on mobile */}
            <div className={`hidden md:block border backdrop-blur-md p-4 ${
              isDark ? 'border-white/10 bg-white/5' : 'border-black/10 bg-black/5'
            }`}>
              <h3 className={`font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>Holder Stats</h3>
              <HoldersSidebar stats={holderStats} topHolders={topHolders} isLoading={holdersLoading} isDark={isDark} />
            </div>
          </div>
        ) : (
          <div className={`hidden md:block w-64 flex-shrink-0 border backdrop-blur-md p-4 overflow-auto ${
            isDark ? 'border-white/10 bg-white/5' : 'border-black/10 bg-black/5'
          }`}>
            <h3 className={`font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>Supply Info</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <p className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>Total Supply</p>
                <p className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {supplyData?.totalSupply ? formatNumber(supplyData.totalSupply) : "N/A"}
                </p>
              </div>

              <div className="space-y-1">
                <p className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>Max Supply</p>
                <p className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {supplyData?.maxSupply ? formatNumber(supplyData.maxSupply) : "No Cap"}
                </p>
              </div>

              <div className="space-y-1">
                <p className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>Circulating Supply</p>
                <p className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {supplyData?.circulatingSupply ? formatNumber(supplyData.circulatingSupply) : "N/A"}
                </p>
                {supplyData?.totalSupply && supplyData.totalSupply > 0 && supplyData.circulatingSupply && (
                  <div className="mt-2">
                    <div className={`h-2 w-full ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
                      <div
                        className="h-full bg-[#FF6B4A]"
                        style={{
                          width: `${Math.min(100, (supplyData.circulatingSupply / supplyData.totalSupply) * 100)}%`
                        }}
                      />
                    </div>
                    <p className={`mt-1 text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                      {((supplyData.circulatingSupply / supplyData.totalSupply) * 100).toFixed(1)}% of total
                    </p>
                  </div>
                )}
              </div>

              <div className={`border-t pt-4 space-y-1 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                <p className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>DEX Liquidity</p>
                <p className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>${formatNumber(token?.liquidity ?? 0)}</p>
                <p className={`text-[10px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>Solana DEX pools</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
