"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Check } from "lucide-react";

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("quickstart");
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://polyx.xyz";

  const sections = [
    { id: "quickstart", label: "Quick Start" },
    { id: "embedding", label: "Embedding" },
    { id: "api", label: "API" },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">
            [poly<span className="text-[#FF6B4A]">x</span>]
          </Link>
          <nav className="flex items-center gap-6">
            <Link href="/solutions" className="text-sm text-white/60 hover:text-white">
              Solutions
            </Link>
            <Link
              href="/solutions#pricing"
              className="px-4 py-2 bg-[#FF6B4A] text-white text-sm font-medium rounded-lg hover:bg-[#FF6B4A]/90"
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-12 flex gap-12">
        {/* Sidebar */}
        <aside className="w-48 flex-shrink-0 hidden md:block">
          <nav className="sticky top-24 space-y-1">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeSection === section.id
                    ? "bg-[#FF6B4A]/10 text-[#FF6B4A]"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                }`}
              >
                {section.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0">
          {/* Quick Start */}
          {activeSection === "quickstart" && (
            <section className="space-y-8">
              <div>
                <h1 className="text-3xl font-bold mb-3">Quick Start</h1>
                <p className="text-white/60">
                  Embed 3D Solana charts on your website.
                </p>
              </div>

              {/* Step 1 */}
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">1. Choose a plan</h2>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                    <div className="font-medium">Free</div>
                    <div className="text-2xl font-bold">$0</div>
                    <div className="text-xs text-white/40 mt-1">With watermark</div>
                  </div>
                  <div className="p-4 bg-[#FF6B4A]/10 rounded-lg border border-[#FF6B4A]/30">
                    <div className="font-medium text-[#FF6B4A]">Pro</div>
                    <div className="text-2xl font-bold">$29<span className="text-sm font-normal text-white/40">/mo</span></div>
                    <div className="text-xs text-white/40 mt-1">No watermark</div>
                  </div>
                  <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                    <div className="font-medium">Business</div>
                    <div className="text-2xl font-bold">$99<span className="text-sm font-normal text-white/40">/mo</span></div>
                    <div className="text-xs text-white/40 mt-1">+ API access</div>
                  </div>
                </div>
                <Link href="/solutions#pricing" className="text-[#FF6B4A] text-sm hover:underline">
                  View pricing →
                </Link>
              </div>

              {/* Step 2 */}
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">2. Get your license key</h2>
                <p className="text-white/60 text-sm">
                  Pro/Business subscribers can generate a license key from the dashboard. Free users skip this step.
                </p>
                <Link
                  href="/dashboard/license"
                  className="inline-block px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 text-sm"
                >
                  Dashboard →
                </Link>
              </div>

              {/* Step 3 */}
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">3. Embed the chart</h2>
                <CodeBlock
                  code={`<iframe
  src="${baseUrl}/embed/TOKEN_ADDRESS?license=YOUR_KEY"
  width="100%"
  height="500"
  frameborder="0"
></iframe>`}
                />
                <p className="text-white/40 text-sm">
                  Replace <code className="text-[#FF6B4A]">TOKEN_ADDRESS</code> with any Solana token mint address.
                </p>
              </div>
            </section>
          )}

          {/* Embedding */}
          {activeSection === "embedding" && (
            <section className="space-y-8">
              <div>
                <h1 className="text-3xl font-bold mb-3">Embedding</h1>
                <p className="text-white/60">
                  URL parameters for customizing your embed.
                </p>
              </div>

              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Base URL</h2>
                <CodeBlock code={`${baseUrl}/embed/{TOKEN_ADDRESS}`} />
              </div>

              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Parameters</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left">
                      <th className="py-2 text-white/60 font-medium">Param</th>
                      <th className="py-2 text-white/60 font-medium">Default</th>
                      <th className="py-2 text-white/60 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    <tr>
                      <td className="py-2 font-mono text-[#FF6B4A]">license</td>
                      <td className="py-2 text-white/40">—</td>
                      <td className="py-2 text-white/60">Your license key (removes watermark)</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-mono text-[#FF6B4A]">theme</td>
                      <td className="py-2 text-white/40">dark</td>
                      <td className="py-2 text-white/60">dark | light</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-mono text-[#FF6B4A]">timeframe</td>
                      <td className="py-2 text-white/40">1h</td>
                      <td className="py-2 text-white/60">1m | 5m | 15m | 1h | 4h | 1d</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-mono text-[#FF6B4A]">header</td>
                      <td className="py-2 text-white/40">true</td>
                      <td className="py-2 text-white/60">Show token info header</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Examples</h2>
                <div className="space-y-3">
                  <div>
                    <p className="text-white/60 text-sm mb-2">SOL with 4h candles:</p>
                    <CodeBlock code={`${baseUrl}/embed/So11111111111111111111111111111111111111112?timeframe=4h`} />
                  </div>
                  <div>
                    <p className="text-white/60 text-sm mb-2">Light theme, no header:</p>
                    <CodeBlock code={`${baseUrl}/embed/TOKEN?theme=light&header=false`} />
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* API */}
          {activeSection === "api" && (
            <section className="space-y-8">
              <div>
                <h1 className="text-3xl font-bold mb-3">API</h1>
                <p className="text-white/60">
                  REST API for OHLCV data. Requires Business plan.
                </p>
              </div>

              <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <p className="text-purple-400 font-medium">Business plan required</p>
                <p className="text-white/60 text-sm">Rate limited to 5,000 requests/month.</p>
              </div>

              <div className="space-y-4">
                <h2 className="text-lg font-semibold">GET /api/v1/ohlcv/:address</h2>
                <p className="text-white/60 text-sm">Get OHLCV candlestick data for any Solana token.</p>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Parameters:</p>
                  <ul className="text-sm text-white/60 space-y-1">
                    <li><code className="text-[#FF6B4A]">address</code> — Token mint address (required)</li>
                    <li><code className="text-[#FF6B4A]">timeframe</code> — 1m, 5m, 15m, 1h, 4h, 1d (default: 1h)</li>
                    <li><code className="text-[#FF6B4A]">limit</code> — Number of candles (default: 100, max: 1000)</li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Response:</p>
                  <CodeBlock
                    code={`[
  {
    "timestamp": 1703462400000,
    "open": 100.5,
    "high": 102.3,
    "low": 99.8,
    "close": 101.2,
    "volume": 1234567
  }
]`}
                  />
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <pre className="p-4 bg-[#111] rounded-lg overflow-x-auto border border-white/10 text-sm font-mono text-white/80">
        {code}
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 p-2 bg-white/10 hover:bg-white/20 rounded transition-colors"
      >
        {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-white/60" />}
      </button>
    </div>
  );
}
