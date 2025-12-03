"use client";

import { LayoutDashboard } from "lucide-react";
import { TokenList } from "@/components/tokens/TokenList";
import { TokenSearch } from "@/components/tokens/TokenSearch";
import { TrendingTokens } from "@/components/tokens/TrendingTokens";

export default function DashboardPage() {
  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 px-4 py-3 bg-white/5 backdrop-blur-md border border-white/10">
        <div className="flex items-center gap-3">
          <div className="bg-[#FF6B4A]/20 p-2.5 ring-1 ring-[#FF6B4A]/40">
            <LayoutDashboard className="h-5 w-5 text-[#FF6B4A]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Solana Memecoins</h1>
            <p className="text-sm text-white/50">
              Explore memecoins with immersive <span className="text-white/80">3D charts</span>
            </p>
          </div>
        </div>
        <TokenSearch />
      </div>

      <TrendingTokens />

      <div className="flex-1 min-h-0">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-xl font-semibold text-white">All Tokens</h2>
          <div className="flex-1 h-px bg-gradient-to-r from-white/20 to-transparent" />
        </div>
        <TokenList />
      </div>
    </div>
  );
}
