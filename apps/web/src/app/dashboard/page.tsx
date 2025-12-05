"use client";

import { LayoutDashboard } from "lucide-react";
import { TokenList } from "@/components/tokens/TokenList";
import { TokenSearch } from "@/components/tokens/TokenSearch";
import { TrendingTokens } from "@/components/tokens/TrendingTokens";
import { useThemeStore } from "@/stores/themeStore";

export default function DashboardPage() {
  const { isDark } = useThemeStore();

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <div className={`flex items-center justify-between flex-shrink-0 px-4 py-3 backdrop-blur-md border ${
        isDark
          ? 'bg-white/5 border-white/10'
          : 'bg-black/5 border-black/10'
      }`}>
        <div className="flex items-center gap-3">
          <div className="bg-[#FF6B4A]/20 p-2.5 ring-1 ring-[#FF6B4A]/40">
            <LayoutDashboard className="h-5 w-5 text-[#FF6B4A]" />
          </div>
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Solana Memecoins</h1>
            <p className={`text-sm ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
              Explore memecoins with immersive <span className={isDark ? 'text-white/80' : 'text-gray-700'}>3D charts</span>
            </p>
          </div>
        </div>
        <TokenSearch />
      </div>

      <TrendingTokens />

      <div className="flex-1 min-h-0">
        <div className="flex items-center gap-2 mb-4">
          <h2 className={`text-xl font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>All Tokens</h2>
          <div className={`flex-1 h-px bg-gradient-to-r ${isDark ? 'from-white/20' : 'from-black/20'} to-transparent`} />
        </div>
        <TokenList />
      </div>
    </div>
  );
}
