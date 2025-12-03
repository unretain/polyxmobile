"use client";

import { useEffect, useCallback, useRef, useState, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, Zap, RefreshCw, Copy, ExternalLink, TrendingUp, Search, X } from "lucide-react";
import { formatNumber, formatPercent, shortenAddress, cn } from "@/lib/utils";
import { usePulseStore, type PulseToken } from "@/stores/pulseStore";

// Pump.fun tokens have 1 billion supply
const PUMP_FUN_SUPPLY = 1_000_000_000;

// Format market cap for display
function formatMC(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

// Time ago helper
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// Bonding curve progress (0-100%)
function getBondingProgress(marketCap: number): number {
  // Pump.fun graduation threshold is ~$69k market cap
  const graduationMC = 69000;
  return Math.min(100, (marketCap / graduationMC) * 100);
}

// Token Row Component - Compact row for the table
interface TokenRowProps {
  token: PulseToken;
  showProgress?: boolean;
}

function TokenRow({ token, showProgress = false }: TokenRowProps) {
  const progress = getBondingProgress(token.marketCap);
  const isPositive = token.priceChange24h >= 0;

  const copyAddress = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(token.address);
  };

  return (
    <Link
      href={`/token/${token.address}?source=pulse`}
      className={cn(
        "group flex items-center gap-2 px-3 py-2.5 transition-all",
        "hover:bg-[#FF6B4A]/10 border border-transparent hover:border-[#FF6B4A]/30",
        "cursor-pointer"
      )}
    >
      {/* Token Logo */}
      <div className="relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-white/5 ring-2 ring-white/10">
        {token.logoUri ? (
          <Image src={token.logoUri} alt={token.symbol} fill className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm font-bold text-white/40 bg-gradient-to-br from-[#FF6B4A]/20 to-white/5">
            {token.symbol?.charAt(0) ?? "?"}
          </div>
        )}
      </div>

      {/* Token Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-sm truncate text-white">{token.symbol}</span>
          <span className="text-xs text-white/40 truncate max-w-[80px]">{token.name}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/40">
          <span className="font-medium">{formatMC(token.marketCap)}</span>
          <span>•</span>
          <span>{timeAgo(token.createdAt)}</span>
          {showProgress && (
            <>
              <span>•</span>
              <span className="text-white/60">{progress.toFixed(0)}%</span>
            </>
          )}
        </div>
      </div>

      {/* Price Change - shows % gain from pump.fun starting MC (~$4K) */}
      <div className={cn(
        "text-xs font-semibold px-2 py-1",
        isPositive ? "text-up bg-up/15" : "text-down bg-down/15"
      )}>
        {formatPercent(token.priceChange24h)}
      </div>

      {/* Quick Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={copyAddress}
          className="p-1.5 hover:bg-white/10 transition-colors text-white/60"
          title="Copy address"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          className="p-1.5 bg-[#FF6B4A]/20 hover:bg-[#FF6B4A]/30 text-[#FF6B4A] transition-colors"
          title="Quick buy"
        >
          <Zap className="h-3.5 w-3.5" />
        </button>
      </div>
    </Link>
  );
}

// Column Component - One of the three main columns
interface TokenColumnProps {
  title: string;
  subtitle: string;
  tokens: PulseToken[];
  emptyMessage: string;
  showProgress?: boolean;
  accentColor?: string;
}

function TokenColumn({ title, subtitle, tokens, emptyMessage, showProgress }: TokenColumnProps) {
  return (
    <div className="flex flex-col h-full border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden">
      {/* Column Header */}
      <div className={cn(
        "flex items-center gap-3 px-4 py-3 border-b border-white/10",
        "bg-gradient-to-r from-white/10 to-transparent"
      )}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm text-[#FF6B4A]">[{title.toLowerCase()}]</h3>
            <span className="text-xs text-white/40 bg-white/5 px-1.5 py-0.5 rounded-full">
              {tokens.length}
            </span>
          </div>
          <p className="text-xs text-white/50 truncate">{subtitle}</p>
        </div>
      </div>

      {/* Token List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {tokens.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-white/40">
            <Activity className="h-8 w-8 mb-2 opacity-40" />
            <span className="text-xs">{emptyMessage}</span>
          </div>
        ) : (
          tokens.map((token) => (
            <TokenRow key={token.address} token={token} showProgress={showProgress} />
          ))
        )}
      </div>
    </div>
  );
}

export default function PulsePage() {
  const router = useRouter();
  const {
    newPairs,
    graduatingPairs,
    graduatedPairs,
    isLoading,
    error,
    isRealtime,
    fetchAllPairs,
    connectRealtime,
    disconnectRealtime,
  } = usePulseStore();

  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [searchHistory, setSearchHistory] = useState<PulseToken[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load search history from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("pulse-search-history");
    if (saved) {
      try {
        setSearchHistory(JSON.parse(saved));
      } catch {}
    }
  }, []);

  // Validate Solana address (base58, 32-44 chars)
  const isValidSolanaAddress = (address: string): boolean => {
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58Regex.test(address);
  };

  // Open search modal
  const openSearch = () => {
    setIsSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  // Close search modal
  const closeSearch = () => {
    setIsSearchOpen(false);
    setSearchValue("");
  };

  // Handle keyboard shortcut (Esc to close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isSearchOpen) {
        closeSearch();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSearchOpen]);

  // Filter tokens based on search - search by name, symbol, or address
  const filteredTokens = useMemo(() => {
    const allTokens = [...newPairs, ...graduatingPairs, ...graduatedPairs];

    // If no search, show nothing (history will show instead)
    if (!searchValue.trim()) return [];

    const query = searchValue.toLowerCase().trim();

    // If it looks like an address, filter by address
    if (query.length > 20) {
      return allTokens.filter(t => t.address.toLowerCase().includes(query));
    }

    // Otherwise filter by name or symbol
    return allTokens.filter(t =>
      t.symbol.toLowerCase().includes(query) ||
      t.name.toLowerCase().includes(query)
    ).slice(0, 20);
  }, [searchValue, newPairs, graduatingPairs, graduatedPairs]);

  // Add token to search history
  const addToHistory = (token: PulseToken) => {
    const newHistory = [token, ...searchHistory.filter(t => t.address !== token.address)].slice(0, 10);
    setSearchHistory(newHistory);
    localStorage.setItem("pulse-search-history", JSON.stringify(newHistory));
  };

  // Navigate to token
  const goToToken = (address: string, token?: PulseToken) => {
    // Add to history if we have the token data
    if (token) {
      addToHistory(token);
    }
    closeSearch();
    router.push(`/token/${address}?source=pulse`);
  };

  // Clear search history
  const clearHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem("pulse-search-history");
  };

  // Fetch all pairs on mount and connect to real-time
  useEffect(() => {
    fetchAllPairs();
    connectRealtime();

    return () => {
      disconnectRealtime();
    };
  }, [fetchAllPairs, connectRealtime, disconnectRealtime]);

  // Refresh pairs every 5 seconds
  useEffect(() => {
    refreshIntervalRef.current = setInterval(() => {
      fetchAllPairs();
    }, 5000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [fetchAllPairs]);

  const totalTokens = newPairs.length + graduatingPairs.length + graduatedPairs.length;

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 px-4 py-3 bg-white/5 backdrop-blur-md border border-white/10">
        <div className="flex items-center gap-3">
          <div className="bg-[#FF6B4A]/20 p-2.5 ring-1 ring-[#FF6B4A]/40">
            <Activity className="h-5 w-5 text-[#FF6B4A]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Pulse</h1>
            <p className="text-sm text-white/50">
              Real-time pump.fun token discovery • <span className="text-white/80">{totalTokens}</span> tokens
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Search Button */}
          <button
            onClick={openSearch}
            className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-2 text-sm text-white/50 hover:bg-white/10 hover:border-[#FF6B4A]/30 transition-all"
          >
            <Search className="h-4 w-4" />
            <span>Search by name, ticker, or CA...</span>
            <kbd className="ml-2 px-1.5 py-0.5 text-xs bg-white/10 text-white/40">Esc</kbd>
          </button>

          {/* Real-time indicator */}
          <div className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium backdrop-blur-sm",
            isRealtime ? "bg-up/15 text-up ring-1 ring-up/40" : "bg-white/10 text-white/50"
          )}>
            <span className={cn(
              "h-2 w-2 rounded-full",
              isRealtime ? "bg-up animate-pulse" : "bg-white/40"
            )} />
            {isRealtime ? "Live" : "Polling"}
          </div>

          <button
            onClick={() => fetchAllPairs()}
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

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400 flex-shrink-0">
          {error}
        </div>
      )}

      {/* Three Column Layout */}
      <div className="flex-1 grid grid-cols-3 gap-4 min-h-0">
        {/* Column 1: New Pairs */}
        <TokenColumn
          title="New Pairs"
          subtitle="Just launched on pump.fun"
          tokens={newPairs}
          emptyMessage="Waiting for new tokens..."
        />

        {/* Column 2: Final Stretch */}
        <TokenColumn
          title="Final Stretch"
          subtitle="Near bonding curve completion"
          tokens={graduatingPairs}
          emptyMessage="No tokens graduating..."
          showProgress
        />

        {/* Column 3: Migrated */}
        <TokenColumn
          title="Migrated"
          subtitle="Graduated to Raydium/PumpSwap"
          tokens={graduatedPairs}
          emptyMessage="No migrated tokens yet..."
        />
      </div>

      {/* Footer Stats */}
      <div className="flex items-center justify-between px-4 py-3 bg-white/5 backdrop-blur-md border border-white/10 text-xs text-white/50 flex-shrink-0">
        <div className="flex items-center gap-4">
          <span>
            <strong className="text-white/80">{newPairs.length}</strong> new pairs
          </span>
          <span>
            <strong className="text-white/80">{graduatingPairs.length}</strong> graduating
          </span>
          <span>
            <strong className="text-white/80">{graduatedPairs.length}</strong> migrated
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>Data from Moralis + PumpPortal</span>
          <a
            href="https://docs.axiom.trade/axiom/finding-tokens/pulse"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[#FF6B4A] hover:text-[#FF8F6B] transition-colors"
          >
            Inspired by Axiom <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Search Modal */}
      {isSearchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeSearch}
          />

          {/* Modal */}
          <div className="relative w-full max-w-2xl bg-[#111] border border-white/10 shadow-2xl">
            {/* Search Header */}
            <div className="flex items-center gap-3 p-4 border-b border-white/10">
              <Search className="h-5 w-5 text-white/40" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (filteredTokens.length > 0) {
                      goToToken(filteredTokens[0].address, filteredTokens[0]);
                    } else if (isValidSolanaAddress(searchValue.trim())) {
                      goToToken(searchValue.trim());
                    }
                  }
                }}
                placeholder="Search by name, ticker, or CA..."
                className="flex-1 bg-transparent text-lg text-white placeholder-white/40 outline-none"
                autoFocus
              />
              <kbd className="px-2 py-1 text-xs bg-white/10 text-white/50 border border-white/10">
                Esc
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-[60vh] overflow-y-auto">
              {/* Show history when no search query */}
              {!searchValue.trim() && (
                <div className="py-2">
                  {searchHistory.length > 0 ? (
                    <>
                      <div className="px-4 py-2 flex items-center justify-between">
                        <span className="text-xs text-white/40 uppercase tracking-wide">History</span>
                        <button
                          onClick={clearHistory}
                          className="text-xs text-white/40 hover:text-white/60 transition-colors"
                        >
                          Clear
                        </button>
                      </div>
                      {searchHistory.map((token) => (
                        <button
                          key={token.address}
                          onClick={() => goToToken(token.address, token)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FF6B4A]/10 transition-colors text-left"
                        >
                          <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-white/5 ring-2 ring-white/10">
                            {token.logoUri ? (
                              <Image src={token.logoUri} alt={token.symbol} fill className="object-cover" unoptimized />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-sm font-bold text-white/40 bg-gradient-to-br from-[#FF6B4A]/20 to-white/5">
                                {token.symbol?.charAt(0) ?? "?"}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white">{token.symbol}</span>
                              <span className="text-sm text-white/40 truncate">{token.name}</span>
                            </div>
                            <div className="text-xs text-white/40">{timeAgo(token.createdAt)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-white/40 text-xs">MC</div>
                            <div className="text-white font-medium">{formatMC(token.marketCap)}</div>
                          </div>
                          <div className={cn(
                            "px-2 py-1 text-xs font-semibold",
                            token.priceChange24h >= 0 ? "text-up bg-up/15" : "text-down bg-down/15"
                          )}>
                            {formatPercent(token.priceChange24h)}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); }}
                            className="p-2 bg-[#FF6B4A]/20 hover:bg-[#FF6B4A]/30 text-[#FF6B4A] transition-colors"
                          >
                            <Zap className="h-4 w-4" />
                          </button>
                        </button>
                      ))}
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-white/40">
                      <Search className="h-10 w-10 mb-3 opacity-40" />
                      <span className="text-sm">Search by name, ticker, or paste a contract address</span>
                    </div>
                  )}
                </div>
              )}

              {/* Show search results */}
              {searchValue.trim() && filteredTokens.length > 0 && (
                <div className="py-2">
                  <div className="px-4 py-2 text-xs text-white/40 uppercase tracking-wide">
                    Results
                  </div>
                  {filteredTokens.map((token) => (
                    <button
                      key={token.address}
                      onClick={() => goToToken(token.address, token)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FF6B4A]/10 transition-colors text-left"
                    >
                      <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-white/5 ring-2 ring-white/10">
                        {token.logoUri ? (
                          <Image src={token.logoUri} alt={token.symbol} fill className="object-cover" unoptimized />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-sm font-bold text-white/40 bg-gradient-to-br from-[#FF6B4A]/20 to-white/5">
                            {token.symbol?.charAt(0) ?? "?"}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{token.symbol}</span>
                          <span className="text-sm text-white/40 truncate">{token.name}</span>
                        </div>
                        <div className="text-xs text-white/40">{timeAgo(token.createdAt)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-white/40 text-xs">MC</div>
                        <div className="text-white font-medium">{formatMC(token.marketCap)}</div>
                      </div>
                      <div className={cn(
                        "px-2 py-1 text-xs font-semibold",
                        token.priceChange24h >= 0 ? "text-up bg-up/15" : "text-down bg-down/15"
                      )}>
                        {formatPercent(token.priceChange24h)}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); }}
                        className="p-2 bg-[#FF6B4A]/20 hover:bg-[#FF6B4A]/30 text-[#FF6B4A] transition-colors"
                      >
                        <Zap className="h-4 w-4" />
                      </button>
                    </button>
                  ))}
                </div>
              )}

              {/* Show "go to address" when valid address but no results */}
              {searchValue.trim() && filteredTokens.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-white/40">
                  {isValidSolanaAddress(searchValue.trim()) ? (
                    <>
                      <span className="text-sm mb-4">No matching tokens in Pulse</span>
                      <button
                        onClick={() => goToToken(searchValue.trim())}
                        className="px-4 py-2 bg-[#FF6B4A]/20 border border-[#FF6B4A]/30 text-[#FF6B4A] text-sm hover:bg-[#FF6B4A]/30 transition-colors"
                      >
                        Go to {shortenAddress(searchValue.trim())} →
                      </button>
                    </>
                  ) : (
                    <>
                      <Search className="h-10 w-10 mb-3 opacity-40" />
                      <span className="text-sm">No tokens found for "{searchValue}"</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
