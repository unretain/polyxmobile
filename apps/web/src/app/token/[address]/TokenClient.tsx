"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { useDemoStore } from "@/stores/demoStore";
import { useTradeLogStore } from "@/stores/tradeLogStore";
import { useParams, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
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
import { ChartControls } from "@/components/charts/ChartControls";

// Dynamic imports for heavy chart components
const Chart3D = dynamic(
  () => import("@/components/charts/Chart3D").then((mod) => mod.Chart3D),
  { ssr: false, loading: () => <ChartLoadingSpinner /> }
);
const Line3DChart = dynamic(
  () => import("@/components/charts/Line3DChart").then((mod) => mod.Line3DChart),
  { ssr: false, loading: () => <ChartLoadingSpinner /> }
);
const KLineChart = dynamic(
  () => import("@/components/charts/KLineChart").then((mod) => mod.KLineChart),
  { ssr: false, loading: () => <ChartLoadingSpinner /> }
);

function ChartLoadingSpinner() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-black/20">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
    </div>
  );
}
import { type ChartType, LINE_PERIODS, CANDLE_PERIODS, PULSE_PERIOD } from "@/stores/chartStore";
import { BarChart3, LineChart } from "lucide-react";
import { SwapWidget } from "@/components/trading";
import { Socket } from "socket.io-client";
import { ensureRealtimeSocket } from "@/stores/pulseStore";
// API calls go through Next.js proxy routes (protects internal API key)
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
  "1m": { interval: "1m", seconds: 86400 * 7 },       // 1 min candles, 7 days of data (max ~10080 candles)
  "5m": { interval: "5m", seconds: 86400 * 30 },      // 5 min candles, 30 days of data
  "15m": { interval: "15m", seconds: 86400 * 90 },    // 15 min candles, 90 days of data
  "1h": { interval: "1h", seconds: 86400 * 365 * 2 }, // 1 hour candles, 2 years of data
  "4h": { interval: "4h", seconds: 86400 * 365 * 3 }, // 4 hour candles, 3 years of data
  "1d": { interval: "1d", seconds: 86400 * 365 * 5 }, // 1 day candles, 5 years of data
  "1w": { interval: "1w", seconds: 86400 * 365 * 10 }, // Weekly candles from DB cache (10 years)
  "1M": { interval: "1M", seconds: 86400 * 365 * 10 }, // Monthly candles from DB cache (10 years)
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
// Backend fetches ALL data from DB - frontend just maps intervals
// The 'seconds' value is unused but kept for compatibility
const MORALIS_CANDLE_CONFIG: Record<string, { interval: string; seconds: number }> = {
  "1s": { interval: "1s", seconds: 0 },       // 250ms fine candles (server maps "1s" -> 250ms)
  "5s": { interval: "5s", seconds: 0 },
  "15s": { interval: "15s", seconds: 0 },
  "30s": { interval: "30s", seconds: 0 },
  "1m": { interval: "1min", seconds: 0 },     // 1 minute candles
  "5m": { interval: "5min", seconds: 0 },     // 5 minute candles
  "15m": { interval: "15min", seconds: 0 },   // 15 minute candles
  "1h": { interval: "1h", seconds: 0 },       // 1 hour candles
  "4h": { interval: "4h", seconds: 0 },       // 4 hour candles
  "1d": { interval: "1d", seconds: 0 },       // 1 day candles
  "1w": { interval: "1w", seconds: 0 },       // 1 week candles
  "1M": { interval: "1M", seconds: 0 },       // 1 month candles
};

// Get the appropriate config based on API source, chart type, and period
// Candle bucket size per timeframe — used to tick the live candle from trades.
const CANDLE_INTERVAL_MS: Record<string, number> = {
  // "1s" builds 250ms candles (4/sec) to match the server's fine tier, so trades
  // spread into thin distinct candles like Axiom instead of chunky 1s blocks.
  "1s": 250, "5s": 5000, "15s": 15000, "30s": 30000,
  "1m": 60000, "5m": 300000, "15m": 900000,
  "1h": 3600000, "4h": 14400000, "1d": 86400000, "1w": 604800000, "1M": 2592000000,
};

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
  marketCapSol?: number;
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
  destination?: string; // "pump" (on curve) | "pumpswap" (graduated to AMM)
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

