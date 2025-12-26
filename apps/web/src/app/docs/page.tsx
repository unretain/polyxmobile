"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Copy, Check, ExternalLink, Key, Code, Zap, Shield, ChevronRight } from "lucide-react";

interface LicenseData {
  licenseKey: string;
  email: string;
  domain: string;
  plan: string;
}

interface SubscriptionStatus {
  plan: string;
  status: string;
  hasSubscription: boolean;
}

export default function DocsPage() {
  const { data: session } = useSession();
  const [activeSection, setActiveSection] = useState("quickstart");
  const [licenseData, setLicenseData] = useState<LicenseData | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://polyx.xyz";

  const sections = [
    { id: "quickstart", label: "Quick Start", icon: <Zap className="w-4 h-4" /> },
    { id: "license", label: "License Key", icon: <Key className="w-4 h-4" /> },
    { id: "embedding", label: "Embedding", icon: <Code className="w-4 h-4" /> },
    { id: "api", label: "API Reference", icon: <Shield className="w-4 h-4" /> },
  ];

  // Fetch subscription status
  useEffect(() => {
    if (session?.user?.email) {
      fetch("/api/subscription/status")
        .then((res) => res.json())
        .then((data) => setSubscription(data))
        .catch(() => {});
    }
  }, [session?.user?.email]);

  // Generate license key
  const generateLicense = async () => {
    if (!session?.user?.email) return;

    setIsGenerating(true);
    setError(null);

    try {
      const params = new URLSearchParams({ email: session.user.email });
      if (domain) params.set("domain", domain);

      const res = await fetch(`/api/embed/license?${params}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate license");
      }

      setLicenseData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate license");
    } finally {
      setIsGenerating(false);
    }
  };

  const isPaidPlan = subscription?.plan === "PRO" || subscription?.plan === "BUSINESS";

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight">
              [poly<span className="text-[#FF6B4A]">x</span>]
            </span>
          </Link>
          <nav className="flex items-center gap-6">
            <Link href="/solutions" className="text-sm text-white/60 hover:text-white transition-colors">
              Solutions
            </Link>
            {session ? (
              <Link
                href="/dashboard/license"
                className="px-4 py-2 bg-[#FF6B4A] text-white text-sm font-medium rounded-lg hover:bg-[#FF6B4A]/90 transition-colors"
              >
                Dashboard
              </Link>
            ) : (
              <Link
                href="/solutions#pricing"
                className="px-4 py-2 bg-[#FF6B4A] text-white text-sm font-medium rounded-lg hover:bg-[#FF6B4A]/90 transition-colors"
              >
                Get Started
              </Link>
            )}
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-12 flex gap-12">
        {/* Sidebar */}
        <aside className="w-64 flex-shrink-0 hidden md:block">
          <nav className="sticky top-24 space-y-1">
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
              Documentation
            </h3>
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-3 ${
                  activeSection === section.id
                    ? "bg-[#FF6B4A]/10 text-[#FF6B4A]"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                }`}
              >
                {section.icon}
                {section.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0">
          {/* Quick Start */}
          {activeSection === "quickstart" && (
            <section className="space-y-8">
              <div>
                <h1 className="text-4xl font-bold mb-4">Quick Start</h1>
                <p className="text-white/60 text-lg">
                  Embed beautiful 3D Solana charts on your website in under 2 minutes.
                </p>
              </div>

              {/* Step by Step */}
              <div className="space-y-6">
                {/* Step 1 */}
                <div className="relative pl-10">
                  <div className="absolute left-0 top-0 w-7 h-7 rounded-full bg-[#FF6B4A] text-white text-sm flex items-center justify-center font-bold">
                    1
                  </div>
                  <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                    <h3 className="text-xl font-semibold mb-3">Choose Your Plan</h3>
                    <p className="text-white/60 mb-4">
                      Start free with a watermark, or go Pro for clean, white-label embeds.
                    </p>
                    <div className="grid sm:grid-cols-3 gap-4 mb-4">
                      <div className="p-4 bg-white/5 rounded-lg">
                        <div className="font-semibold">Free</div>
                        <div className="text-2xl font-bold">$0</div>
                        <div className="text-xs text-white/40 mt-1">Includes watermark</div>
                      </div>
                      <div className="p-4 bg-[#FF6B4A]/10 border border-[#FF6B4A]/30 rounded-lg">
                        <div className="font-semibold text-[#FF6B4A]">Pro</div>
                        <div className="text-2xl font-bold">$29<span className="text-sm font-normal text-white/40">/mo</span></div>
                        <div className="text-xs text-white/40 mt-1">No watermark</div>
                      </div>
                      <div className="p-4 bg-white/5 rounded-lg">
                        <div className="font-semibold">Business</div>
                        <div className="text-2xl font-bold">$99<span className="text-sm font-normal text-white/40">/mo</span></div>
                        <div className="text-xs text-white/40 mt-1">+ API access</div>
                      </div>
                    </div>
                    <Link
                      href="/solutions#pricing"
                      className="inline-flex items-center gap-2 text-[#FF6B4A] hover:underline text-sm"
                    >
                      View full pricing <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="relative pl-10">
                  <div className="absolute left-0 top-0 w-7 h-7 rounded-full bg-[#FF6B4A] text-white text-sm flex items-center justify-center font-bold">
                    2
                  </div>
                  <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                    <h3 className="text-xl font-semibold mb-3">Get Your License Key</h3>
                    <p className="text-white/60 mb-4">
                      {isPaidPlan
                        ? "Generate your license key below, or from your dashboard."
                        : "Subscribe to Pro or Business to generate a license key. Free users can skip this step."}
                    </p>

                    {session ? (
                      isPaidPlan ? (
                        <Link
                          href="/dashboard/license"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-[#FF6B4A] text-white rounded-lg hover:bg-[#FF6B4A]/90 transition-colors"
                        >
                          <Key className="w-4 h-4" />
                          Generate License Key
                        </Link>
                      ) : (
                        <Link
                          href="/solutions#pricing"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
                        >
                          Upgrade to Pro
                        </Link>
                      )
                    ) : (
                      <Link
                        href="/solutions#pricing"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-[#FF6B4A] text-white rounded-lg hover:bg-[#FF6B4A]/90 transition-colors"
                      >
                        Sign Up
                      </Link>
                    )}
                  </div>
                </div>

                {/* Step 3 */}
                <div className="relative pl-10">
                  <div className="absolute left-0 top-0 w-7 h-7 rounded-full bg-[#FF6B4A] text-white text-sm flex items-center justify-center font-bold">
                    3
                  </div>
                  <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                    <h3 className="text-xl font-semibold mb-3">Embed the Chart</h3>
                    <p className="text-white/60 mb-4">
                      Copy this code and paste it into your website. Replace TOKEN_ADDRESS with any Solana token mint.
                    </p>
                    <CodeBlock
                      code={`<iframe
  src="${baseUrl}/embed/TOKEN_ADDRESS${isPaidPlan && licenseData ? `?license=${licenseData.licenseKey}` : ""}"
  width="100%"
  height="500"
  frameborder="0"
  style="border-radius: 8px;"
></iframe>`}
                      language="html"
                    />
                    <p className="text-white/40 text-sm mt-4">
                      Example: Use <code className="text-[#FF6B4A]">So11111111111111111111111111111111111111112</code> for SOL
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* License Key Generator */}
          {activeSection === "license" && (
            <section className="space-y-8">
              <div>
                <h1 className="text-4xl font-bold mb-4">License Key</h1>
                <p className="text-white/60 text-lg">
                  Generate and manage your embed license key.
                </p>
              </div>

              {!session ? (
                <div className="p-8 bg-white/5 rounded-xl border border-white/10 text-center">
                  <Key className="w-12 h-12 text-white/20 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-2">Sign in to continue</h3>
                  <p className="text-white/60 mb-6">
                    You need to be signed in to generate a license key.
                  </p>
                  <Link
                    href="/solutions"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-[#FF6B4A] text-white rounded-lg hover:bg-[#FF6B4A]/90 transition-colors"
                  >
                    Sign In
                  </Link>
                </div>
              ) : !isPaidPlan ? (
                <div className="p-8 bg-white/5 rounded-xl border border-white/10 text-center">
                  <Key className="w-12 h-12 text-white/20 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-2">Upgrade Required</h3>
                  <p className="text-white/60 mb-2">
                    License keys are available on Pro and Business plans.
                  </p>
                  <p className="text-white/40 text-sm mb-6">
                    Current plan: <span className="text-white">{subscription?.plan || "Free"}</span>
                  </p>
                  <Link
                    href="/solutions#pricing"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-[#FF6B4A] text-white rounded-lg hover:bg-[#FF6B4A]/90 transition-colors"
                  >
                    Upgrade to Pro
                  </Link>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Generator */}
                  <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                    <h3 className="text-lg font-semibold mb-4">Generate License Key</h3>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm text-white/60 mb-2">
                          Domain restriction (optional)
                        </label>
                        <input
                          type="text"
                          value={domain}
                          onChange={(e) => setDomain(e.target.value)}
                          placeholder="yoursite.com"
                          className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-[#FF6B4A]/50"
                        />
                        <p className="text-xs text-white/40 mt-2">
                          Leave empty to allow any domain. Use comma for multiple: site1.com, site2.com
                        </p>
                      </div>

                      <button
                        onClick={generateLicense}
                        disabled={isGenerating}
                        className="w-full py-3 bg-[#FF6B4A] text-white rounded-lg hover:bg-[#FF6B4A]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isGenerating ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <Key className="w-4 h-4" />
                            Generate License Key
                          </>
                        )}
                      </button>

                      {error && (
                        <p className="text-red-400 text-sm">{error}</p>
                      )}
                    </div>
                  </div>

                  {/* License Display */}
                  {licenseData && (
                    <div className="p-6 bg-green-500/10 border border-green-500/30 rounded-xl">
                      <div className="flex items-center gap-2 text-green-400 mb-4">
                        <Check className="w-5 h-5" />
                        <span className="font-semibold">License Generated!</span>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm text-white/60 mb-2">Your License Key</label>
                          <div className="relative">
                            <pre className="p-4 bg-[#111] rounded-lg overflow-x-auto border border-white/10 text-sm font-mono text-white/80 pr-12">
                              {licenseData.licenseKey}
                            </pre>
                            <CopyButton text={licenseData.licenseKey} />
                          </div>
                        </div>

                        <div className="grid sm:grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-white/40">Email:</span>
                            <span className="ml-2">{licenseData.email}</span>
                          </div>
                          <div>
                            <span className="text-white/40">Domain:</span>
                            <span className="ml-2">{licenseData.domain || "Any"}</span>
                          </div>
                          <div>
                            <span className="text-white/40">Plan:</span>
                            <span className="ml-2 text-[#FF6B4A]">{licenseData.plan}</span>
                          </div>
                        </div>

                        <div className="pt-4 border-t border-white/10">
                          <p className="text-sm text-white/60 mb-2">Use it in your embed:</p>
                          <CodeBlock
                            code={`<iframe src="${baseUrl}/embed/TOKEN_ADDRESS?license=${licenseData.licenseKey}" ...>`}
                            language="html"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Quick Link */}
                  <div className="p-4 bg-white/5 rounded-lg border border-white/10 flex items-center justify-between">
                    <div>
                      <p className="font-medium">Manage all your licenses</p>
                      <p className="text-sm text-white/40">View, revoke, and create new licenses</p>
                    </div>
                    <Link
                      href="/dashboard/license"
                      className="px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors flex items-center gap-2"
                    >
                      Dashboard <ExternalLink className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Embedding */}
          {activeSection === "embedding" && (
            <section className="space-y-8">
              <div>
                <h1 className="text-4xl font-bold mb-4">Embedding Charts</h1>
                <p className="text-white/60 text-lg">
                  Multiple ways to embed Polyx charts on your website.
                </p>
              </div>

              {/* iFrame Method */}
              <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <Code className="w-5 h-5 text-[#FF6B4A]" />
                  iFrame Embed
                  <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">Recommended</span>
                </h2>
                <p className="text-white/60 mb-4">
                  The simplest way to embed. Just paste this HTML:
                </p>
                <CodeBlock
                  code={`<iframe
  src="${baseUrl}/embed/TOKEN_ADDRESS"
  width="100%"
  height="500"
  frameborder="0"
  style="border-radius: 8px;"
></iframe>`}
                  language="html"
                />
              </div>

              {/* URL Parameters */}
              <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                <h3 className="text-lg font-semibold mb-4">URL Parameters</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Parameter</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Default</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      <tr>
                        <td className="py-3 px-4 font-mono text-[#FF6B4A]">license</td>
                        <td className="py-3 px-4 text-white/40">—</td>
                        <td className="py-3 px-4 text-white/60">Your license key (removes watermark)</td>
                      </tr>
                      <tr>
                        <td className="py-3 px-4 font-mono text-[#FF6B4A]">theme</td>
                        <td className="py-3 px-4 text-white/40">dark</td>
                        <td className="py-3 px-4 text-white/60">"dark" or "light"</td>
                      </tr>
                      <tr>
                        <td className="py-3 px-4 font-mono text-[#FF6B4A]">timeframe</td>
                        <td className="py-3 px-4 text-white/40">1h</td>
                        <td className="py-3 px-4 text-white/60">1m, 5m, 15m, 1h, 4h, 1d</td>
                      </tr>
                      <tr>
                        <td className="py-3 px-4 font-mono text-[#FF6B4A]">header</td>
                        <td className="py-3 px-4 text-white/40">true</td>
                        <td className="py-3 px-4 text-white/60">Show/hide token info header</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Examples */}
              <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                <h3 className="text-lg font-semibold mb-4">Examples</h3>

                <div className="space-y-6">
                  <div>
                    <p className="text-white/60 mb-2">SOL chart with 4h candles:</p>
                    <CodeBlock
                      code={`<iframe src="${baseUrl}/embed/So11111111111111111111111111111111111111112?timeframe=4h" width="100%" height="500" frameborder="0"></iframe>`}
                      language="html"
                    />
                  </div>

                  <div>
                    <p className="text-white/60 mb-2">Light theme, no header:</p>
                    <CodeBlock
                      code={`<iframe src="${baseUrl}/embed/TOKEN_ADDRESS?theme=light&header=false" width="100%" height="400" frameborder="0"></iframe>`}
                      language="html"
                    />
                  </div>

                  <div>
                    <p className="text-white/60 mb-2">Pro embed (no watermark):</p>
                    <CodeBlock
                      code={`<iframe src="${baseUrl}/embed/TOKEN_ADDRESS?license=YOUR_LICENSE_KEY" width="100%" height="500" frameborder="0"></iframe>`}
                      language="html"
                    />
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* API Reference */}
          {activeSection === "api" && (
            <section className="space-y-8">
              <div>
                <h1 className="text-4xl font-bold mb-4">API Reference</h1>
                <p className="text-white/60 text-lg">
                  REST API for programmatic access to Polyx data.
                </p>
              </div>

              <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <div className="flex items-center gap-2 text-purple-400 font-semibold mb-2">
                  <Shield className="w-5 h-5" />
                  Business Plan Required
                </div>
                <p className="text-white/60 text-sm">
                  API access requires a Business subscription. Rate limited to 5,000 compute units per month.
                </p>
              </div>

              {/* OHLCV Endpoint */}
              <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                <div className="flex items-center gap-3 mb-4">
                  <span className="px-2 py-1 text-xs font-bold rounded bg-green-500/20 text-green-400">
                    GET
                  </span>
                  <code className="text-sm font-mono">/api/v1/ohlcv/:address</code>
                </div>
                <p className="text-white/60 mb-4">Get OHLCV candlestick data for any Solana token.</p>

                <h4 className="text-sm font-semibold mb-2 text-white/80">Parameters</h4>
                <div className="space-y-2 mb-4">
                  <div className="flex items-start gap-2 text-sm">
                    <code className="text-[#FF6B4A]">address</code>
                    <span className="text-red-400 text-xs">required</span>
                    <span className="text-white/60">— Solana token mint address</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <code className="text-[#FF6B4A]">timeframe</code>
                    <span className="text-white/60">— 1m, 5m, 15m, 1h, 4h, 1d (default: 1h)</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <code className="text-[#FF6B4A]">limit</code>
                    <span className="text-white/60">— Number of candles (default: 100, max: 1000)</span>
                  </div>
                </div>

                <h4 className="text-sm font-semibold mb-2 text-white/80">Response</h4>
                <CodeBlock
                  code={`[
  {
    "timestamp": 1703462400000,
    "open": 100.5,
    "high": 102.3,
    "low": 99.8,
    "close": 101.2,
    "volume": 1234567
  },
  ...
]`}
                  language="json"
                />
              </div>

              {/* License Endpoint */}
              <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                <div className="flex items-center gap-3 mb-4">
                  <span className="px-2 py-1 text-xs font-bold rounded bg-green-500/20 text-green-400">
                    GET
                  </span>
                  <code className="text-sm font-mono">/api/embed/license</code>
                </div>
                <p className="text-white/60 mb-4">Generate a license key for embedding (requires active subscription).</p>

                <h4 className="text-sm font-semibold mb-2 text-white/80">Parameters</h4>
                <div className="space-y-2 mb-4">
                  <div className="flex items-start gap-2 text-sm">
                    <code className="text-[#FF6B4A]">email</code>
                    <span className="text-red-400 text-xs">required</span>
                    <span className="text-white/60">— Your subscription email</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <code className="text-[#FF6B4A]">domain</code>
                    <span className="text-white/60">— Domain restriction (optional)</span>
                  </div>
                </div>

                <h4 className="text-sm font-semibold mb-2 text-white/80">Response</h4>
                <CodeBlock
                  code={`{
  "licenseKey": "user@example.com:abc123...",
  "email": "user@example.com",
  "domain": "*",
  "plan": "PRO"
}`}
                  language="json"
                />
              </div>
            </section>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/10 mt-16">
        <div className="max-w-7xl mx-auto px-6 py-8 flex items-center justify-between">
          <div className="text-sm text-white/40">
            © 2024 Polyx. All rights reserved.
          </div>
          <div className="flex items-center gap-6">
            <Link href="/solutions" className="text-sm text-white/40 hover:text-white transition-colors">
              Solutions
            </Link>
            <a href="mailto:support@polyx.xyz" className="text-sm text-white/40 hover:text-white transition-colors">
              Support
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Code Block Component with Copy
function CodeBlock({ code, language }: { code: string; language: string }) {
  return (
    <div className="relative group">
      <pre className="p-4 bg-[#111] rounded-lg overflow-x-auto border border-white/10 pr-12">
        <code className="text-sm text-white/80 font-mono">{code}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  );
}

// Copy Button Component
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copyText = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copyText}
      className="absolute top-2 right-2 p-2 bg-white/10 hover:bg-white/20 rounded-md transition-colors"
      title="Copy"
    >
      {copied ? (
        <Check className="w-4 h-4 text-green-400" />
      ) : (
        <Copy className="w-4 h-4 text-white/60" />
      )}
    </button>
  );
}
