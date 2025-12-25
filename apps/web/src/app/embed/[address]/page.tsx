"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";

// Dynamic import for Chart3D - only loads after license validation
const Chart3D = dynamic(
  () => import("@/components/charts/Chart3D").then((mod) => mod.Chart3D),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-[#0a0a0a]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
      </div>
    ),
  }
);

// API calls go through Next.js proxy routes (protects internal API key)

// Available timeframes
const TIMEFRAMES = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
];

interface OHLCVCandle {
  open: number;
  high: number;
  close: number;
  low: number;
  volume: number;
  timestamp: number;
}

interface TokenData {
  address: string;
  symbol: string;
  name: string;
  price: number;
  priceChange24h?: number;
  marketCap?: number;
}

interface LicenseInfo {
  valid: boolean;
  plan: "FREE" | "PRO" | "BUSINESS";
  features: {
    watermark: boolean;
    whiteLabel: boolean;
    timeframeSelector?: boolean;
  };
  domain: string;
}

export default function EmbedPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const address = params.address as string;

  // Parse query params
  const theme = searchParams.get("theme") || "dark";
  const initialTimeframe = searchParams.get("timeframe") || "1h";
  const showHeader = searchParams.get("header") !== "false";
  const licenseKey = searchParams.get("license") || "";

  // Timeframe state - Free users must specify in URL, Pro/Business can switch
  const [currentTimeframe, setCurrentTimeframe] = useState(initialTimeframe);
  const [candles, setCandles] = useState<OHLCVCandle[]>([]);
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [licenseChecked, setLicenseChecked] = useState(false);
  const [license, setLicense] = useState<LicenseInfo>({
    valid: false,
    plan: "FREE",
    features: { watermark: true, whiteLabel: false, timeframeSelector: false },
    domain: "unknown",
  });

  const isDark = theme === "dark";

  // Pro/Business users can change timeframe
  const canChangeTimeframe = license.plan === "PRO" || license.plan === "BUSINESS";

  // Handle timeframe change
  const handleTimeframeChange = useCallback((newTimeframe: string) => {
    if (!canChangeTimeframe) return;
    setCurrentTimeframe(newTimeframe);
  }, [canChangeTimeframe]);

  // Validate license on mount - this is the KEY security check
  useEffect(() => {
    const validateLicense = async () => {
      try {
        const response = await fetch("/api/embed/license", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            licenseKey,
            domain: document.referrer ? new URL(document.referrer).hostname : window.location.hostname,
          }),
        });

        const data = await response.json();

        setLicense({
          valid: data.valid !== false,
          plan: data.plan || "FREE",
          features: {
            watermark: data.features?.watermark ?? true,
            whiteLabel: data.features?.whiteLabel ?? false,
            timeframeSelector: data.plan !== "FREE",
          },
          domain: data.domain || "unknown",
        });
      } catch (err) {
        console.error("License validation failed:", err);
        // Default to free tier with watermark on error
        setLicense({
          valid: true, // Allow but with watermark
          plan: "FREE",
          features: { watermark: true, whiteLabel: false, timeframeSelector: false },
          domain: "unknown",
        });
      } finally {
        setLicenseChecked(true);
      }
    };

    validateLicense();
  }, [licenseKey]);

  // Fetch token data and OHLCV only after license is validated
  useEffect(() => {
    if (!address || !licenseChecked) return;

    setIsLoading(true);
    setError(null);

    // Fetch token info (uses Next.js proxy route)
    fetch(`/api/tokens/${address}`)
      .then((res) => {
        if (!res.ok) throw new Error("Token not found");
        return res.json();
      })
      .then((data) => {
        setTokenData({
          address: data.address || address,
          symbol: data.symbol || "???",
          name: data.name || "Unknown Token",
          price: data.price || 0,
          priceChange24h: data.priceChange24h,
          marketCap: data.marketCap,
        });
      })
      .catch((err) => {
        console.error("Token fetch error:", err);
      });

    // Fetch OHLCV (uses Next.js proxy route)
    fetch(`/api/tokens/${address}/ohlcv?timeframe=${currentTimeframe}&limit=100`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch chart data");
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setCandles(data);
        } else {
          setError("No chart data available for this token");
        }
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("OHLCV fetch error:", err);
        setError("Failed to load chart data");
        setIsLoading(false);
      });
  }, [address, currentTimeframe, licenseChecked]);

  // Auto-refresh data every 30 seconds
  useEffect(() => {
    if (!licenseChecked) return;

    const interval = setInterval(() => {
      if (!address) return;

      fetch(`/api/tokens/${address}/ohlcv?timeframe=${currentTimeframe}&limit=100`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            setCandles(data);
          }
        })
        .catch(() => {});

      fetch(`/api/tokens/${address}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.price) {
            setTokenData((prev) => prev ? { ...prev, price: data.price } : null);
          }
        })
        .catch(() => {});
    }, 30000);

    return () => clearInterval(interval);
  }, [address, currentTimeframe, licenseChecked]);

  // Show loading while checking license
  if (!licenseChecked) {
    return (
      <div className={`h-screen w-screen flex items-center justify-center ${isDark ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent mx-auto mb-4" />
          <p className={`text-sm ${isDark ? 'text-white/40' : 'text-gray-400'}`}>Validating...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !isLoading && candles.length === 0) {
    return (
      <div className={`h-screen w-screen flex items-center justify-center ${isDark ? 'bg-[#0a0a0a] text-white' : 'bg-gray-50 text-gray-900'}`}>
        <div className="text-center p-8">
          <div className="text-4xl mb-4">📊</div>
          <h2 className="text-xl font-bold mb-2">Chart Unavailable</h2>
          <p className={`text-sm ${isDark ? 'text-white/60' : 'text-gray-600'}`}>{error}</p>
          <p className={`text-xs mt-4 font-mono ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{address}</p>
        </div>
      </div>
    );
  }

  const showWatermark = license.features.watermark;
  const showBranding = license.plan === "FREE" || license.features.watermark;

  // Calculate heights
  const headerHeight = showHeader && tokenData ? 56 : 0; // ~56px for header
  const footerHeight = showBranding ? 36 : 0; // ~36px for footer

  return (
    <div
      className={`h-screen w-screen flex flex-col overflow-hidden ${isDark ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}
    >
      {/* Optional header with token info */}
      {showHeader && tokenData && (
        <div
          className={`flex-shrink-0 flex items-center justify-between px-4 py-3 border-b ${
            isDark ? 'border-white/10' : 'border-black/10'
          }`}
          style={{ height: headerHeight }}
        >
          <div className="flex items-center gap-3">
            <div>
              <div className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {tokenData.symbol}
              </div>
              <div className={`text-xs ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
                {tokenData.name}
              </div>
            </div>
          </div>

          {/* Timeframe selector - only for Pro/Business */}
          {canChangeTimeframe && (
            <div className="flex items-center gap-1">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.value}
                  onClick={() => handleTimeframeChange(tf.value)}
                  className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                    currentTimeframe === tf.value
                      ? 'bg-[#FF6B4A] text-white'
                      : isDark
                        ? 'text-white/60 hover:text-white hover:bg-white/10'
                        : 'text-gray-500 hover:text-gray-900 hover:bg-black/5'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          )}

          <div className="text-right">
            <div className={`text-lg font-bold font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
              ${tokenData.price?.toFixed(tokenData.price < 0.01 ? 6 : 2)}
            </div>
            {tokenData.priceChange24h !== undefined && (
              <div className={`text-xs font-mono ${
                tokenData.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {tokenData.priceChange24h >= 0 ? '+' : ''}{tokenData.priceChange24h.toFixed(2)}%
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chart - takes remaining space */}
      <div
        className="flex-1 relative min-h-0"
        style={{ height: `calc(100vh - ${headerHeight + footerHeight}px)` }}
      >
        {candles.length > 0 ? (
          <Chart3D
            data={candles}
            isLoading={isLoading}
            price={tokenData?.price}
            showDrawingTools={license.plan === "PRO" || license.plan === "BUSINESS"}
            showWatermark={showWatermark}
          />
        ) : (
          <div className={`w-full h-full flex items-center justify-center ${isDark ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
          </div>
        )}
      </div>

      {/* Powered by badge - always shown for free, removable for paid */}
      {showBranding && (
        <div
          className={`flex-shrink-0 flex items-center justify-center py-2 border-t ${
            isDark ? 'border-white/10' : 'border-black/10'
          }`}
          style={{ height: footerHeight }}
        >
          <a
            href="https://polyx.xyz/solutions"
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-1.5 text-xs transition-colors ${
              isDark ? 'text-white/40 hover:text-white/60' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            Powered by
            <span className="font-medium">[poly<span className="text-[#FF6B4A]">x</span>]</span>
            {license.plan === "FREE" && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-[#FF6B4A]/10 text-[#FF6B4A]">
                Get Pro - No Watermark
              </span>
            )}
          </a>
        </div>
      )}
    </div>
  );
}
