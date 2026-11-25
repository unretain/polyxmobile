"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ChevronRight, Activity } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { usePulseStore, type PulseToken } from "@/stores/pulseStore";
import { imgSrc } from "@/lib/imgSrc";
import { formatNumber } from "@/lib/utils";

/**
 * The trending list — shared by the homepage and the Trending page.
 *
 * Quality bar: a coin must have ≥ $10K market cap, and — when the live feed
 * provides it — ≥ 0.5 SOL in gas fees actually paid on the coin (priority fees
 * + tips; bots don't bribe validators for dead coins). Fallback data
 * (DexScreener) has no fee field, so the fee bar only applies to live data —
 * otherwise the list would be empty whenever the api is down.
 *
 * Score: volume24h × log10(10 + marketCap), with a 2× boost for coins younger
 * than 15 minutes so fresh runners surface next to established ones.
 */

type AgeFilter = "all" | "1h" | "6h" | "24h";
const AGE_FILTERS: Array<{ id: AgeFilter; label: string; maxAgeMs: number }> = [
  { id: "all", label: "All", maxAgeMs: Infinity },
  { id: "1h", label: "<1h", maxAgeMs: 60 * 60 * 1000 },
  { id: "6h", label: "<6h", maxAgeMs: 6 * 60 * 60 * 1000 },
  { id: "24h", label: "<24h", maxAgeMs: 24 * 60 * 60 * 1000 },
];

const MIN_MCAP_USD = 10_000;
const MIN_FEES_SOL = 0.5;
const FRESH_MS = 15 * 60 * 1000;

function trendingScore(t: PulseToken): number {
  const base = (t.volume24h || 0) * Math.log10(10 + Math.max(0, t.marketCap || 0));
  const fresh = Date.now() - t.createdAt < FRESH_MS ? 2 : 1;
  return base * fresh;
}

function passesQualityBar(t: PulseToken): boolean {
  if ((t.marketCap || 0) < MIN_MCAP_USD) return false;
  // Fee bar only when the data actually carries fees (live gRPC feed).
  if (typeof t.feesPaidSol === "number" && t.feesPaidSol < MIN_FEES_SOL) return false;
  return true;
}

