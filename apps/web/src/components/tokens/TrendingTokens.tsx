"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { formatPrice, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Flame, TrendingUp, TrendingDown } from "lucide-react";
import { useTokenStore, type Token } from "@/stores/tokenStore";
import { useThemeStore } from "@/stores/themeStore";
import type { OHLCV } from "@/stores/chartStore";

// API calls go through Next.js proxy routes (protects internal API key)

// Token logo overrides - use local images for specific tokens
const TOKEN_LOGO_OVERRIDES: Record<string, string> = {
  "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn": "/pump-logo.jpg", // PUMP
};

// Convert IPFS URLs to use a more reliable gateway
function getReliableImageUrl(url: string | null | undefined, tokenAddress?: string): string | null {
  // Check for token-specific override first
  if (tokenAddress && TOKEN_LOGO_OVERRIDES[tokenAddress]) {
    return TOKEN_LOGO_OVERRIDES[tokenAddress];
  }
  if (!url) return null;
  // Replace ipfs.io with dweb.link which is more reliable
  if (url.includes("ipfs.io/ipfs/")) {
    return url.replace("ipfs.io/ipfs/", "dweb.link/ipfs/");
  }
  return url;
}

// Dynamic import for mini 3D chart
const Mini3DChart = dynamic(
  () => import("@/components/charts/Mini3DChart").then((mod) => mod.Mini3DChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full flex items-center justify-center bg-black/30">
        <div className="h-3 w-3 animate-spin rounded-full border border-white/40 border-t-transparent" />
      </div>
    ),
  }
);

// Individual trending token card - lazy loads 3D chart only when visible
function TrendingTokenCard({ token, index, isVisible }: { token: Token; index: number; isVisible: boolean }) {
  const { isDark } = useThemeStore();
  const [ohlcv, setOhlcv] = useState<OHLCV[]>([]);
  const [isLoadingOhlcv, setIsLoadingOhlcv] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [imageError, setImageError] = useState(false);
  const isPositive = (token.priceChange24h ?? 0) >= 0;
  const imageUrl = getReliableImageUrl(token.logoUri, token.address);

  // Only fetch OHLCV when card becomes visible (and only once)
  useEffect(() => {
    if (!isVisible || hasFetched) return;

    const fetchOhlcv = async () => {
      setIsLoadingOhlcv(true);
      setHasFetched(true);
      try {
        // Fetch 1-minute candles for the preview chart (24 hours)
        const response = await fetch(
          `/api/tokens/${token.address}/ohlcv?timeframe=1m&limit=1000`
        );
        if (response.ok) {
          const data = await response.json();
          setOhlcv(data);
        }
      } catch (error) {
        console.error("Failed to fetch OHLCV:", error);
      } finally {
        setIsLoadingOhlcv(false);
      }
    };

    fetchOhlcv();
  }, [token.address, isVisible, hasFetched]);

  return (
    <Link
      href={`/token/${token.address}`}
      className={`group flex min-w-[280px] flex-col gap-2 border p-3 transition-all hover:bg-[#FF6B4A]/10 hover:border-[#FF6B4A]/30 ${
        isDark
          ? 'border-white/5 bg-white/5'
          : 'border-black/10 bg-white'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`text-lg font-bold ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
          #{index + 1}
        </span>
        <div className={`relative h-8 w-8 overflow-hidden rounded-full ring-2 ${
          isDark ? 'bg-white/5 ring-white/10' : 'bg-black/5 ring-black/10'
        }`}>
          {imageUrl && !imageError ? (
            <Image
              src={imageUrl}
              alt={token.symbol}
              fill
              className="object-cover"
              unoptimized
              onError={() => setImageError(true)}
            />
          ) : (
            <div className={`flex h-full w-full items-center justify-center text-sm font-bold bg-gradient-to-br ${
              isDark ? 'text-white/40 from-white/10 to-white/5' : 'text-black/40 from-black/10 to-black/5'
            }`}>
              {token.symbol.charAt(0)}
            </div>
          )}
        </div>
        <div className="flex-1">
          <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{token.symbol}</p>
          <div className="flex items-center gap-2">
            <span className={`text-sm ${isDark ? 'text-white/60' : 'text-gray-600'}`}>${formatPrice(token.price ?? 0)}</span>
            <span
              className={cn(
                "flex items-center gap-0.5 text-xs font-medium",
                isPositive ? "text-up" : "text-down"
              )}
            >
              {isPositive ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {formatPercent(token.priceChange24h ?? 0)}
            </span>
          </div>
        </div>
      </div>

      {/* Mini 3D Chart - only renders when visible to save WebGL contexts */}
      <div className={`h-20 w-full overflow-hidden ${isDark ? 'bg-black/30' : 'bg-gray-100'}`}>
        {isVisible ? (
          <Mini3DChart
            data={ohlcv}
            isLoading={isLoadingOhlcv}
            currentMarketCap={token.marketCap}
          />
        ) : (
          <div className={`h-full w-full flex items-center justify-center text-xs ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
            Scroll to view
          </div>
        )}
      </div>
    </Link>
  );
}

// Only these tokens should appear (whitelist)
const allowedTokens = ["sol", "mon", "weth", "trump", "wbtc", "zec", "met", "pump", "wojak", "useless", "pengu", "jup"];

export function TrendingTokens() {
  const { isDark } = useThemeStore();
  const { tokens } = useTokenStore();
  const containerRef = useRef<HTMLDivElement>(null);
  // Start as true since trending is at top of page and visible on load
  const [isVisible, setIsVisible] = useState(true);

  // Use IntersectionObserver to unload charts when user scrolls away
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 } // Trigger when 10% visible
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Get top 3 by 24h volume, only whitelisted tokens (limited to save WebGL contexts)
  const trending = [...tokens]
    .filter((token) => allowedTokens.includes(token.symbol.toLowerCase()))
    .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
    .slice(0, 3);

  if (trending.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className={`border overflow-hidden card-shine ${
      isDark ? 'border-white/5 bg-[#111]' : 'border-black/10 bg-white'
    }`}>
      {/* Header matching landing page style */}
      <div className={`flex items-center gap-3 px-4 py-3 border-b bg-gradient-to-r to-transparent ${
        isDark ? 'border-white/5 from-white/5' : 'border-black/5 from-black/5'
      }`}>
        <div className="p-2 bg-[#FF6B4A]/20">
          <Flame className="h-5 w-5 text-[#FF6B4A]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>Trending Now</h3>
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              isDark ? 'text-white/40 bg-white/5' : 'text-gray-500 bg-black/5'
            }`}>
              {trending.length}
            </span>
          </div>
          <p className={`text-xs truncate ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Top performers by volume</p>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto p-4">
        {trending.map((token, index) => (
          <TrendingTokenCard key={token.address} token={token} index={index} isVisible={isVisible} />
        ))}
      </div>
    </div>
  );
}
