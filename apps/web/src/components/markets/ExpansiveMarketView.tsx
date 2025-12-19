"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, ExternalLink, Move, Navigation, RotateCcw, TrendingUp, Clock, DollarSign, Users, ChevronRight, ArrowLeft } from "lucide-react";
import { Interactive3DChart } from "@/components/charts/Interactive3DChart";
import { OrderBook } from "./OrderBook";
import { cn, formatNumber } from "@/lib/utils";
import { useThemeStore } from "@/stores/themeStore";

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

type CameraMode = "orbit" | "fly" | "auto";

interface ExpansiveMarketViewProps {
  market: Market;
  priceHistories: Record<string, PriceHistory[]>;
  loadingHistories: Record<string, boolean>;
  onFetchPriceHistory: (tokenId: string, key: string) => void;
  onClose: () => void;
}

// Camera mode button component
function CameraModeButton({
  mode,
  currentMode,
  onClick,
  icon: Icon,
  label,
  isDark,
}: {
  mode: CameraMode;
  currentMode: CameraMode;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isDark: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 text-xs font-medium transition-all",
        currentMode === mode
          ? "bg-[#FF6B4A] text-white"
          : isDark
            ? "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/10"
            : "bg-black/5 text-gray-600 hover:bg-black/10 hover:text-gray-900 border border-black/10"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

// Stats card component
function StatCard({ label, value, icon: Icon, isDark }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; isDark: boolean }) {
  return (
    <div className={`flex items-center gap-3 p-3 border ${
      isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
    }`}>
      <div className="p-2 bg-[#FF6B4A]/10">
        <Icon className="h-4 w-4 text-[#FF6B4A]" />
      </div>
      <div>
        <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>{label}</p>
        <p className={`text-sm font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{value}</p>
      </div>
    </div>
  );
}

export function ExpansiveMarketView({
  market,
  priceHistories,
  loadingHistories,
  onFetchPriceHistory,
  onClose,
}: ExpansiveMarketViewProps) {
  const { isDark } = useThemeStore();
  const [selectedOutcomeIndex, setSelectedOutcomeIndex] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [mounted, setMounted] = useState(false);

  // Use portal to render outside the normal DOM hierarchy to avoid z-index issues
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const endDate = new Date(market.endDate);
  const daysUntilEnd = Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  // Fetch price history when outcome changes
  useEffect(() => {
    const tokenId = market.outcomeTokenIds[selectedOutcomeIndex];
    const key = `${market.id}-${selectedOutcomeIndex}`;
    if (tokenId && !priceHistories[key]) {
      onFetchPriceHistory(tokenId, key);
    }
  }, [selectedOutcomeIndex, market.id, market.outcomeTokenIds, priceHistories, onFetchPriceHistory]);

  const currentKey = `${market.id}-${selectedOutcomeIndex}`;
  const currentHistory = priceHistories[currentKey] || [];
  const isLoadingHistory = loadingHistories[currentKey] || false;
  const currentProbability = market.outcomeProbabilities[selectedOutcomeIndex];
  const currentOutcome = market.outcomes[selectedOutcomeIndex];
  const currentVolume = market.outcomeVolumes[selectedOutcomeIndex];

  // Don't render until mounted (for portal)
  if (!mounted) return null;

  const content = (
    <div className={`fixed inset-0 z-[9999] overflow-hidden ${isDark ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
      {/* Header - fixed height with solid background */}
      <div className={`h-16 flex items-center justify-between px-4 border-b relative z-30 ${
        isDark ? 'bg-[#0a0a0a] border-white/10' : 'bg-white border-black/10'
      }`}>
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <button
            onClick={onClose}
            className={`flex-shrink-0 p-2 border transition-colors ${
              isDark ? 'bg-white/5 hover:bg-white/10 border-white/10' : 'bg-black/5 hover:bg-black/10 border-black/10'
            }`}
          >
            <ArrowLeft className={`h-5 w-5 ${isDark ? 'text-white' : 'text-gray-900'}`} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              {market.category && (
                <span className="px-2 py-0.5 bg-[#FF6B4A]/10 text-[#FF6B4A] text-[10px] font-medium">
                  {market.category}
                </span>
              )}
              {market.isMultiOutcome && (
                <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-medium">
                  {market.outcomes.length} outcomes
                </span>
              )}
            </div>
            <h1 className={`text-base font-bold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{market.question}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          {/* Camera mode selector */}
          <div className={`hidden sm:flex items-center gap-1 p-1 border ${
            isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
          }`}>
            <CameraModeButton
              mode="auto"
              currentMode={cameraMode}
              onClick={() => setCameraMode("auto")}
              icon={RotateCcw}
              label="Auto"
              isDark={isDark}
            />
            <CameraModeButton
              mode="orbit"
              currentMode={cameraMode}
              onClick={() => setCameraMode("orbit")}
              icon={Move}
              label="Drag"
              isDark={isDark}
            />
            <CameraModeButton
              mode="fly"
              currentMode={cameraMode}
              onClick={() => setCameraMode("fly")}
              icon={Navigation}
              label="Fly"
              isDark={isDark}
            />
          </div>

          <a
            href={`https://polymarket.com/event/${market.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-[#FF6B4A] text-white text-xs font-medium hover:bg-[#FF8F6B] transition-colors"
          >
            Trade on Polymarket
            <ExternalLink className="h-3.5 w-3.5" />
          </a>

          <button
            onClick={onClose}
            className={`p-2 border transition-colors ${
              isDark ? 'bg-white/5 hover:bg-white/10 border-white/10' : 'bg-black/5 hover:bg-black/10 border-black/10'
            }`}
          >
            <X className={`h-5 w-5 ${isDark ? 'text-white' : 'text-gray-900'}`} />
          </button>
        </div>
      </div>

      {/* Camera mode hint */}
      {cameraMode === "orbit" && (
        <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 border text-[10px] ${
          isDark ? 'bg-black/90 border-white/20 text-white/70' : 'bg-white/90 border-black/20 text-gray-600'
        }`}>
          Drag to rotate • Scroll to zoom • Right-click to pan
        </div>
      )}
      {cameraMode === "fly" && (
        <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 border text-[10px] ${
          isDark ? 'bg-black/90 border-white/20 text-white/70' : 'bg-white/90 border-black/20 text-gray-600'
        }`}>
          WASD to move • Q/E for up/down • Mouse to look
        </div>
      )}

      {/* Main content - calc height minus header */}
      <div className="h-[calc(100%-4rem)] p-4 flex gap-4 overflow-hidden">
        {/* Left side - Chart */}
        <div className="flex-1 flex flex-col gap-4">
          {/* 3D Chart */}
          <div className={`flex-1 relative border overflow-hidden ${
            isDark ? 'border-white/10' : 'border-black/10'
          }`}>
            <Interactive3DChart
              data={currentHistory}
              isLoading={isLoadingHistory}
              currentProbability={currentProbability}
              cameraMode={cameraMode}
            />

            {/* Current outcome indicator */}
            <div className={`absolute bottom-4 left-4 p-3 backdrop-blur-sm border ${
              isDark ? 'bg-black/80 border-white/20' : 'bg-white/80 border-black/20'
            }`}>
              <div className={`text-xs mb-1 ${isDark ? 'text-white/50' : 'text-gray-500'}`}>Currently viewing</div>
              <div className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{currentOutcome}</div>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-2xl font-bold text-green-400">
                  {Math.round(currentProbability * 100)}%
                </span>
                <span className={`text-sm ${isDark ? 'text-white/40' : 'text-gray-400'}`}>Yes</span>
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Total Volume" value={`$${formatNumber(market.volume)}`} icon={DollarSign} isDark={isDark} />
            <StatCard label="Liquidity" value={`$${formatNumber(market.liquidity)}`} icon={TrendingUp} isDark={isDark} />
            <StatCard label="Days Left" value={daysUntilEnd > 0 ? `${daysUntilEnd}` : "Ended"} icon={Clock} isDark={isDark} />
            <StatCard label="Outcomes" value={market.outcomes.length.toString()} icon={Users} isDark={isDark} />
          </div>
        </div>

        {/* Right side - Order book and outcomes */}
        <div className="w-[350px] flex flex-col gap-4">
          {/* Outcomes selector (for multi-outcome markets) */}
          {market.isMultiOutcome && (
            <div className={`border max-h-[250px] overflow-hidden flex flex-col ${
              isDark ? 'bg-[#0a0a0a] border-white/10' : 'bg-white border-black/10'
            }`}>
              <div className={`px-4 py-3 border-b flex-shrink-0 ${
                isDark ? 'border-white/10' : 'border-black/10'
              }`}>
                <h3 className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Outcomes</h3>
              </div>
              <div className="overflow-y-auto flex-1">
                {market.outcomes.map((outcome, i) => {
                  const prob = market.outcomeProbabilities[i];
                  const isSelected = i === selectedOutcomeIndex;
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedOutcomeIndex(i)}
                      className={cn(
                        "w-full flex items-center justify-between p-3 border-b transition-colors",
                        isDark ? 'border-white/5' : 'border-black/5',
                        isSelected
                          ? "bg-[#FF6B4A]/10 border-l-2 border-l-[#FF6B4A]"
                          : isDark ? "hover:bg-white/5" : "hover:bg-black/5"
                      )}
                    >
                      <span className={cn(
                        "text-sm truncate max-w-[60%]",
                        isSelected
                          ? isDark ? "text-white font-medium" : "text-gray-900 font-medium"
                          : isDark ? "text-white/70" : "text-gray-600"
                      )}>
                        {outcome}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-sm font-bold",
                          isSelected ? "text-green-400" : isDark ? "text-white/50" : "text-gray-400"
                        )}>
                          {Math.round(prob * 100)}%
                        </span>
                        <ChevronRight className={cn(
                          "h-4 w-4",
                          isSelected ? "text-[#FF6B4A]" : isDark ? "text-white/30" : "text-gray-300"
                        )} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Order Book */}
          <div className="flex-1 min-h-0">
            <OrderBook
              yesProbability={currentProbability}
              volume={currentVolume}
              liquidity={market.liquidity}
              className="h-full"
            />
          </div>

          {/* Price indicators */}
          <div className="flex gap-2">
            <div className="flex-1 py-3 bg-green-500/10 border border-green-500/30 text-green-400 font-medium text-center">
              {Math.round(currentProbability * 100)}¢ Yes
            </div>
            <div className="flex-1 py-3 bg-red-500/10 border border-red-500/30 text-red-400 font-medium text-center">
              {Math.round((1 - currentProbability) * 100)}¢ No
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Use portal to render at document.body level, escaping any stacking context issues
  return createPortal(content, document.body);
}
