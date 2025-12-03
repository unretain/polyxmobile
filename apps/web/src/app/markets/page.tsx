"use client";

import { useEffect, useState, useCallback } from "react";
import { TrendingUp, RefreshCw, ExternalLink, DollarSign, Filter, Flame, X } from "lucide-react";
import { Probability3DChart } from "@/components/charts/Probability3DChart";
import { cn, formatNumber } from "@/lib/utils";

interface Market {
  id: string;
  question: string;
  slug: string;
  description?: string;
  outcomes: string[];
  yesProbability: number;
  noProbability: number;
  volume: number;
  liquidity: number;
  endDate: string;
  startDate?: string;
  category?: string;
  image?: string;
  icon?: string;
  tokenIds: string[];
  conditionId?: string;
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

// Top 5 Volume Bar Component - All markets are Yes/No so always show charts
function TopVolumeBar({
  markets,
  priceHistories,
  loadingHistories,
  onMarketClick,
}: {
  markets: Market[];
  priceHistories: Record<string, PriceHistory[]>;
  loadingHistories: Record<string, boolean>;
  onMarketClick: (market: Market) => void;
}) {
  // Top 5 by volume (already sorted from API)
  const top5 = markets.slice(0, 5);

  if (top5.length === 0) return null;

  return (
    <div className="flex-shrink-0 bg-gradient-to-r from-[#FF6B4A]/5 via-transparent to-[#FF6B4A]/5 border border-white/10 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Flame className="h-4 w-4 text-[#FF6B4A]" />
        <span className="text-sm font-medium text-white">Top 5 by Volume</span>
      </div>
      <div className="grid grid-cols-5 gap-3">
        {top5.map((market, index) => {
          const hasChartData = priceHistories[market.id]?.length > 0;
          const isLoading = loadingHistories[market.id];

          return (
            <button
              key={market.id}
              onClick={() => onMarketClick(market)}
              className="group bg-white/5 border border-white/10 hover:border-[#FF6B4A]/50 transition-all overflow-hidden text-left"
            >
              {/* Chart area */}
              <div className="h-24 relative">
                <div className="absolute top-1 left-1 z-10 px-1.5 py-0.5 bg-black/60 text-[10px] font-bold text-[#FF6B4A]">
                  #{index + 1}
                </div>
                <Probability3DChart
                  data={priceHistories[market.id] || []}
                  isLoading={isLoading || (!hasChartData && !isLoading)}
                  currentProbability={market.yesProbability}
                />
              </div>
              <div className="p-2">
                <p className="text-xs font-medium text-white line-clamp-2 group-hover:text-[#FF6B4A] transition-colors leading-tight">
                  {market.question}
                </p>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-xs font-bold text-green-400">
                    {Math.round(market.yesProbability * 100)}% Yes
                  </span>
                  <span className="text-[10px] text-white/40">
                    ${formatNumber(market.volume)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}


// Market Card Component - Polymarket style (no chart, just text/buttons)
function MarketCard({
  market,
  onExpand,
}: {
  market: Market;
  onExpand: () => void;
}) {
  const yesPercent = Math.round(market.yesProbability * 100);
  const noPercent = Math.round(market.noProbability * 100);

  return (
    <div
      onClick={onExpand}
      className="bg-white/5 border border-white/10 overflow-hidden hover:border-[#FF6B4A]/30 transition-colors group cursor-pointer p-4"
    >
      {/* Question */}
      <h3 className="text-sm font-medium text-white leading-tight line-clamp-2 group-hover:text-[#FF6B4A] transition-colors mb-3">
        {market.question}
      </h3>

      {/* Yes/No Buttons - Polymarket style */}
      <div className="flex gap-2 mb-3">
        <button className="flex-1 py-2 bg-green-500/10 border border-green-500/30 hover:bg-green-500/20 transition-colors">
          <span className="block text-lg font-bold text-green-400">{yesPercent}¢</span>
          <span className="block text-xs text-green-400/70">Yes</span>
        </button>
        <button className="flex-1 py-2 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 transition-colors">
          <span className="block text-lg font-bold text-red-400">{noPercent}¢</span>
          <span className="block text-xs text-red-400/70">No</span>
        </button>
      </div>

      {/* Volume & Category */}
      <div className="flex items-center justify-between text-xs text-white/40">
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

// Expanded Market Modal - All markets are Yes/No so always show chart
function MarketModal({
  market,
  priceHistory,
  isLoadingHistory,
  onClose,
}: {
  market: Market;
  priceHistory: PriceHistory[];
  isLoadingHistory: boolean;
  onClose: () => void;
}) {
  const endDate = new Date(market.endDate);
  const daysUntilEnd = Math.ceil((endDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-[#0f0f0f] border border-white/10 overflow-hidden">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 bg-black/50 hover:bg-black/80 transition-colors"
        >
          <X className="h-5 w-5 text-white/60" />
        </button>

        {/* 3D Chart - always show for Yes/No markets */}
        <div className="h-64">
          <Probability3DChart
            data={priceHistory}
            isLoading={isLoadingHistory}
            currentProbability={market.yesProbability}
          />
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Category & Tags */}
          <div className="flex flex-wrap items-center gap-2">
            {market.category && (
              <span className="px-3 py-1 bg-[#FF6B4A]/10 text-[#FF6B4A] font-medium text-sm">
                {market.category}
              </span>
            )}
            {market.tags?.slice(0, 3).map((tag) => (
              <span key={tag} className="px-2 py-0.5 bg-white/5 text-white/50 text-xs">
                {tag}
              </span>
            ))}
          </div>

          {/* Question */}
          <h2 className="text-xl font-bold text-white">{market.question}</h2>

          {/* Probability Display */}
          <div className="flex gap-4">
            <div className="flex-1 p-3 bg-green-500/10 border border-green-500/30 text-center">
              <span className="block text-2xl font-bold text-green-400">{Math.round(market.yesProbability * 100)}%</span>
              <span className="text-sm text-green-400/70">Yes</span>
            </div>
            <div className="flex-1 p-3 bg-red-500/10 border border-red-500/30 text-center">
              <span className="block text-2xl font-bold text-red-400">{Math.round(market.noProbability * 100)}%</span>
              <span className="text-sm text-red-400/70">No</span>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/10">
            <div className="text-center">
              <p className="text-2xl font-bold text-white">${formatNumber(market.volume)}</p>
              <p className="text-xs text-white/40">Total Volume</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-white">${formatNumber(market.liquidity)}</p>
              <p className="text-xs text-white/40">Liquidity</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-white">{daysUntilEnd > 0 ? daysUntilEnd : 0}</p>
              <p className="text-xs text-white/40">Days Left</p>
            </div>
          </div>

          {/* Action Button */}
          <a
            href={`https://polymarket.com/event/${market.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 bg-[#FF6B4A] text-white font-medium hover:bg-[#FF8F6B] transition-colors"
          >
            Trade on Polymarket
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

export default function MarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [priceHistories, setPriceHistories] = useState<Record<string, PriceHistory[]>>({});
  const [loadingHistories, setLoadingHistories] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [expandedMarket, setExpandedMarket] = useState<Market | null>(null);

  // Fetch all Yes/No markets (API handles pagination internally)
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

      // Fetch price history for top 5 markets by volume
      const top5 = allMarkets.slice(0, 5);
      top5.forEach((market: Market) => {
        if (market.tokenIds && market.tokenIds.length > 0) {
          fetchPriceHistory(market.id, market.tokenIds[0]);
        }
      });
    } catch (err) {
      console.error("Error fetching markets:", err);
      setError("Failed to load markets. Using mock data.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch price history for a market
  const fetchPriceHistory = async (marketId: string, tokenId: string) => {
    setLoadingHistories((prev) => ({ ...prev, [marketId]: true }));

    try {
      const response = await fetch(
        `/api/polymarket?action=price-history&tokenId=${tokenId}&interval=max`
      );

      if (response.ok) {
        const data = await response.json();
        setPriceHistories((prev) => ({
          ...prev,
          [marketId]: data.history || [],
        }));
      }
    } catch (err) {
      console.error(`Error fetching price history for ${marketId}:`, err);
    } finally {
      setLoadingHistories((prev) => ({ ...prev, [marketId]: false }));
    }
  };

  // Handle market expansion - load chart if not already loaded
  const handleExpandMarket = (market: Market) => {
    setExpandedMarket(market);
    // Load price history if not already loaded
    if (!priceHistories[market.id] && market.tokenIds?.length > 0) {
      fetchPriceHistory(market.id, market.tokenIds[0]);
    }
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
      <div className="flex items-center justify-between flex-shrink-0 px-4 py-3 bg-white/5 backdrop-blur-md border border-white/10">
        <div className="flex items-center gap-3">
          <div className="bg-[#FF6B4A]/20 p-2.5 ring-1 ring-[#FF6B4A]/40">
            <TrendingUp className="h-5 w-5 text-[#FF6B4A]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Markets</h1>
            <p className="text-sm text-white/50">
              Binary prediction markets from Polymarket • <span className="text-white/80">{markets.length}</span> active
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://polymarket.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-sm text-white/50 hover:text-white/80 transition-colors"
          >
            polymarket.com
            <ExternalLink className="h-4 w-4" />
          </a>

          <button
            onClick={() => fetchMarkets(selectedCategory)}
            disabled={isLoading}
            className={cn(
              "flex items-center gap-2 border bg-[#FF6B4A]/10 border-[#FF6B4A]/30 px-4 py-2 text-sm font-medium text-white transition-all",
              "hover:bg-[#FF6B4A]/20 hover:border-[#FF6B4A]/50 active:scale-95",
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
          <Filter className="h-4 w-4 text-white/40 flex-shrink-0" />
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => handleCategoryChange(cat.id)}
              className={cn(
                "px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all",
                selectedCategory === cat.id
                  ? "bg-[#FF6B4A] text-white"
                  : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/10"
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
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* Top 5 Volume Bar - scrolls with content */}
        {!isLoading && markets.length > 0 && (
          <div className="mb-4">
            <TopVolumeBar
              markets={markets}
              priceHistories={priceHistories}
              loadingHistories={loadingHistories}
              onMarketClick={handleExpandMarket}
            />
          </div>
        )}

        {/* Markets Grid */}
        {isLoading && markets.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="bg-white/5 border border-white/10 animate-pulse">
                <div className="h-28 bg-white/10" />
                <div className="p-3 space-y-2">
                  <div className="h-4 w-20 bg-white/10 rounded" />
                  <div className="h-8 bg-white/10 rounded" />
                  <div className="h-1.5 bg-white/10 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : markets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/50">
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
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-white/5 backdrop-blur-md border border-white/10 text-xs text-white/50">
        <span>Data from Polymarket Gamma API • Yes/No markets only</span>
        <a
          href="https://docs.polymarket.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[#FF6B4A] hover:text-[#FF8F6B] transition-colors"
        >
          API Docs <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Expanded Market Modal */}
      {expandedMarket && (
        <MarketModal
          market={expandedMarket}
          priceHistory={priceHistories[expandedMarket.id] || []}
          isLoadingHistory={loadingHistories[expandedMarket.id] || false}
          onClose={() => setExpandedMarket(null)}
        />
      )}
    </div>
  );
}
