"use client";

import { useEffect, useState, useCallback } from "react";
import { TrendingUp, RefreshCw, DollarSign, Flame } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { ExpansiveMarketView } from "@/components/markets/ExpansiveMarketView";
import { cn, formatNumber } from "@/lib/utils";

interface Market {
  id: string;
  question: string;
  slug: string;
  description?: string;
  outcomes: string[];
  outcomeProbabilities: number[];
  outcomeTokenIds: string[];
  outcomeVolumes: number[];
  isMultiOutcome: boolean;
  volume: number;
  liquidity: number;
  endDate: string;
  startDate?: string;
  category?: string;
  image?: string;
  icon?: string;
  tags?: string[];
}

interface PriceHistory {
  t: number;
  p: number;
}

interface Category {
  id: string;
  label: string;
  slug: string;
}

const CATEGORIES: Category[] = [
  { id: "all", label: "All", slug: "all" },
  { id: "sports", label: "Sports", slug: "sports" },
  { id: "politics", label: "Politics", slug: "politics" },
  { id: "crypto", label: "Crypto", slug: "crypto" },
  { id: "business", label: "Business", slug: "business" },
  { id: "pop-culture", label: "Culture", slug: "pop-culture" },
  { id: "science", label: "Science", slug: "science" },
];

// Top 5 Volume Bar Component
function TopVolumeBar({
  markets,
  onMarketClick,
  isDark,
}: {
  markets: Market[];
  onMarketClick: (market: Market) => void;
  isDark: boolean;
}) {
  const top5 = markets.slice(0, 5);

  if (top5.length === 0) return null;

  return (
    <div className={`flex-shrink-0 bg-gradient-to-r from-[#FF6B4A]/5 via-transparent to-[#FF6B4A]/5 border p-4 ${
      isDark ? 'border-white/10' : 'border-black/10'
    }`}>
      <div className="flex items-center gap-2 mb-3">
        <Flame className="h-4 w-4 text-[#FF6B4A]" />
        <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Top 5 by Volume</span>
      </div>
      <div className="grid grid-cols-5 gap-3">
        {top5.map((market, index) => {
          const topOutcome = market.outcomes[0];
          const topProb = market.outcomeProbabilities[0];

          return (
            <button
              key={market.id}
              onClick={() => onMarketClick(market)}
              className={`group border hover:border-[#FF6B4A]/50 transition-all overflow-hidden text-left ${
                isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
              }`}
            >
              <div className="p-3">
                <div className="flex items-center gap-1 mb-2">
                  <span className="px-1.5 py-0.5 bg-[#FF6B4A]/20 text-[10px] font-bold text-[#FF6B4A]">
                    #{index + 1}
                  </span>
                  {market.isMultiOutcome && (
                    <span className="px-1.5 py-0.5 bg-blue-500/20 text-[10px] font-medium text-blue-400">
                      {market.outcomes.length} options
                    </span>
                  )}
                </div>
                <p className={`text-xs font-medium line-clamp-2 group-hover:text-[#FF6B4A] transition-colors leading-tight mb-2 ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}>
                  {market.question}
                </p>
                {market.isMultiOutcome ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] truncate max-w-[70%] ${isDark ? 'text-white/60' : 'text-gray-500'}`}>{topOutcome}</span>
                      <span className="text-xs font-bold text-green-400">{Math.round(topProb * 100)}%</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-green-400">
                      {Math.round(topProb * 100)}% Yes
                    </span>
                  </div>
                )}
                <div className={`mt-2 text-[10px] ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
                  ${formatNumber(market.volume)} Vol
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Market Card Component - Polymarket style
function MarketCard({
  market,
  onExpand,
  isDark,
}: {
  market: Market;
  onExpand: () => void;
  isDark: boolean;
}) {
  const isMulti = market.isMultiOutcome;
  const displayOutcomes = market.outcomes.slice(0, 4);
  const hasMore = market.outcomes.length > 4;

  return (
    <div
      onClick={onExpand}
      className={`border overflow-hidden hover:border-[#FF6B4A]/30 transition-colors group cursor-pointer p-4 ${
        isDark ? 'bg-white/5 border-white/10' : 'bg-white border-black/10'
      }`}
    >
      {/* Question */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className={`text-sm font-medium leading-tight line-clamp-2 group-hover:text-[#FF6B4A] transition-colors flex-1 ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}>
          {market.question}
        </h3>
        {isMulti && (
          <span className="flex-shrink-0 px-1.5 py-0.5 bg-blue-500/20 text-[10px] font-medium text-blue-400">
            {market.outcomes.length}
          </span>
        )}
      </div>

      {/* Outcomes */}
      {isMulti ? (
        <div className="space-y-1.5 mb-3">
          {displayOutcomes.map((outcome, i) => {
            const prob = market.outcomeProbabilities[i];
            return (
              <div key={i} className={`flex items-center justify-between py-1 border-b last:border-0 ${
                isDark ? 'border-white/5' : 'border-black/5'
              }`}>
                <span className={`text-xs truncate max-w-[60%] ${isDark ? 'text-white/80' : 'text-gray-700'}`}>{outcome}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-green-400">{Math.round(prob * 100)}%</span>
                  <div className="flex gap-1">
                    <button className="px-2 py-0.5 bg-green-500/10 border border-green-500/30 text-[10px] text-green-400 hover:bg-green-500/20">
                      Yes
                    </button>
                    <button className="px-2 py-0.5 bg-red-500/10 border border-red-500/30 text-[10px] text-red-400 hover:bg-red-500/20">
                      No
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {hasMore && (
            <div className={`flex items-center justify-center py-1 text-[10px] ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
              +{market.outcomes.length - 4} more options
            </div>
          )}
        </div>
      ) : (
        <div className="flex gap-2 mb-3">
          <button className="flex-1 py-2 bg-green-500/10 border border-green-500/30 hover:bg-green-500/20 transition-colors">
            <span className="block text-lg font-bold text-green-400">{Math.round(market.outcomeProbabilities[0] * 100)}%</span>
            <span className="block text-xs text-green-400/70">Yes</span>
          </button>
          <button className="flex-1 py-2 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 transition-colors">
            <span className="block text-lg font-bold text-red-400">{Math.round(market.outcomeProbabilities[1] * 100)}%</span>
            <span className="block text-xs text-red-400/70">No</span>
          </button>
        </div>
      )}

      {/* Volume & Category */}
      <div className={`flex items-center justify-between text-xs ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
        <span className="flex items-center gap-1">
          <DollarSign className="h-3 w-3" />
          ${formatNumber(market.volume)} Vol
        </span>
        {market.category && (
          <span className="px-2 py-0.5 bg-[#FF6B4A]/10 text-[#FF6B4A] text-[10px]">
            {market.category}
          </span>
        )}
      </div>
    </div>
  );
}

export default function MarketsPage() {
  const { isDark } = useThemeStore();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [priceHistories, setPriceHistories] = useState<Record<string, PriceHistory[]>>({});
  const [loadingHistories, setLoadingHistories] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [expandedMarket, setExpandedMarket] = useState<Market | null>(null);

  // Fetch all markets
  const fetchMarkets = useCallback(async (category?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      let url = `/api/polymarket?action=markets`;
      if (category && category !== "all") {
        url += `&category=${category}`;
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch markets");

      const allMarkets: Market[] = await response.json();
      setMarkets(allMarkets);
    } catch (err) {
      console.error("Error fetching markets:", err);
      setError("Failed to load markets. Using mock data.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch price history for a specific outcome
  const fetchPriceHistory = async (tokenId: string, key: string) => {
    setLoadingHistories((prev) => ({ ...prev, [key]: true }));

    try {
      const response = await fetch(
        `/api/polymarket?action=price-history&tokenId=${tokenId}&interval=max`
      );

      if (response.ok) {
        const data = await response.json();
        setPriceHistories((prev) => ({
          ...prev,
          [key]: data.history || [],
        }));
      }
    } catch (err) {
      console.error(`Error fetching price history for ${key}:`, err);
    } finally {
      setLoadingHistories((prev) => ({ ...prev, [key]: false }));
    }
  };

  // Handle market expansion
  const handleExpandMarket = (market: Market) => {
    setExpandedMarket(market);
  };

  // Handle category change
  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    fetchMarkets(category);
  };

  // Initial fetch
  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      {/* Header */}
      <div className={`flex items-center justify-between flex-shrink-0 px-4 py-3 backdrop-blur-md border ${
        isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
      }`}>
        <div className="flex items-center gap-3">
          <div className="bg-[#FF6B4A]/20 p-2.5 ring-1 ring-[#FF6B4A]/40">
            <TrendingUp className="h-5 w-5 text-[#FF6B4A]" />
          </div>
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Markets</h1>
            <p className={`text-sm ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
              Prediction markets from Polymarket • <span className={isDark ? 'text-white/80' : 'text-gray-700'}>{markets.length}</span> active
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://polymarket.com"
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
              isDark ? 'text-white/50 hover:text-white/80' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            polymarket.com
            <ExternalLink className="h-4 w-4" />
          </a>

          <button
            onClick={() => fetchMarkets(selectedCategory)}
            disabled={isLoading}
            className={cn(
              "flex items-center gap-2 border bg-[#FF6B4A]/10 border-[#FF6B4A]/30 px-4 py-2 text-sm font-medium transition-all",
              "hover:bg-[#FF6B4A]/20 hover:border-[#FF6B4A]/50 active:scale-95",
              isDark ? 'text-white' : 'text-gray-900',
              isLoading && "opacity-50"
            )}
          >
            <RefreshCw className={cn("h-4 w-4 text-[#FF6B4A]", isLoading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex-shrink-0 px-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => handleCategoryChange(cat.id)}
              className={cn(
                "px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all",
                selectedCategory === cat.id
                  ? "bg-[#FF6B4A] text-white"
                  : isDark
                    ? "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/10"
                    : "bg-black/5 text-gray-600 hover:bg-black/10 hover:text-gray-900 border border-black/10"
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex-shrink-0 mx-4 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
          {error}
        </div>
      )}

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 relative">
        {/* Loading Overlay - shown when switching categories */}
        {isLoading && (
          <div className={`absolute inset-0 backdrop-blur-sm z-10 flex items-center justify-center ${
            isDark ? 'bg-[#0a0a0a]/80' : 'bg-white/80'
          }`}>
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="h-12 w-12 rounded-full border-2 border-[#FF6B4A]/20 border-t-[#FF6B4A] animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-[#FF6B4A]" />
                </div>
              </div>
              <span className={`text-sm ${isDark ? 'text-white/60' : 'text-gray-500'}`}>Loading markets...</span>
            </div>
          </div>
        )}

        {/* Top 5 Volume Bar */}
        {markets.length > 0 && (
          <div className="mb-4">
            <TopVolumeBar
              markets={markets}
              onMarketClick={handleExpandMarket}
              isDark={isDark}
            />
          </div>
        )}

        {/* Markets Grid */}
        {markets.length === 0 && !isLoading ? (
          <div className={`flex flex-col items-center justify-center h-full ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
            <TrendingUp className="h-12 w-12 mb-4 opacity-40" />
            <p>No markets available</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {markets.slice(5).map((market) => (
              <MarketCard
                key={market.id}
                market={market}
                onExpand={() => handleExpandMarket(market)}
                isDark={isDark}
              />
            ))}
          </div>
        )}
      </div>


      {/* Expanded Market View */}
      {expandedMarket && (
        <ExpansiveMarketView
          market={expandedMarket}
          priceHistories={priceHistories}
          loadingHistories={loadingHistories}
          onFetchPriceHistory={fetchPriceHistory}
          onClose={() => setExpandedMarket(null)}
        />
      )}
    </div>
  );
}