export default function TokenClient() {
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
  const userWallet = useMobileWalletStore((s) => s.wallet?.publicKey);
  const isDemo = useDemoStore((s) => s.isDemo);
  const demoTrades = useDemoStore((s) => s.trades);
  const loggedTrades = useTradeLogStore((s) => s.trades);
  // The user's OWN buys/sells on this coin → B/S bubbles on the chart (Axiom-style).
  // In demo mode the paper trades live in the demo store; otherwise match the real
  // trade feed by the local wallet's pubkey.
  // Volume-weighted average entry and exit, drawn as horizontal lines on the chart.
  // Weighted by TOKEN amount, not trade count, so one big fill moves the line more
  // than several dust fills — that is what an average cost basis means.
  //
  // The log stores SOL in/out and the token amount, so price is solAmount/tokenAmount.
  // The chart's y-axis is market cap in USD, so the level is that price converted to
  // USD (solRateRef) and multiplied by supply.
  const { avgEntry, avgExit } = useMemo(() => {
    const source = isDemo
      ? demoTrades.filter((t) => t.mint === address)
      : loggedTrades.filter((t) => t.mint === address && (!userWallet || t.wallet === userWallet));

    const rate = solRateRef.current || 0;
    const supply = PUMP_FUN_SUPPLY;
    const avg = (side: "buy" | "sell") => {
      let sol = 0;
      let tokens = 0;
      for (const t of source) {
        if (t.side !== side) continue;
        if (!(t.tokenAmount > 0) || !(t.solAmount > 0)) continue;
        sol += t.solAmount;
        tokens += t.tokenAmount;
      }
      if (tokens <= 0 || rate <= 0) return null;
      return (sol / tokens) * rate * supply;
    };
    return { avgEntry: avg("buy"), avgExit: avg("sell") };
  }, [isDemo, demoTrades, loggedTrades, address, userWallet, ohlcv]);

  const userTradeMarkers = useMemo(() => {
    if (isDemo) {
      return demoTrades
        .filter((t) => t.mint === address)
        .map((t) => ({ time: Math.floor(t.ts / 1000), type: t.side as "buy" | "sell" }));
    }
    // Real wallet: locally-logged trades are the reliable source (the shared feed's
    // trader field is often empty). Merge any feed trades that DO match, deduped.
    const local = loggedTrades
      .filter((t) => t.mint === address && (!userWallet || t.wallet === userWallet))
      .map((t) => ({ time: Math.floor(t.ts / 1000), type: t.side as "buy" | "sell" }));
    const feed = userWallet
      ? trades
          .filter((t) => t.wallet === userWallet)
          .map((t) => ({ time: Math.floor(t.timestamp / 1000), type: t.type as "buy" | "sell" }))
      : [];
    const seen = new Set<string>();
    return [...local, ...feed].filter((m) => {
      const k = `${m.time}:${m.type}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [isDemo, demoTrades, address, trades, userWallet, loggedTrades]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [chartType, setChartType] = useState<ChartType>("candle");
  const [chartPeriod, setChartPeriod] = useState<string | null>(null); // Loaded from localStorage
  const [chartMode, setChartMode] = useState<"3d" | "2d">("3d"); // 3D or 2D chart rendering
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
  const socketRef = useRef<Socket | null>(null);
  // Real USD-per-SOL rate, derived from the token snapshot (the API computes it with
  // the live SOL price). Cached so the socket trade handler never falls back to 200.
  const solRateRef = useRef<number | null>(null);
  useEffect(() => {
    const p = pulseToken as any;
    if (!p) return;
    const rate = p.marketCapSol > 0 ? p.marketCap / p.marketCapSol
               : (p.priceSol > 0 ? p.price / p.priceSol : 0);
    if (rate && isFinite(rate) && rate > 0) solRateRef.current = rate;
  }, [pulseToken]);

  // Current timeframe as a ref so the live socket handlers can read it WITHOUT the
  // socket effect depending on chartPeriod — otherwise every timeframe switch tears
  // down and reopens the WebSocket, and each fresh connection is another chance to
  // hit a reset. The connection should live as long as the coin is open.
  const chartPeriodRef = useRef<string | null>(null);
  useEffect(() => { chartPeriodRef.current = chartPeriod; }, [chartPeriod]);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  // LIVE: WebSocket subscription for real-time trades and OHLCV (Pulse tokens only)
  useEffect(() => {
    if (!address || !fromPulse) return;

    // Reuse the ONE shared realtime socket (the same connection the pulse feed uses)
    // instead of opening a second one. New connection handshakes to the box get reset;
    // an already-established WebSocket survives — so piggybacking on it is what keeps
    // the chart live-updating on client-side navigation (not just on a full reload).
    const socket = ensureRealtimeSocket();
    socketRef.current = socket;

    const subscribe = () => {
      console.log(`🔌 Subscribing to live trades for token ${address.slice(0, 8)}...`);
      socket.emit("subscribe:token", { address });
    };
    // If the shared socket is already connected (the common navigation case), the
    // "connect" event won't fire again — subscribe right now.
    if (socket.connected) subscribe();
    socket.on("connect", subscribe);

    // LIVE: Handle real-time trade events. A hyped final-stretch / migrated coin fires
    // 50-100 trades/sec; doing a React render per trade blocks the main thread, the
    // socket misses its heartbeat, and the server drops it (that was the disconnect).
    // So buffer EVERY trade and flush the whole batch once per animation frame — nothing
    // is dropped, and there's one render per frame no matter how fast the trades come.
    type TradeMsg = { mint: string; type: string; tokenAmount: number; solAmount: number; marketCapSol: number; marketCap?: number; priceUsd?: number; solPrice?: number; volume24h?: number; liquidity?: number; trader: string; signature: string; timestamp: number };
    const pendingTrades: TradeMsg[] = [];
    let flushRaf: number | null = null;

    const processTrade = (data: TradeMsg) => {
      // Add new trade to the top of the list. Use the REAL SOL price the API sent
      // (fall back to 200 only if an old build omits it) — hardcoding it made the
      // market cap flicker to the wrong multiple on every trade.
      const rate = data.solPrice || solRateRef.current || 0;
      const solPrice = rate || 200; // last resort, only for a single trade row's USD
      const priceUsd = data.priceUsd ?? (data.tokenAmount > 0 ? (data.solAmount * solPrice) / data.tokenAmount : 0);
      const totalValueUsd = data.solAmount * solPrice;

      const newTrade: Trade = {
        txHash: data.signature,
        timestamp: data.timestamp,
        type: data.type as "buy" | "sell",
        wallet: data.trader,
        tokenAmount: data.tokenAmount.toString(),
        tokenAmountUsd: totalValueUsd,
        otherAmount: data.solAmount.toString(),
        otherSymbol: "SOL",
        otherAmountUsd: totalValueUsd,
        priceUsd: priceUsd,
        totalValueUsd: totalValueUsd,
      };

      setTrades((prev) => [newTrade, ...prev].slice(0, 50));

      // Update token market cap using functional update to avoid stale closure.
      // Prefer the USD value the API computed with the live SOL price.
      // Only update with a POSITIVE value — a bad feed trade can emit marketCap:0
      // (?? doesn't catch 0), which would nuke the displayed cap to $0. Ignore those
      // and keep the last good number instead.
      const feedMc = (data.marketCap && data.marketCap > 0)
        ? data.marketCap
        : (rate > 0 && data.marketCapSol > 0 ? data.marketCapSol * rate : null);
      if (feedMc && feedMc > 0) {
        setPulseToken((prev) => prev ? {
          ...prev,
          marketCap: feedMc,
          // Live volume + liquidity from the feed (only overwrite with real values).
          volume24h: (data.volume24h && data.volume24h > 0) ? data.volume24h : prev.volume24h,
          liquidity: (data.liquidity && data.liquidity > 0) ? data.liquidity : prev.liquidity,
        } : null);
      }

      // LIVE chart: tick the current candle from this trade. The feed emits no
      // ohlcv:update, so we build the live candle from the trade stream — works
      // on every timeframe with no polling.
      // The fetched candles are in USD price (chart renders close * supply as the
      // dollar market cap), so the live tick MUST use the USD price too. Using
      // priceSol (solAmount/tokenAmount) is ~73x smaller and collapses/freezes the
      // candle. priceUsd was already computed above from data.priceUsd.
      if (data.tokenAmount > 0 && data.solAmount > 0 && priceUsd > 0) {
        const intervalMs = CANDLE_INTERVAL_MS[chartPeriodRef.current || "1s"] || 250;
        // Bucket by RECEIVE time to match the server's receive-time fine candles,
        // so live ticks line up with the fetched history and give sub-second detail.
        const ts = Date.now();
        const bucket = Math.floor(ts / intervalMs) * intervalMs;
        setOhlcv((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          // Reject absurd ticks (a bad trade > 20x or < 5% of the last close) so a
          // single garbage event can't spike or nuke the candle. Same units now (USD).
          if (last.close > 0 && (priceUsd > last.close * 20 || priceUsd < last.close * 0.05)) return prev;
          // A newer 1s bucket → open a fresh candle. Otherwise (same bucket OR a
          // few seconds of block-time jitter, common with PROCESSED commitment)
          // update the current live candle — never drop the trade, so the chart
          // always ticks on every trade.
          if (bucket > last.timestamp) {
            // high/low must span the connected open as well as the trade price —
            // with open taken from the previous close they are rarely equal, and a
            // body outside [low, high] renders past the top of the y-axis.
            return [...prev, {
              timestamp: bucket,
              open: last.close,
              high: Math.max(priceUsd, last.close),
              low: Math.min(priceUsd, last.close),
              close: priceUsd,
              volume: data.solAmount,
            }];
          }
          const u = [...prev];
          u[u.length - 1] = {
            ...last,
            high: Math.max(last.high, priceUsd),
            low: Math.min(last.low, priceUsd),
            close: priceUsd,
            volume: (last.volume || 0) + data.solAmount,
          };
          return u;
        });
      }
    };

    // Flush all buffered trades in one frame. React 18 batches the setState calls made
    // in this loop into a SINGLE re-render, so 100 buffered trades cost one render, not
    // 100. Every trade is still applied in order (list, market cap, candle fold).
    const flushTrades = () => {
      flushRaf = null;
      const batch = pendingTrades.splice(0, pendingTrades.length);
      for (const d of batch) processTrade(d);
    };

    const onTrade = (data: TradeMsg) => {
      if (data.mint !== address) return;
      pendingTrades.push(data);
      // Bound the buffer so a backgrounded tab (rAF paused) can't accumulate forever;
      // trades that scroll off while you're not looking don't matter, the newest do.
      if (pendingTrades.length > 300) pendingTrades.splice(0, pendingTrades.length - 300);
      if (flushRaf == null) flushRaf = requestAnimationFrame(flushTrades);
    };
    socket.on("trade", onTrade);

    // LIVE: Handle real-time OHLCV candle updates (1-second candles)
    const onOhlcv = (data: { mint: string; candle: { timestamp: number; open: number; high: number; low: number; close: number; volume: number } }) => {
      if (data.mint !== address) return;
      // Live candles apply to every sub-minute tier, not just 1s — the coarser ones
      // fold trades into their own bucket via CANDLE_INTERVAL_MS.
      if (!["1s", "5s", "15s", "30s"].includes(chartPeriodRef.current || "")) return;

      setOhlcv((prev) => {
        const lastCandle = prev[prev.length - 1];
        if (!lastCandle) return [data.candle];

        // The socket forwards the RAW aggregator candle, whose open is simply the
        // first trade price in the bucket. The HTTP history is continuity-corrected
        // server-side (each bar opens where the last closed), so appending the raw
        // candle re-introduced the gaps the fetch had just removed — which is why
        // the chart looked right after a refresh and drifted apart while live.
        // Connect it here, exactly like the per-trade path above already does.
        if (lastCandle.timestamp === data.candle.timestamp) {
          // Same bucket: keep the open we already connected, let the rest move.
          const updated = [...prev];
          updated[updated.length - 1] = { ...data.candle, open: lastCandle.open };
          return updated;
        }
        const open = lastCandle.close;
        return [
          ...prev,
          // Widen the wick to cover the joined open, otherwise the body can sit
          // outside [low, high] — KLineChart builds the y-axis range from low/high
          // alone, so such a bar renders past the top of the scale.
          {
            ...data.candle,
            open,
            high: Math.max(data.candle.high, open),
            low: Math.min(data.candle.low, open),
          },
        ];
      });
    };
    socket.on("ohlcv:update", onOhlcv);

    return () => {
      // Leave only THIS token's room + handlers — never disconnect the shared socket
      // (the pulse feed and other views ride the same connection).
      socket.emit("unsubscribe:token", { address });
      socket.off("connect", subscribe);
      socket.off("trade", onTrade);
      socket.off("ohlcv:update", onOhlcv);
      if (flushRaf != null) cancelAnimationFrame(flushRaf);
      socketRef.current = null;
    };
    // NOTE: Do NOT include pulseToken in deps - it changes every second from polling
    // which would cause reconnection loop. We access it via closure in event handlers.
    // chartPeriod is intentionally NOT a dep — the handlers read it via chartPeriodRef
    // so switching timeframes never tears down the live connection.
  }, [address, fromPulse]);

  // Load chart period from localStorage, with source-specific defaults
  useEffect(() => {
    const storageKey = fromPulse ? "polyx-chart-period-pulse" : "polyx-chart-period-dashboard";
    const saved = localStorage.getItem(storageKey);

    if (saved) {
      // Validate the saved period is valid for current chart type
      const validPeriods = fromPulse
        ? ["1s", "5s", "15s", "30s", "1m", "5m", "15m", "1h", "4h", "1d", "1w"] // Pulse candle periods
        : ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"]; // Dashboard candle periods

      if (validPeriods.includes(saved)) {
        setChartPeriod(saved);
        setChartType("candle");
        return;
      }
    }

    // Default: Pulse = 1s real-time, Dashboard = 24h
    if (fromPulse) {
      setChartPeriod("1s");
      setChartType("candle");
    } else {
      setChartPeriod("24h");
    }
  }, [fromPulse]);

  // Save chart period to localStorage when it changes
  useEffect(() => {
    if (!chartPeriod) return; // Don't save initial null
    const storageKey = fromPulse ? "polyx-chart-period-pulse" : "polyx-chart-period-dashboard";
    localStorage.setItem(storageKey, chartPeriod);
  }, [chartPeriod, fromPulse]);

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
      const response = await fetch(`/api/tokens/${address}`);
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
      const response = await fetch(`/api/pulse/token/${address}`);
      if (response.ok) {
        const data = await response.json();
        // Keep the last known logo sticky — the 1s poll sometimes returns a
        // response without logoUri (feed hiccup / fallback source), and replacing
        // the whole object would blank the image a second after it loaded.
        setPulseToken((prev: any) =>
          prev ? { ...data, logoUri: data.logoUri || prev.logoUri } : data
        );
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
      // Fetch ONCE on load; live price/market cap/trades arrive over the WebSocket
      // ("trade" events). No polling — data stays cached until navigation/refresh.
      fetchPulseToken(false);
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
        const response = await fetch(`/api/tokens/${address}/supply`);
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
    if (!address || !chartPeriod) return; // Wait for period to load from localStorage

    const config = getChartConfig(chartType, chartPeriod, fromPulse);
    let isInitialFetch = true;

    const fetchOhlcv = async () => {
      try {
        let response;
        let ohlcvData: OHLCV[] = [];

        if (fromPulse) {
          // PULSE TOKENS: Backend fetches ALL swaps from DB, no time filtering needed
          response = await fetch(
            `/api/pulse/ohlcv/${address}?timeframe=${config.interval}`
          );

          if (!response.ok) {
            throw new Error(`Pulse API error: ${response.status}`);
          }

          const result = await response.json();
          ohlcvData = result.data || [];
        } else {
          // DASHBOARD TOKENS: Use Birdeye API via /api/tokens/:address/ohlcv
          // Birdeye needs time range params
          const now = Math.floor(Date.now() / 1000);
          const fromDate = now - config.seconds;
          response = await fetch(
            `/api/tokens/${address}/ohlcv?timeframe=${config.interval}&from=${fromDate}&to=${now}`
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

    // Clear existing data when switching timeframes so loading spinner shows
    setOhlcv([]);
    setChartLoading(true);
    fetchOhlcv();

    // Fetch ONCE per token/timeframe. Live candles arrive over the WebSocket
    // ("ohlcv:update"). No polling — the chart stays cached until the user
    // switches timeframe/token or refreshes.
    return () => {
      if (ohlcvIntervalRef.current) clearInterval(ohlcvIntervalRef.current);
    };
  }, [address, chartType, chartPeriod, fromPulse]);

  // Seed recent trades ONCE from REST; live trades arrive over the WebSocket
  // ("trade" events) and accumulate. Do NOT poll/replace — that was overwriting
  // the socket-accumulated list every 2s and clearing it back to 1-2 rows.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setTradesLoading(true);
    (async () => {
      try {
        const response = await fetch(`/api/pulse/trades/${address}?limit=50`);
        if (response.ok && !cancelled) {
          const data = await response.json();
          // Only seed if the socket hasn't already populated the list.
          setTrades((prev) => (prev.length ? prev : data.trades || []));
        }
      } catch (err) {
        console.error("Failed to fetch trades:", err);
      } finally {
        if (!cancelled) setTradesLoading(false);
      }
    })();
    return () => { cancelled = true; };
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
            <div className="flex items-center gap-2">
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

              {/* 3D/2D Toggle */}
              <div className={`flex items-center gap-0.5 border p-0.5 flex-shrink-0 ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                <button
                  onClick={() => setChartMode("3d")}
                  className={cn(
                    "px-2 py-1 md:py-1.5 text-xs font-mono transition-colors",
                    chartMode === "3d"
                      ? "bg-[#FF6B4A] text-white"
                      : isDark ? "text-white/60 hover:text-white" : "text-black/60 hover:text-black"
                  )}
                >
                  3D
                </button>
                <button
                  onClick={() => setChartMode("2d")}
                  className={cn(
                    "px-2 py-1 md:py-1.5 text-xs font-mono transition-colors",
                    chartMode === "2d"
                      ? "bg-[#FF6B4A] text-white"
                      : isDark ? "text-white/60 hover:text-white" : "text-black/60 hover:text-black"
                  )}
                >
                  2D
                </button>
              </div>
            </div>

            {/* Period/Timeframe Controls */}
            <ChartControls
              period={chartPeriod || "1s"}
              chartType={chartType}
              onPeriodChange={setChartPeriod}
              showPulseOption={fromPulse}
              isLoading={chartLoading}
            />
          </div>

          {/* Chart - 3D or 2D based on mode */}
          {/* Pass actual token price to ensure chart header shows correct current price */}
          {/* Render both 2D and 3D charts but hide inactive one to prevent unmount/remount issues */}
          <div className={`flex-shrink-0 h-[300px] md:h-[400px] border overflow-hidden relative ${isDark ? 'border-white/10' : 'border-black/10'}`}>
            {/* 2D KLineChart - always rendered, hidden when not active */}
            <div className={`absolute inset-0 ${chartMode === "2d" ? "" : "invisible pointer-events-none"}`}>
              <KLineChart
                data={ohlcv}
                isLoading={chartLoading && ohlcv.length === 0}
                timeframe={(chartPeriod || "1h") as "1s" | "5s" | "15s" | "30s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M"}
                chartType={chartType}
                userTrades={userTradeMarkers}
                avgEntry={avgEntry}
                avgExit={avgExit}
              />
            </div>
            {/* 3D Charts - only render when in 3D mode to save resources */}
            {chartMode === "3d" && (
              chartType === "line" ? (
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
                  timeframe={chartPeriod || "1s"}
                />
              )
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
                outputImage={getTokenLogoUrl(token?.logoUri, address) || undefined}
                currentPriceSol={(token as PulseTokenData)?.marketCapSol && token?.marketCap && token?.price ? token.price * (token as PulseTokenData).marketCapSol! / token.marketCap : 0}
                isGraduated={(token as PulseTokenData)?.complete === true || (token as PulseTokenData)?.destination === "pumpswap"}
              />
            </div>
            {/* Mobile Swap Widget - Compact version */}
            <div className="block md:hidden">
              <SwapWidget
                defaultOutputMint={address}
                outputSymbol={token?.symbol || "TOKEN"}
                outputDecimals={6}
                outputImage={getTokenLogoUrl(token?.logoUri, address) || undefined}
                currentPriceSol={(token as PulseTokenData)?.marketCapSol && token?.marketCap && token?.price ? token.price * (token as PulseTokenData).marketCapSol! / token.marketCap : 0}
                isGraduated={(token as PulseTokenData)?.complete === true || (token as PulseTokenData)?.destination === "pumpswap"}
                compactMobile={true}
              />
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
