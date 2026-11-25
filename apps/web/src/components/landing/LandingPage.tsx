"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { useThemeStore } from "@/stores/themeStore";
import { WalletOnboarding } from "@/components/wallet/WalletOnboarding";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { TrendingList } from "@/components/trending/TrendingList";
import { MiniCandlestickChart } from "@/components/charts/MiniCandlestickChart";
import type { OHLCV } from "@/stores/pulseStore";

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
// Majors tab — SOL chart + big-cap rows
// ---------------------------------------------------------------------------

const MAJORS = [
  { address: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", logo: "/solana-logo.png" },
  { address: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", symbol: "ETH", name: "Ethereum (Wormhole)", logo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png" },
] as const;

interface MajorQuote { price: number | null; change24h: number | null; }

function MajorsPanel({ isDark, onOpen }: { isDark: boolean; onOpen: (address: string) => void }) {
  const [candles, setCandles] = useState<OHLCV[]>([]);
  const [quotes, setQuotes] = useState<Record<string, MajorQuote>>({});

  // SOL chart — one fetch, 15m bars.
  useEffect(() => {
    fetch(`/api/tokens/${MAJORS[0].address}/ohlcv?timeframe=15m&limit=64`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setCandles(d); })
      .catch(() => {});
    for (const m of MAJORS) {
      fetch(`/api/tokens/${m.address}`)
        .then((r) => r.json())
        .then((d) => setQuotes((q) => ({
          ...q,
          [m.symbol]: { price: d?.price ?? null, change24h: typeof d?.priceChange24h === "number" ? d.priceChange24h : null },
        })))
        .catch(() => {});
    }
  }, []);

  return (
    <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-white/10 bg-white/[0.04]' : 'border-black/10 bg-white'}`}>
      {/* SOL chart */}
      <div className={`px-4 pt-3 pb-1 flex items-baseline justify-between`}>
        <span className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${isDark ? 'text-white/70' : 'text-black/60'}`}>SOL</span>
        <span className="text-sm font-mono">
          {quotes.SOL?.price != null ? `$${quotes.SOL.price.toFixed(2)}` : "…"}
          {quotes.SOL?.change24h != null && (
            <span className={`ml-2 text-xs ${quotes.SOL.change24h >= 0 ? 'text-up' : 'text-down'}`}>
              {quotes.SOL.change24h >= 0 ? '+' : ''}{quotes.SOL.change24h.toFixed(2)}%
            </span>
          )}
        </span>
      </div>
      <div className="h-48 px-2">
        <MiniCandlestickChart data={candles} isLoading={candles.length === 0} />
      </div>

      {/* Major rows */}
      <div className={`border-t p-1.5 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
        {MAJORS.map((m) => {
          const q = quotes[m.symbol];
          const positive = (q?.change24h ?? 0) >= 0;
          return (
            <button
              key={m.symbol}
              onClick={() => onOpen(m.address)}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${
                isDark ? 'hover:bg-white/5' : 'hover:bg-black/[0.04]'
              }`}
            >
              <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full">
                <Image src={m.logo} alt={m.symbol} fill className="object-cover" unoptimized />
              </div>
              <div className="flex-1 min-w-0">
                <span className={`font-semibold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{m.symbol}</span>
                <span className={`ml-2 text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>{m.name}</span>
              </div>
              <span className={`text-sm font-mono ${isDark ? 'text-white/80' : 'text-gray-800'}`}>
                {q?.price != null ? `$${q.price >= 100 ? q.price.toFixed(2) : q.price.toFixed(4)}` : "…"}
              </span>
              <span className={`w-16 text-right text-xs font-mono tabular-nums ${positive ? 'text-up' : 'text-down'}`}>
                {q?.change24h != null ? `${positive ? '+' : ''}${q.change24h.toFixed(1)}%` : ""}
              </span>
              <ChevronRight className={`h-4 w-4 shrink-0 ${isDark ? 'text-white/20' : 'text-black/20'}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LandingPage() {
  const { isDark } = useThemeStore();
  const router = useRouter();
  const { wallet, _hasHydrated } = useMobileWalletStore();
  const [isWalletOnboardingOpen, setIsWalletOnboardingOpen] = useState(false);
  const [tab, setTab] = useState<"trending" | "majors">("trending");

  // Auto-show wallet onboarding on first load if no wallet (after hydration)
  useEffect(() => {
    if (_hasHydrated && !wallet) {
      setIsWalletOnboardingOpen(true);
    }
  }, [wallet, _hasHydrated]);

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
          {/* Brand + tabs on one line */}
          <div className="mb-4 px-1 flex items-center justify-between">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              <span className={isDark ? 'text-white' : 'text-black'}>[poly</span>
              <span className="text-[#FF6B4A]">x</span>
              <span className={isDark ? 'text-white' : 'text-black'}>]</span>
            </h1>
            <div className={`flex items-center p-0.5 rounded-xl border ${
              isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
            }`}>
              {(["trending", "majors"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1.5 rounded-[10px] text-xs font-medium capitalize transition-colors ${
                    tab === t
                      ? 'bg-[#FF6B4A]/15 text-[#FF6B4A]'
                      : isDark ? 'text-white/50 hover:text-white/80' : 'text-black/50 hover:text-black/80'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {tab === "trending" ? (
            <TrendingList heightClass="h-[60dvh]" />
          ) : (
            <MajorsPanel isDark={isDark} onOpen={openToken} />
          )}

          {/* New users: one quiet entry point */}
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
