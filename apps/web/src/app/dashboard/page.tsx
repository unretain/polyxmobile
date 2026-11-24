"use client";

import { TokenList } from "@/components/tokens/TokenList";
import { TokenSearch } from "@/components/tokens/TokenSearch";
import { TrendingTokens } from "@/components/tokens/TrendingTokens";
import { useThemeStore } from "@/stores/themeStore";

export default function DashboardPage() {
  const { isDark } = useThemeStore();

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 px-1 pt-1">
        <div>
          <h1 className={`text-lg md:text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Trending</h1>
          <p className={`text-xs md:text-sm ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
            What&apos;s moving on Solana right now
          </p>
        </div>
        <TokenSearch />
      </div>

      <TrendingTokens />

      <div className="flex-1 min-h-0">
        <div className="flex items-center gap-3 mb-4 px-1">
          <h2 className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${isDark ? 'text-white/70' : 'text-black/60'}`}>All Tokens</h2>
          <div className={`flex-1 h-px ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
        </div>
        <TokenList />
      </div>
    </div>
  );
}
