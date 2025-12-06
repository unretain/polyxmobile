"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Copy, Check, Code, ExternalLink, Zap, Box, Palette, Settings, ChevronRight, Sun, Moon, Play, Pause, Sparkles, Building, Crown, X, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useThemeStore } from "@/stores/themeStore";

// Dynamic import for Chart3D to prevent SSR issues
const Chart3D = dynamic(
  () => import("@/components/charts/Chart3D").then((mod) => mod.Chart3D),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-transparent flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
      </div>
    ),
  }
);

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const SITE_URL = typeof window !== 'undefined' ? window.location.origin : 'https://polyx.xyz';

// Demo token addresses
const DEMO_TOKENS = [
  { address: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana" },
  { address: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", symbol: "WETH", name: "Wrapped Ether" },
];

interface OHLCVCandle {
  open: number;
  high: number;
  close: number;
  low: number;
  volume: number;
  timestamp: number;
}

// Code block component with copy functionality
function CodeBlock({ code, language = "html" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const { isDark } = useThemeStore();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`relative group border overflow-hidden ${isDark ? 'bg-black/50 border-white/10' : 'bg-gray-900 border-gray-700'}`}>
      <div className={`flex items-center justify-between px-4 py-2 border-b ${isDark ? 'border-white/10' : 'border-gray-700'}`}>
        <span className="text-xs font-mono text-gray-400">{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-400" />
              <span className="text-green-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-sm">
        <code className="text-gray-300 font-mono whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}

// Feature card component
function FeatureCard({ icon: Icon, title, description, isDark }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; isDark: boolean }) {
  return (
    <div className={`p-6 border transition-all hover:scale-[1.02] ${
      isDark ? 'bg-white/5 border-white/10 hover:border-[#FF6B4A]/30' : 'bg-black/5 border-black/10 hover:border-[#FF6B4A]/30'
    }`}>
      <div className="w-10 h-10 rounded-lg bg-[#FF6B4A]/10 flex items-center justify-center mb-4">
        <Icon className="w-5 h-5 text-[#FF6B4A]" />
      </div>
      <h3 className={`text-lg font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>{title}</h3>
      <p className={`text-sm ${isDark ? 'text-white/60' : 'text-gray-600'}`}>{description}</p>
    </div>
  );
}

// API endpoint documentation
function ApiEndpoint({ method, path, description, params, isDark }: {
  method: "GET" | "POST";
  path: string;
  description: string;
  params?: { name: string; type: string; description: string; required?: boolean }[];
  isDark: boolean;
}) {
  return (
    <div className={`border ${isDark ? 'border-white/10' : 'border-black/10'}`}>
      <div className={`flex items-center gap-3 p-4 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
        <span className={`px-2 py-1 text-xs font-bold rounded ${
          method === "GET" ? "bg-green-500/20 text-green-400" : "bg-blue-500/20 text-blue-400"
        }`}>
          {method}
        </span>
        <code className={`font-mono text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{path}</code>
      </div>
      <div className="p-4">
        <p className={`text-sm mb-4 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>{description}</p>
        {params && params.length > 0 && (
          <div>
            <h4 className={`text-xs uppercase tracking-wider mb-2 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Parameters</h4>
            <div className="space-y-2">
              {params.map((param) => (
                <div key={param.name} className={`flex items-start gap-3 text-sm p-2 ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                  <code className="text-[#FF6B4A] font-mono">{param.name}</code>
                  <span className={isDark ? 'text-white/40' : 'text-gray-400'}>{param.type}</span>
                  {param.required && <span className="text-red-400 text-xs">required</span>}
                  <span className={isDark ? 'text-white/60' : 'text-gray-600'}>{param.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SolutionsPageContent() {
  const { isDark, toggleTheme } = useThemeStore();
  const searchParams = useSearchParams();
  const [selectedToken, setSelectedToken] = useState(DEMO_TOKENS[0]);
  const [candles, setCandles] = useState<OHLCVCandle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tokenPrice, setTokenPrice] = useState<number | null>(null);
  const [embedWidth, setEmbedWidth] = useState("800");
  const [embedHeight, setEmbedHeight] = useState("500");
  const [embedTheme, setEmbedTheme] = useState<"dark" | "light">("dark");
  const [embedTimeframe, setEmbedTimeframe] = useState("1h");
  const [isPlaying, setIsPlaying] = useState(true);

  // Checkout modal state
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<"PRO" | "BUSINESS" | null>(null);
  const [checkoutEmail, setCheckoutEmail] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);

  // Check for success/canceled from Stripe redirect
  useEffect(() => {
    if (searchParams.get("success") === "true") {
      setShowSuccessMessage(true);
      // Clear URL params
      window.history.replaceState({}, "", "/solutions");
    }
    if (searchParams.get("canceled") === "true") {
      setCheckoutError("Checkout was canceled. You can try again anytime.");
      window.history.replaceState({}, "", "/solutions");
    }
  }, [searchParams]);

  // Handle checkout
  const handleCheckout = async (plan: "PRO" | "BUSINESS") => {
    setCheckoutPlan(plan);
    setShowCheckoutModal(true);
    setCheckoutError("");
  };

  const submitCheckout = async () => {
    if (!checkoutEmail || !checkoutPlan) return;

    setCheckoutLoading(true);
    setCheckoutError("");

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: checkoutPlan,
          email: checkoutEmail,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create checkout session");
      }

      // Redirect to Stripe checkout
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Something went wrong");
      setCheckoutLoading(false);
    }
  };

  // Fetch candles for demo - refetch when token OR timeframe changes
  useEffect(() => {
    setIsLoading(true);

    // Fetch price
    fetch(`${API_URL}/api/tokens/${selectedToken.address}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.price) setTokenPrice(data.price);
      })
      .catch(() => setTokenPrice(selectedToken.symbol === "SOL" ? 235 : 3018));

    // Fetch OHLCV with the selected timeframe
    fetch(`${API_URL}/api/tokens/${selectedToken.address}/ohlcv?timeframe=${embedTimeframe}&limit=100`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setCandles(data);
        }
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [selectedToken, embedTimeframe]);

  // Generate embed code
  const embedCode = `<iframe
  src="${SITE_URL}/embed/${selectedToken.address}?theme=${embedTheme}&timeframe=${embedTimeframe}"
  width="${embedWidth}"
  height="${embedHeight}"
  frameborder="0"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
  style="border: none; border-radius: 8px;"
></iframe>`;

  // Generate script embed code
  const scriptCode = `<div id="polyx-chart"></div>
<script src="${SITE_URL}/embed.js"></script>
<script>
  PolyxChart.render({
    container: '#polyx-chart',
    token: '${selectedToken.address}',
    theme: '${embedTheme}',
    timeframe: '${embedTimeframe}',
    width: ${embedWidth},
    height: ${embedHeight}
  });
</script>`;

  // Scroll to embed code section
  const scrollToEmbedCode = () => {
    document.getElementById('embed-code')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDark ? 'bg-[#0a0a0a] text-white' : 'bg-[#f5f5f5] text-black'}`}>
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center relative">
          <Link href="/" className={`flex items-center px-4 py-2 rounded-full border backdrop-blur-sm ${
            isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
          }`}>
            <span className={`font-medium text-sm ${isDark ? 'text-white' : 'text-black'}`}>[poly<span className="text-[#FF6B4A]">x</span>]</span>
          </Link>

          <nav className={`absolute left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-full border backdrop-blur-sm ${
            isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
          }`}>
            <Link href="/pulse" className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              isDark ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-black/60 hover:text-black hover:bg-black/10'
            }`}>
              Pulse
            </Link>
            <Link href="/dashboard" className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              isDark ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-black/60 hover:text-black hover:bg-black/10'
            }`}>
              Dashboard
            </Link>
            <Link href="/solutions" className={`px-4 py-1.5 rounded-full text-sm font-medium bg-[#FF6B4A] text-white`}>
              Solutions
            </Link>
            <Link href="/markets" className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              isDark ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-black/60 hover:text-black hover:bg-black/10'
            }`}>
              Markets
            </Link>
          </nav>

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={toggleTheme}
              className={`p-2.5 rounded-full border backdrop-blur-md transition-colors ${
                isDark
                  ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white/60 hover:text-white'
                  : 'bg-black/5 border-black/10 hover:bg-black/10 text-black/60 hover:text-black'
              }`}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-16 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#FF6B4A]/10 border border-[#FF6B4A]/30 mb-6">
              <Zap className="w-4 h-4 text-[#FF6B4A]" />
              <span className="text-sm font-medium text-[#FF6B4A]">3D Chart API</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-bold mb-6">
              Embed <span className="text-[#FF6B4A]">3D</span> Solana Charts
            </h1>
            <p className={`text-xl max-w-2xl mx-auto ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
              Add immersive 3D candlestick charts for any Solana token to your website with just a few lines of code.
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
            <FeatureCard
              icon={Box}
              title="3D Visualization"
              description="Fully interactive 3D candlestick charts with orbit controls, zoom, and fly mode."
              isDark={isDark}
            />
            <FeatureCard
              icon={Zap}
              title="Real-time Data"
              description="Live price updates from multiple DEX sources across Solana."
              isDark={isDark}
            />
            <FeatureCard
              icon={Palette}
              title="Customizable"
              description="Dark/light themes, multiple timeframes, and responsive sizing."
              isDark={isDark}
            />
            <FeatureCard
              icon={Code}
              title="Easy Integration"
              description="Simple iframe embed or JavaScript SDK for advanced control."
              isDark={isDark}
            />
          </div>

          {/* Pricing Section - Moved to top */}
          <div id="pricing" className="mb-16">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#FF6B4A]/10 border border-[#FF6B4A]/30 mb-6">
                <Sparkles className="w-4 h-4 text-[#FF6B4A]" />
                <span className="text-sm font-medium text-[#FF6B4A]">Pricing</span>
              </div>
              <h2 className="text-4xl font-bold mb-4">Simple, transparent pricing</h2>
              <p className={`text-lg max-w-2xl mx-auto ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
                Start free, upgrade when you need more. No hidden fees.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Free Plan */}
              <div className={`relative p-6 border transition-all hover:scale-[1.02] ${
                isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
              }`}>
                <div className="mb-6">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${
                    isDark ? 'bg-white/10' : 'bg-black/10'
                  }`}>
                    <Box className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold mb-1">Free</h3>
                  <p className={`text-sm ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
                    For personal projects
                  </p>
                </div>

                <div className="mb-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">$0</span>
                    <span className={isDark ? 'text-white/40' : 'text-gray-500'}>/month</span>
                  </div>
                </div>

                <ul className="space-y-3 mb-8">
                  {["1 domain", "1,000 views/month", "Watermark included", "Community support"].map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-400" />
                      <span className={isDark ? 'text-white/80' : 'text-gray-700'}>{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={scrollToEmbedCode}
                  className={`w-full py-3 font-medium border transition-colors flex items-center justify-center ${
                    isDark
                      ? 'border-white/20 text-white hover:bg-white/10'
                      : 'border-black/20 text-black hover:bg-black/10'
                  }`}
                >
                  Get Started Free
                </button>
              </div>

              {/* Pro Plan */}
              <div className={`relative p-6 border-2 border-[#FF6B4A] transition-all hover:scale-[1.02] ${
                isDark ? 'bg-[#FF6B4A]/5' : 'bg-[#FF6B4A]/5'
              }`}>
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 text-xs font-bold bg-[#FF6B4A] text-white rounded-full">
                    MOST POPULAR
                  </span>
                </div>

                <div className="mb-6">
                  <div className="w-12 h-12 rounded-lg bg-[#FF6B4A]/20 flex items-center justify-center mb-4">
                    <Building className="w-6 h-6 text-[#FF6B4A]" />
                  </div>
                  <h3 className="text-xl font-bold mb-1">Pro</h3>
                  <p className={`text-sm ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
                    For growing businesses
                  </p>
                </div>

                <div className="mb-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">$29</span>
                    <span className={isDark ? 'text-white/40' : 'text-gray-500'}>/month</span>
                  </div>
                </div>

                <ul className="space-y-3 mb-8">
                  {["3 domains", "50,000 views/month", "No watermark", "Priority support", "Custom themes"].map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-[#FF6B4A]" />
                      <span className={isDark ? 'text-white/80' : 'text-gray-700'}>{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleCheckout("PRO")}
                  className="w-full py-3 font-medium bg-[#FF6B4A] text-white hover:bg-[#FF5A36] transition-colors"
                >
                  Subscribe to Pro
                </button>
              </div>

              {/* Business Plan */}
              <div className={`relative p-6 border transition-all hover:scale-[1.02] ${
                isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
              }`}>
                <div className="mb-6">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${
                    isDark ? 'bg-purple-500/20' : 'bg-purple-500/20'
                  }`}>
                    <Crown className="w-6 h-6 text-purple-400" />
                  </div>
                  <h3 className="text-xl font-bold mb-1">Business</h3>
                  <p className={`text-sm ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
                    For enterprises
                  </p>
                </div>

                <div className="mb-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">$99</span>
                    <span className={isDark ? 'text-white/40' : 'text-gray-500'}>/month</span>
                  </div>
                </div>

                <ul className="space-y-3 mb-8">
                  {["10 domains", "500,000 views/month", "No watermark", "White-label option", "Dedicated support", "Custom integrations"].map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-purple-400" />
                      <span className={isDark ? 'text-white/80' : 'text-gray-700'}>{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleCheckout("BUSINESS")}
                  className={`w-full py-3 font-medium border transition-colors ${
                    isDark
                      ? 'border-purple-500/50 text-purple-400 hover:bg-purple-500/10'
                      : 'border-purple-500/50 text-purple-600 hover:bg-purple-500/10'
                  }`}
                >
                  Subscribe to Business
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Live Demo Section */}
      <section className={`py-16 px-6 border-y ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-black/[0.02] border-black/10'}`}>
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-3xl font-bold mb-2">Live Demo</h2>
              <p className={isDark ? 'text-white/60' : 'text-gray-600'}>
                Preview how the embedded chart will look on your site
              </p>
            </div>
            <div className="flex items-center gap-2">
              {DEMO_TOKENS.map((token) => (
                <button
                  key={token.address}
                  onClick={() => setSelectedToken(token)}
                  className={`px-4 py-2 text-sm font-medium transition-all ${
                    selectedToken.address === token.address
                      ? 'bg-[#FF6B4A] text-white'
                      : isDark
                        ? 'bg-white/5 text-white/60 hover:bg-white/10 border border-white/10'
                        : 'bg-black/5 text-gray-600 hover:bg-black/10 border border-black/10'
                  }`}
                >
                  {token.symbol}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Chart Preview */}
            <div className="lg:col-span-2">
              <div className={`border overflow-hidden ${embedTheme === 'dark' ? 'border-white/10 bg-[#0a0a0a]' : 'border-black/10 bg-white'}`}>
                <div className={`flex items-center justify-between px-4 py-3 border-b ${embedTheme === 'dark' ? 'border-white/10' : 'border-black/10'}`}>
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-500" />
                      <div className="w-3 h-3 rounded-full bg-yellow-500" />
                      <div className="w-3 h-3 rounded-full bg-green-500" />
                    </div>
                    <span className={`text-sm font-mono ${embedTheme === 'dark' ? 'text-white/40' : 'text-gray-500'}`}>
                      {selectedToken.symbol} 3D Chart
                    </span>
                  </div>
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className={`p-1.5 rounded transition-colors ${
                      embedTheme === 'dark' ? 'hover:bg-white/10 text-white' : 'hover:bg-black/10 text-black'
                    }`}
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                </div>
                <div style={{ height: `${Math.min(Math.max(parseInt(embedHeight) || 500, 200), 800)}px` }}>
                  {candles.length > 0 ? (
                    <Chart3D
                      data={candles}
                      isLoading={isLoading}
                      price={tokenPrice || undefined}
                      showDrawingTools={true}
                      theme={embedTheme}
                    />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center ${embedTheme === 'dark' ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Configuration Panel */}
            <div className={`border p-6 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#FF6B4A]" />
                Configuration
              </h3>

              <div className="space-y-4">
                {/* Theme */}
                <div>
                  <label className={`text-sm mb-2 block ${isDark ? 'text-white/60' : 'text-gray-600'}`}>Theme</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEmbedTheme("dark")}
                      className={`flex-1 py-2 text-sm font-medium transition-all ${
                        embedTheme === "dark"
                          ? 'bg-[#FF6B4A] text-white'
                          : isDark ? 'bg-white/5 border border-white/10' : 'bg-black/5 border border-black/10'
                      }`}
                    >
                      Dark
                    </button>
                    <button
                      onClick={() => setEmbedTheme("light")}
                      className={`flex-1 py-2 text-sm font-medium transition-all ${
                        embedTheme === "light"
                          ? 'bg-[#FF6B4A] text-white'
                          : isDark ? 'bg-white/5 border border-white/10' : 'bg-black/5 border border-black/10'
                      }`}
                    >
                      Light
                    </button>
                  </div>
                </div>

                {/* Timeframe */}
                <div>
                  <label className={`text-sm mb-2 block ${isDark ? 'text-white/60' : 'text-gray-600'}`}>Timeframe</label>
                  <select
                    value={embedTimeframe}
                    onChange={(e) => setEmbedTimeframe(e.target.value)}
                    className={`w-full py-2 px-3 text-sm border ${
                      isDark
                        ? 'bg-white/5 border-white/10 text-white'
                        : 'bg-black/5 border-black/10 text-black'
                    }`}
                  >
                    <option value="1m">1 minute</option>
                    <option value="5m">5 minutes</option>
                    <option value="15m">15 minutes</option>
                    <option value="1h">1 hour</option>
                    <option value="4h">4 hours</option>
                    <option value="1d">1 day</option>
                  </select>
                </div>

                {/* Dimensions */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`text-sm mb-2 block ${isDark ? 'text-white/60' : 'text-gray-600'}`}>Width (px)</label>
                    <input
                      type="number"
                      value={embedWidth}
                      onChange={(e) => setEmbedWidth(e.target.value)}
                      min={300}
                      max={1920}
                      className={`w-full py-2 px-3 text-sm border ${
                        isDark
                          ? 'bg-white/5 border-white/10 text-white'
                          : 'bg-black/5 border-black/10 text-black'
                      }`}
                    />
                  </div>
                  <div>
                    <label className={`text-sm mb-2 block ${isDark ? 'text-white/60' : 'text-gray-600'}`}>Height (px)</label>
                    <input
                      type="number"
                      value={embedHeight}
                      onChange={(e) => setEmbedHeight(e.target.value)}
                      min={200}
                      max={1000}
                      className={`w-full py-2 px-3 text-sm border ${
                        isDark
                          ? 'bg-white/5 border-white/10 text-white'
                          : 'bg-black/5 border-black/10 text-black'
                      }`}
                    />
                  </div>
                </div>

                {/* Token Address */}
                <div>
                  <label className={`text-sm mb-2 block ${isDark ? 'text-white/60' : 'text-gray-600'}`}>Token Address</label>
                  <input
                    type="text"
                    value={selectedToken.address}
                    readOnly
                    className={`w-full py-2 px-3 text-xs font-mono border ${
                      isDark
                        ? 'bg-white/5 border-white/10 text-white/60'
                        : 'bg-black/5 border-black/10 text-gray-500'
                    }`}
                  />
                </div>

                {/* Generate Button */}
                <button
                  onClick={scrollToEmbedCode}
                  className="w-full py-3 mt-2 font-medium bg-[#FF6B4A] text-white hover:bg-[#FF5A36] transition-colors flex items-center justify-center gap-2"
                >
                  <Code className="w-4 h-4" />
                  Generate Embed Code
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Embed Code Section */}
      <section id="embed-code" className="py-16 px-6 scroll-mt-24">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold mb-8">Embed Code</h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* iframe Embed */}
            <div>
              <h3 className={`text-lg font-bold mb-4 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                <Code className="w-5 h-5 text-[#FF6B4A]" />
                iframe Embed
              </h3>
              <p className={`text-sm mb-4 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
                The simplest way to add a 3D chart. Just paste this code into your HTML.
              </p>
              <CodeBlock code={embedCode} language="html" />
            </div>

            {/* JavaScript SDK */}
            <div>
              <h3 className={`text-lg font-bold mb-4 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                <Zap className="w-5 h-5 text-[#FF6B4A]" />
                JavaScript SDK
              </h3>
              <p className={`text-sm mb-4 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
                For more control, use our JavaScript SDK to dynamically render charts.
              </p>
              <CodeBlock code={scriptCode} language="html" />
            </div>
          </div>
        </div>
      </section>

      {/* API Documentation Section */}
      <section className={`py-16 px-6 border-y ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-black/[0.02] border-black/10'}`}>
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">API Documentation</h2>
          <p className={`mb-8 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
            Access token data and OHLCV candles directly via our REST API.
          </p>

          <div className="space-y-4">
            <ApiEndpoint
              method="GET"
              path="/api/tokens/:address"
              description="Get token metadata, current price, and market data."
              params={[
                { name: "address", type: "string", description: "Solana token mint address", required: true }
              ]}
              isDark={isDark}
            />

            <ApiEndpoint
              method="GET"
              path="/api/tokens/:address/ohlcv"
              description="Get OHLCV candlestick data for charting."
              params={[
                { name: "address", type: "string", description: "Solana token mint address", required: true },
                { name: "timeframe", type: "string", description: "1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M", required: false },
                { name: "limit", type: "number", description: "Number of candles (default: 100, max: 1000)", required: false },
                { name: "from", type: "number", description: "Start timestamp (Unix seconds)", required: false },
                { name: "to", type: "number", description: "End timestamp (Unix seconds)", required: false }
              ]}
              isDark={isDark}
            />

            <ApiEndpoint
              method="GET"
              path="/embed/:address"
              description="Embeddable 3D chart page for iframe integration."
              params={[
                { name: "address", type: "string", description: "Solana token mint address", required: true },
                { name: "theme", type: "string", description: "dark or light (default: dark)", required: false },
                { name: "timeframe", type: "string", description: "Chart timeframe (default: 1h)", required: false },
                { name: "controls", type: "boolean", description: "Show orbit controls (default: true)", required: false }
              ]}
              isDark={isDark}
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className={`py-16 px-6 border-t ${isDark ? 'border-white/10' : 'border-black/10'}`}>
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
          <p className={`mb-8 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
            Add beautiful 3D charts to your project in minutes.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 px-6 py-3 bg-[#FF6B4A] text-white font-medium hover:bg-[#FF5A36] transition-colors"
            >
              Launch App
              <ChevronRight className="w-4 h-4" />
            </Link>
            <a
              href="#pricing"
              className={`flex items-center gap-2 px-6 py-3 border font-medium transition-colors ${
                isDark
                  ? 'border-white/10 text-white hover:bg-white/5'
                  : 'border-black/10 text-black hover:bg-black/5'
              }`}
            >
              View Pricing
              <Sparkles className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={`border-t py-8 px-6 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className={`text-sm ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
            2024 [polyx] - 3D Charts for Solana
          </div>
          <div className="flex items-center gap-4">
            <a href="https://x.com/polyx" target="_blank" rel="noopener noreferrer" className={`transition-colors ${isDark ? 'text-white/40 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>
              𝕏
            </a>
            <a href="https://github.com/polyx" target="_blank" rel="noopener noreferrer" className={`transition-colors ${isDark ? 'text-white/40 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>
              GitHub
            </a>
          </div>
        </div>
      </footer>

      {/* Success Message */}
      {showSuccessMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className={`max-w-md w-full p-8 text-center ${
            isDark ? 'bg-[#0a0a0a] border border-white/10' : 'bg-white border border-black/10'
          }`}>
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="w-8 h-8 text-green-400" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Pro Plan Activated!</h2>
            <p className={`mb-6 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
              Your Pro subscription is now active. Get your license key to start embedding charts on your website.
            </p>
            <div className="space-y-3">
              <Link
                href="/dashboard/license"
                className="block w-full px-6 py-3 bg-[#FF6B4A] text-white font-medium hover:bg-[#FF5A36] transition-colors"
                onClick={() => setShowSuccessMessage(false)}
              >
                Get Your License Key →
              </Link>
              <button
                onClick={() => setShowSuccessMessage(false)}
                className={`w-full px-6 py-3 font-medium transition-colors ${
                  isDark ? 'text-white/60 hover:text-white' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Maybe Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Checkout Modal */}
      {showCheckoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className={`max-w-md w-full p-6 ${
            isDark ? 'bg-[#0a0a0a] border border-white/10' : 'bg-white border border-black/10'
          }`}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">
                Subscribe to {checkoutPlan === "PRO" ? "Pro" : "Business"}
              </h2>
              <button
                onClick={() => {
                  setShowCheckoutModal(false);
                  setCheckoutEmail("");
                  setCheckoutError("");
                }}
                className={`p-2 transition-colors ${
                  isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'
                }`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className={`p-4 mb-6 ${
              isDark ? 'bg-white/5 border border-white/10' : 'bg-black/5 border border-black/10'
            }`}>
              <div className="flex items-center justify-between">
                <span className={isDark ? 'text-white/60' : 'text-gray-600'}>Plan</span>
                <span className="font-bold">{checkoutPlan === "PRO" ? "Pro" : "Business"}</span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className={isDark ? 'text-white/60' : 'text-gray-600'}>Price</span>
                <span className="font-bold">${checkoutPlan === "PRO" ? "29" : "99"}/month</span>
              </div>
            </div>

            <div className="mb-6">
              <label className={`text-sm mb-2 block ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
                Email Address
              </label>
              <input
                type="email"
                value={checkoutEmail}
                onChange={(e) => setCheckoutEmail(e.target.value)}
                placeholder="you@company.com"
                className={`w-full py-3 px-4 text-sm border ${
                  isDark
                    ? 'bg-white/5 border-white/10 text-white placeholder:text-white/30'
                    : 'bg-black/5 border-black/10 text-black placeholder:text-black/30'
                }`}
              />
            </div>

            {checkoutError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {checkoutError}
              </div>
            )}

            <button
              onClick={submitCheckout}
              disabled={!checkoutEmail || checkoutLoading}
              className="w-full py-3 font-medium bg-[#FF6B4A] text-white hover:bg-[#FF5A36] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {checkoutLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                "Continue to Payment"
              )}
            </button>

            <p className={`text-xs text-center mt-4 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
              Secure payment powered by Stripe. Cancel anytime.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// Wrap in Suspense for useSearchParams
export default function SolutionsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
      </div>
    }>
      <SolutionsPageContent />
    </Suspense>
  );
}
