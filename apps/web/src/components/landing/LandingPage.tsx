"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ChevronRight, Activity } from "lucide-react";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { useThemeStore } from "@/stores/themeStore";
import { WalletOnboarding } from "@/components/wallet/WalletOnboarding";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { usePulseStore, type PulseToken } from "@/stores/pulseStore";
import { imgSrc } from "@/lib/imgSrc";
import { formatNumber } from "@/lib/utils";

// Background component with theme support
function StarBackground({ isDark }: { isDark: boolean }) {
  return (
    <div className="fixed inset-0 z-0 transition-colors duration-300">
      <div className={`absolute inset-0 ${isDark ? 'bg-[#0a0a0a]' : 'bg-[#f5f5f5]'}`} />
      <div className={`absolute inset-0 star-grid ${isDark ? 'opacity-20' : 'opacity-10'}`} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trending
// ---------------------------------------------------------------------------

type AgeFilter = "all" | "1h" | "6h" | "24h";
const AGE_FILTERS: Array<{ id: AgeFilter; label: string; maxAgeMs: number }> = [
  { id: "all", label: "All", maxAgeMs: Infinity },
  { id: "1h", label: "<1h", maxAgeMs: 60 * 60 * 1000 },
  { id: "6h", label: "<6h", maxAgeMs: 6 * 60 * 60 * 1000 },
  { id: "24h", label: "<24h", maxAgeMs: 24 * 60 * 60 * 1000 },
];

/**
 * Trending score. Volume is the signal (money actually moving); market cap is a
 * multiplier so a $5K curve with $10K volume doesn't outrank a $500K coin doing
 * the same volume — but only logarithmically, so size can't buy the top spot
 * without flow behind it.
 */
function trendingScore(t: PulseToken): number {
  return (t.volume24h || 0) * Math.log10(10 + Math.max(0, t.marketCap || 0));
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

export function LandingPage() {
  const { isDark } = useThemeStore();
  const router = useRouter();
  const { wallet, _hasHydrated } = useMobileWalletStore();
  const [isWalletOnboardingOpen, setIsWalletOnboardingOpen] = useState(false);
  const [age, setAge] = useState<AgeFilter>("all");

  const { newPairs, graduatingPairs, graduatedPairs, connectRealtime, disconnectRealtime } = usePulseStore();

  // Live feed straight onto the homepage — this IS the app's front door.
  useEffect(() => {
    connectRealtime();
    return () => disconnectRealtime();
  }, [connectRealtime, disconnectRealtime]);

  // Auto-show wallet onboarding on first load if no wallet (after hydration)
  useEffect(() => {
    if (_hasHydrated && !wallet) {
      setIsWalletOnboardingOpen(true);
    }
  }, [wallet, _hasHydrated]);

  const trending = useMemo(() => {
    const seen = new Map<string, PulseToken>();
    for (const t of [...graduatedPairs, ...graduatingPairs, ...newPairs]) {
      if (!seen.has(t.address)) seen.set(t.address, t);
    }
    const maxAge = AGE_FILTERS.find((f) => f.id === age)!.maxAgeMs;
    const now = Date.now();
    return Array.from(seen.values())
      .filter((t) => now - t.createdAt <= maxAge)
      .sort((a, b) => trendingScore(b) - trendingScore(a))
      .slice(0, 30);
  }, [newPairs, graduatingPairs, graduatedPairs, age]);

  const openToken = (address: string) => {
    if (!wallet) {
      setIsWalletOnboardingOpen(true);
      return;
    }
    router.push(`/token/${address}?source=pulse`);
  };

  return (
    <div className={`min-h-screen overflow-x-hidden transition-colors duration-300 ${isDark ? 'text-white' : 'text-black'}`}>
      <StarBackground isDark={isDark} />
      <MobileHeader />

      <main className="relative z-10 pt-20 md:pt-24 pb-10 px-4 md:px-8">
        <div className="max-w-3xl mx-auto">
          {/* Brand header — small; the live list is the pitch */}
          <div className="mb-5 px-1">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              <span className={isDark ? 'text-white' : 'text-black'}>[poly</span>
              <span className="text-[#FF6B4A]">x</span>
              <span className={isDark ? 'text-white' : 'text-black'}>]</span>
            </h1>
            <p className={`mt-1 text-sm ${isDark ? 'text-white/50' : 'text-black/50'}`}>
              Live Solana memecoin trading — 3D charts, instant buys
            </p>
          </div>

          {/* Trending header + age filter */}
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

          {/* Trending rows */}
          <div className={`rounded-2xl border overflow-hidden ${
            isDark ? 'border-white/10 bg-white/[0.04]' : 'border-black/10 bg-white'
          }`}>
            {trending.length === 0 ? (
              <div className={`flex flex-col items-center justify-center py-16 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
                <Activity className="h-8 w-8 mb-2 opacity-40" />
                <span className="text-sm">Waiting for live tokens…</span>
              </div>
            ) : (
              <div className="p-1.5 space-y-0.5">
                {trending.map((t, i) => (
                  <TrendingRow key={t.address} token={t} rank={i + 1} isDark={isDark} onOpen={() => openToken(t.address)} />
                ))}
              </div>
            )}
          </div>

          {/* New users: one quiet entry point, not a hero button */}
          {_hasHydrated && !wallet && (
            <button
              onClick={() => setIsWalletOnboardingOpen(true)}
              className="mt-4 w-full py-3 rounded-xl text-sm font-semibold bg-[#FF6B4A] text-white hover:bg-[#FF8F6B] transition-colors"
            >
              Create a wallet to start trading
            </button>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className={`relative z-10 border-t py-4 px-4 md:px-8 ${isDark ? 'border-white/5' : 'border-black/10'}`}>
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <a
            href="https://x.com/solana"
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-1.5 text-xs transition-colors ${isDark ? 'text-white/40 hover:text-white/60' : 'text-black/40 hover:text-black/60'}`}
          >
            <span>Backed by</span>
            <Image src="/solana-logo.png" alt="Solana" width={14} height={14} className="rounded-sm" />
            <span className={isDark ? 'text-white/60' : 'text-black/60'}>Solana</span>
          </a>

          <div className={`flex items-center gap-4 text-xs ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            <a href="/privacy" className={`transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}>Privacy</a>
            <a href="/tos" className={`transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}>Terms</a>
            <a href="https://x.com/tradeonpolyx" target="_blank" rel="noopener noreferrer" className={`transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}>@tradeonpolyx</a>
            <a href="https://x.com/unretains" target="_blank" rel="noopener noreferrer" className={`transition-colors ${isDark ? 'hover:text-white' : 'hover:text-black'}`}>@unretains</a>
          </div>
        </div>
      </footer>

      <WalletOnboarding
        isOpen={isWalletOnboardingOpen}
        onClose={() => setIsWalletOnboardingOpen(false)}
      />
    </div>
  );
}
