"use client";

import { TrendingList } from "@/components/trending/TrendingList";
import { TokenSearch } from "@/components/tokens/TokenSearch";
import { useThemeStore } from "@/stores/themeStore";

export default function DashboardPage() {
  const { isDark } = useThemeStore();

  return (
    <div className="mx-auto max-w-3xl flex flex-col gap-4">
      <div className="flex items-center justify-between flex-shrink-0 px-1 pt-1">
        <div>
          <h1 className={`text-lg md:text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Trending</h1>
          <p className={`text-xs md:text-sm ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
            What&apos;s moving on Solana right now
          </p>
        </div>
        <TokenSearch />
      </div>

      <TrendingList limit={50} heightClass="h-[70dvh]" />
    </div>
  );
}
