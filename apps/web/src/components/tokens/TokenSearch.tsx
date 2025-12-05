"use client";

import { Search } from "lucide-react";
import { useTokenStore } from "@/stores/tokenStore";
import { useThemeStore } from "@/stores/themeStore";

export function TokenSearch() {
  const { searchQuery, setSearchQuery } = useTokenStore();
  const { isDark } = useThemeStore();

  return (
    <div className="relative">
      <Search className={`absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${
        isDark ? 'text-white/40' : 'text-gray-400'
      }`} />
      <input
        type="text"
        placeholder="Search tokens..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className={`h-10 w-full rounded-lg border pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF6B4A] focus:border-[#FF6B4A] sm:w-64 ${
          isDark
            ? 'border-white/10 bg-white/5 text-white placeholder:text-white/40'
            : 'border-black/10 bg-white text-gray-900 placeholder:text-gray-400'
        }`}
      />
    </div>
  );
}