function timeAgo(timestamp: number): string {
  const s = Math.floor((Date.now() - timestamp) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatMC(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function TrendingRow({ token, rank, isDark, onOpen }: {
  token: PulseToken; rank: number; isDark: boolean; onOpen: () => void;
}) {
  const positive = (token.priceChange24h ?? 0) >= 0;
  return (
    <button
      onClick={onOpen}
      className={`w-full flex items-center gap-3 px-3 md:px-4 py-3 rounded-xl text-left transition-colors ${
        isDark ? 'hover:bg-white/5' : 'hover:bg-black/[0.04]'
      }`}
    >
      <span className={`w-5 shrink-0 text-xs font-mono text-right ${isDark ? 'text-white/30' : 'text-black/30'}`}>
        {rank}
      </span>

      <div className={`relative h-9 w-9 shrink-0 overflow-hidden rounded-full ring-1 ${
        isDark ? 'bg-white/5 ring-white/10' : 'bg-black/5 ring-black/10'
      }`}>
        {token.logoUri ? (
          <Image src={imgSrc(token.logoUri)!} alt={token.symbol} fill className="object-cover" unoptimized />
        ) : (
          <div className={`flex h-full w-full items-center justify-center text-sm font-bold ${
            isDark ? 'text-white/40 bg-white/10' : 'text-black/40 bg-black/10'
          }`}>
            {token.symbol?.charAt(0) ?? "?"}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`font-semibold text-sm truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{token.symbol}</span>
          {token.source === "polyx" && (
            <span className="shrink-0 px-1.5 py-px rounded-full text-[9px] font-semibold uppercase tracking-wide text-[#FF6B4A] bg-[#FF6B4A]/10">
              polyx
            </span>
          )}
          <span className={`text-xs truncate hidden sm:inline ${isDark ? 'text-white/40' : 'text-gray-500'}`}>{token.name}</span>
        </div>
        <div className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
          {timeAgo(token.createdAt)}
          <span className="hidden md:inline"> · {token.txCount || 0} txns</span>
          {typeof token.feesPaidSol === "number" && token.feesPaidSol > 0 && (
            <span className="hidden md:inline"> · {token.feesPaidSol.toFixed(2)} ◎ fees</span>
          )}
        </div>
      </div>

      <div className="hidden sm:block w-20 text-right">
        <div className={`text-[10px] uppercase ${isDark ? 'text-white/30' : 'text-black/30'}`}>Vol</div>
        <div className={`text-sm font-mono ${isDark ? 'text-white/80' : 'text-gray-800'}`}>${formatNumber(token.volume24h || 0)}</div>
      </div>

      <div className="w-20 text-right">
        <div className={`text-[10px] uppercase ${isDark ? 'text-white/30' : 'text-black/30'}`}>MC</div>
        <div className={`text-sm font-mono ${isDark ? 'text-white/80' : 'text-gray-800'}`}>{formatMC(token.marketCap || 0)}</div>
      </div>

      <div className={`w-16 text-right text-xs font-mono font-medium tabular-nums ${positive ? 'text-up' : 'text-down'}`}>
        {positive ? '+' : ''}{(token.priceChange24h ?? 0).toFixed(1)}%
      </div>

      <ChevronRight className={`h-4 w-4 shrink-0 ${isDark ? 'text-white/20' : 'text-black/20'}`} />
    </button>
  );
}

interface TrendingListProps {
  /** Rows shown inside the scrollable box. */
  limit?: number;
  /** Tailwind height class for the scroll container. */
  heightClass?: string;
  /** Called when a row is tapped but no wallet exists yet. */
  onNeedWallet?: () => void;
}

export function TrendingList({ limit = 30, heightClass = "h-[26rem]", onNeedWallet }: TrendingListProps) {
  const router = useRouter();
  const { isDark } = useThemeStore();
  const [age, setAge] = useState<AgeFilter>("all");

  const { newPairs, graduatingPairs, graduatedPairs, connectRealtime } = usePulseStore();

  useEffect(() => {
    connectRealtime();
    // The socket intentionally stays up across navigations (see pulseStore).
  }, [connectRealtime]);

  const trending = useMemo(() => {
    const seen = new Map<string, PulseToken>();
    for (const t of [...graduatedPairs, ...graduatingPairs, ...newPairs]) {
      if (!seen.has(t.address)) seen.set(t.address, t);
    }
    const maxAge = AGE_FILTERS.find((f) => f.id === age)!.maxAgeMs;
    const now = Date.now();
    return Array.from(seen.values())
      .filter((t) => now - t.createdAt <= maxAge && passesQualityBar(t))
      .sort((a, b) => trendingScore(b) - trendingScore(a))
      .slice(0, limit);
  }, [newPairs, graduatingPairs, graduatedPairs, age, limit]);

  const openToken = (address: string) => router.push(`/token/${address}?source=pulse`);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2 px-1">
        <h2 className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${isDark ? 'text-white/70' : 'text-black/60'}`}>
          Trending
        </h2>
        <div className={`flex items-center p-0.5 rounded-xl border ${
          isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
        }`}>
          {AGE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setAge(f.id)}
              className={`px-2.5 py-1 rounded-[10px] text-xs font-medium transition-colors ${
                age === f.id
                  ? 'bg-[#FF6B4A]/15 text-[#FF6B4A]'
                  : isDark ? 'text-white/50 hover:text-white/80' : 'text-black/50 hover:text-black/80'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Fixed-height box with internal scroll — the page itself never grows. */}
      <div className={`rounded-2xl border overflow-hidden ${
        isDark ? 'border-white/10 bg-white/[0.04]' : 'border-black/10 bg-white'
      }`}>
        <div className={`${heightClass} overflow-y-auto overscroll-contain p-1.5 space-y-0.5`}>
          {trending.length === 0 ? (
            <div className={`flex flex-col items-center justify-center h-full ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
              <Activity className="h-8 w-8 mb-2 opacity-40" />
              <span className="text-sm">Waiting for coins that clear the bar…</span>
              <span className={`mt-1 text-xs ${isDark ? 'text-white/25' : 'text-gray-300'}`}>≥ $10K MC · ≥ 0.5 ◎ fees paid</span>
            </div>
          ) : (
            trending.map((t, i) => (
              <TrendingRow key={t.address} token={t} rank={i + 1} isDark={isDark} onOpen={() => openToken(t.address)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
