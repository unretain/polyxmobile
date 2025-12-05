"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatPrice, formatNumber, formatPercent, shortenAddress } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";
import type { Token } from "@/stores/tokenStore";
import type { OHLCV } from "@/stores/chartStore";
import { Mini3DChart } from "@/components/charts/Mini3DChart";
import { useThemeStore } from "@/stores/themeStore";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// Convert IPFS URLs to use a more reliable gateway
function getReliableImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // Replace ipfs.io with dweb.link which is more reliable
  if (url.includes("ipfs.io/ipfs/")) {
    return url.replace("ipfs.io/ipfs/", "dweb.link/ipfs/");
  }
  return url;
}

interface TokenCardProps {
  token: Token;
}

export function TokenCard({ token }: TokenCardProps) {
  const { isDark } = useThemeStore();
  const [ohlcv, setOhlcv] = useState<OHLCV[]>([]);
  const [isLoadingOhlcv, setIsLoadingOhlcv] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [dataFetched, setDataFetched] = useState(false);
  const [imageError, setImageError] = useState(false);
  const cardRef = useRef<HTMLAnchorElement>(null);
  const isPositive = (token.priceChange24h ?? 0) >= 0;
  const imageUrl = getReliableImageUrl(token.logoUri);

  // Use IntersectionObserver to track visibility for WebGL context management
  useEffect(() => {
    const element = cardRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0, rootMargin: "100px" }
    );

    observer.observe(element);

    // Check immediately if already in viewport on mount
    const rect = element.getBoundingClientRect();
    const isInViewport = rect.top < window.innerHeight + 100 && rect.bottom > -100;
    if (isInViewport) {
      setIsVisible(true);
    }

    return () => observer.disconnect();
  }, []);

  // Fetch OHLCV data once when first visible (data persists even when not visible)
  useEffect(() => {
    if (!isVisible || dataFetched) return;

    const fetchOhlcv = async () => {
      setIsLoadingOhlcv(true);
      setDataFetched(true);
      try {
        const to = Math.floor(Date.now() / 1000);
        const from = to - 3600; // 1 hour of data
        const response = await fetch(
          `${API_URL}/api/tokens/${token.address}/ohlcv?timeframe=1m&from=${from}&to=${to}&limit=60`
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
  }, [token.address, isVisible, dataFetched]);

  return (
    <Link
      ref={cardRef}
      href={`/token/${token.address}`}
      className={`group flex flex-col gap-3 border p-4 transition-all hover:border-[#FF6B4A]/30 hover:bg-[#FF6B4A]/5 card-shine ${
        isDark
          ? 'border-white/5 bg-[#111]'
          : 'border-black/10 bg-white'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`relative h-10 w-10 overflow-hidden rounded-full ring-2 ${
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
              <div className={`flex h-full w-full items-center justify-center text-lg font-bold bg-gradient-to-br ${
                isDark ? 'text-white/40 from-white/10 to-white/5' : 'text-black/40 from-black/10 to-black/5'
              }`}>
                {token.symbol.charAt(0)}
              </div>
            )}
          </div>
          <div>
            <h3 className={`font-semibold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{token.symbol}</h3>
            <p className={`text-xs truncate max-w-[100px] ${isDark ? 'text-white/40' : 'text-gray-500'}`}>{token.name}</p>
          </div>
        </div>
        <ExternalLink className={`h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100 group-hover:text-[#FF6B4A] ${
          isDark ? 'text-white/20' : 'text-black/20'
        }`} />
      </div>

      {/* Mini 3D Chart - only renders when visible to save WebGL contexts */}
      <div className={`h-24 w-full overflow-hidden ${isDark ? 'bg-black/30' : 'bg-gray-100'}`}>
        {isVisible ? (
          <Mini3DChart
            data={ohlcv}
            isLoading={isLoadingOhlcv}
            currentMarketCap={token.marketCap}
          />
        ) : (
          <div className={`h-full w-full flex items-center justify-center text-xs ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
            Loading...
          </div>
        )}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>${formatPrice(token.price ?? 0)}</p>
          <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
            MC: ${formatNumber(token.marketCap ?? 0)}
          </p>
        </div>
        <div
          className={cn(
            "text-xs font-semibold px-2 py-1",
            isPositive ? "text-up bg-up/15" : "text-down bg-down/15"
          )}
        >
          {formatPercent(token.priceChange24h ?? 0)}
        </div>
      </div>

      <div className={`flex items-center justify-between border-t pt-3 text-xs ${
        isDark ? 'border-white/5 text-white/40' : 'border-black/5 text-gray-500'
      }`}>
        <span>Vol: ${formatNumber(token.volume24h ?? 0)}</span>
        <span>{shortenAddress(token.address)}</span>
      </div>
    </Link>
  );
}
