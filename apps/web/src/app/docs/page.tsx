"use client";

import { useState } from "react";
import Link from "next/link";

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("quickstart");
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://polyx.xyz";

  const sections = [
    { id: "quickstart", label: "Quick Start" },
    { id: "embedding", label: "Embedding" },
    { id: "api", label: "API Reference" },
    { id: "pricing", label: "Pricing" },
    { id: "examples", label: "Examples" },
  ];

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
            <Link href="/solutions#pricing" className="text-sm text-white/60 hover:text-white transition-colors">
              Pricing
            </Link>
            <a
              href="/solutions#pricing"
              className="px-4 py-2 bg-[#FF6B4A] text-white text-sm font-medium rounded-lg hover:bg-[#FF6B4A]/90 transition-colors"
            >
              Get Started
            </a>
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-12 flex gap-12">
        {/* Sidebar */}
        <aside className="w-64 flex-shrink-0">
          <nav className="sticky top-24 space-y-1">
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
              Documentation
            </h3>
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

        {/* Main Content */}
        <main className="flex-1 min-w-0">
          {/* Quick Start */}
          {activeSection === "quickstart" && (
            <section>
              <h1 className="text-3xl font-bold mb-4">Quick Start</h1>
              <p className="text-white/60 mb-8">
                Get beautiful 3D Solana token charts embedded on your website in minutes.
              </p>

              <div className="space-y-8">
                <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[#FF6B4A] text-white text-sm flex items-center justify-center">1</span>
                    Choose Your Plan
                  </h3>
                  <p className="text-white/60 mb-4">
                    Start with our free tier (includes watermark) or subscribe to Pro/Business for full features.
                  </p>
                  <Link
                    href="/solutions#pricing"
                    className="inline-flex items-center gap-2 text-[#FF6B4A] hover:underline"
                  >
                    View Pricing →
                  </Link>
                </div>

                <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[#FF6B4A] text-white text-sm flex items-center justify-center">2</span>
                    Get Your License Key
                  </h3>
                  <p className="text-white/60 mb-4">
                    After subscribing, generate your license key using the API:
                  </p>
                  <CodeBlock
                    code={`GET /api/embed/license?email=YOUR_EMAIL&domain=YOUR_DOMAIN`}
                    language="http"
                  />
                  <p className="text-white/40 text-sm mt-4">
                    Free tier users can skip this step - embeds work without a license key (with watermark).
                  </p>
                </div>

                <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[#FF6B4A] text-white text-sm flex items-center justify-center">3</span>
                    Embed the Chart
                  </h3>
                  <p className="text-white/60 mb-4">
                    Add this iframe to your website:
                  </p>
                  <CodeBlock
                    code={`<iframe
  src="${baseUrl}/embed/TOKEN_ADDRESS?license=YOUR_LICENSE_KEY"
  width="100%"
  height="500"
  frameborder="0"
  style="border-radius: 8px;"
></iframe>`}
                    language="html"
                  />
                </div>
              </div>
            </section>
          )}

          {/* Embedding */}
          {activeSection === "embedding" && (
            <section>
              <h1 className="text-3xl font-bold mb-4">Embedding Charts</h1>
              <p className="text-white/60 mb-8">
                Two ways to embed Polyx charts on your website.
              </p>

              <div className="space-y-8">
                <div>
                  <h2 className="text-xl font-semibold mb-4">iFrame Embed (Recommended)</h2>
                  <p className="text-white/60 mb-4">
                    The simplest way to embed a chart. Just paste this HTML:
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

                  <h3 className="text-lg font-semibold mt-8 mb-4">URL Parameters</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left py-3 px-4 text-white/60 font-medium">Parameter</th>
                          <th className="text-left py-3 px-4 text-white/60 font-medium">Type</th>
                          <th className="text-left py-3 px-4 text-white/60 font-medium">Default</th>
                          <th className="text-left py-3 px-4 text-white/60 font-medium">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        <tr>
                          <td className="py-3 px-4 font-mono text-[#FF6B4A]">license</td>
                          <td className="py-3 px-4 text-white/60">string</td>
                          <td className="py-3 px-4 text-white/40">-</td>
                          <td className="py-3 px-4 text-white/60">Your license key (optional for free tier)</td>
                        </tr>
                        <tr>
                          <td className="py-3 px-4 font-mono text-[#FF6B4A]">theme</td>
                          <td className="py-3 px-4 text-white/60">string</td>
                          <td className="py-3 px-4 text-white/40">dark</td>
                          <td className="py-3 px-4 text-white/60">&quot;dark&quot; or &quot;light&quot;</td>
                        </tr>
                        <tr>
                          <td className="py-3 px-4 font-mono text-[#FF6B4A]">timeframe</td>
                          <td className="py-3 px-4 text-white/60">string</td>
                          <td className="py-3 px-4 text-white/40">1h</td>
                          <td className="py-3 px-4 text-white/60">1m, 5m, 15m, 1h, 4h, 1d</td>
                        </tr>
                        <tr>
                          <td className="py-3 px-4 font-mono text-[#FF6B4A]">header</td>
                          <td className="py-3 px-4 text-white/60">boolean</td>
                          <td className="py-3 px-4 text-white/40">true</td>
                          <td className="py-3 px-4 text-white/60">Show/hide token info header</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h2 className="text-xl font-semibold mb-4">JavaScript SDK (Advanced)</h2>
                  <p className="text-white/60 mb-4">
                    For more control, use our JavaScript SDK:
                  </p>
                  <CodeBlock
                    code={`<div id="polyx-chart"></div>
<script src="${baseUrl}/embed.js"></script>
<script>
  PolyxChart.render({
    container: '#polyx-chart',
    token: 'TOKEN_ADDRESS',
    license: 'YOUR_LICENSE_KEY',
    theme: 'dark',
    timeframe: '1h',
    width: '100%',
    height: 500
  });
</script>`}
                    language="html"
                  />
                </div>
              </div>
            </section>
          )}

          {/* API Reference */}
          {activeSection === "api" && (
            <section>
              <h1 className="text-3xl font-bold mb-4">API Reference</h1>
              <p className="text-white/60 mb-8">
                Complete API documentation for the Polyx embed service.
              </p>

              <div className="space-y-8">
                <ApiEndpoint
                  method="GET"
                  path="/api/pricing"
                  description="Get available subscription plans and pricing"
                  response={`{
  "plans": [
    {
      "id": "FREE",
      "name": "Free",
      "price": 0,
      "features": { "watermark": true, ... }
    },
    ...
  ],
  "currency": "USD",
  "billingCycle": "monthly"
}`}
                />

                <ApiEndpoint
                  method="POST"
                  path="/api/checkout"
                  description="Create a Stripe checkout session for subscription"
                  body={`{
  "plan": "PRO",  // or "BUSINESS"
  "email": "user@example.com",
  "successUrl": "https://yoursite.com/success",
  "cancelUrl": "https://yoursite.com/cancel"
}`}
                  response={`{
  "checkoutUrl": "https://checkout.stripe.com/...",
  "sessionId": "cs_..."
}`}
                />

                <ApiEndpoint
                  method="GET"
                  path="/api/subscription/status"
                  description="Check subscription status (requires authentication)"
                  params={[]}
                  response={`{
  "plan": "PRO",
  "status": "ACTIVE",
  "hasSubscription": true,
  "features": {
    "watermark": false,
    "whiteLabel": false,
    "apiAccess": false
  }
}`}
                />

                <ApiEndpoint
                  method="GET"
                  path="/api/embed/license"
                  description="Generate a license key for embedding (requires active subscription)"
                  params={[
                    { name: "email", type: "string", required: true, description: "Your subscription email" },
                    { name: "domain", type: "string", required: false, description: "Domain to restrict to" }
                  ]}
                  response={`{
  "licenseKey": "user@example.com:abc123...",
  "email": "user@example.com",
  "domain": "*",
  "plan": "PRO",
  "usage": "Add ?license=... to your embed URL"
}`}
                />

                <ApiEndpoint
                  method="POST"
                  path="/api/embed/license"
                  description="Validate a license key"
                  body={`{
  "licenseKey": "user@example.com:abc123...",
  "domain": "yoursite.com"
}`}
                  response={`{
  "valid": true,
  "plan": "PRO",
  "features": {
    "watermark": false,
    "whiteLabel": false
  }
}`}
                />

                <div className="mt-8 p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                  <h3 className="text-lg font-semibold text-purple-400 mb-2">Business API</h3>
                  <p className="text-white/60 text-sm mb-4">
                    The following endpoint requires a Business plan subscription. Rate limited to 5,000 compute units (CU) per month.
                  </p>
                </div>

                <ApiEndpoint
                  method="GET"
                  path="/api/v1/ohlcv/:address"
                  description="Get OHLCV candlestick data for any Solana token (Business tier only)"
                  params={[
                    { name: "address", type: "string", required: true, description: "Solana token mint address" },
                    { name: "timeframe", type: "string", required: false, description: "1m, 5m, 15m, 1h, 4h, 1d (default: 1h)" },
                    { name: "limit", type: "number", required: false, description: "Number of candles (default: 100, max: 1000)" },
                    { name: "from", type: "number", required: false, description: "Start timestamp (Unix seconds)" },
                    { name: "to", type: "number", required: false, description: "End timestamp (Unix seconds)" }
                  ]}
                  response={`[
  {
    "timestamp": 1703462400000,
    "open": 100.5,
    "high": 102.3,
    "low": 99.8,
    "close": 101.2,
    "volume": 1234567
  },
  ...
]

// Response Headers:
// X-RateLimit-Limit: 5000
// X-RateLimit-Remaining: 4990
// X-RateLimit-Reset: 2024-02-01T00:00:00.000Z
// X-Request-Cost: 10`}
                />
              </div>
            </section>
          )}

          {/* Pricing */}
          {activeSection === "pricing" && (
            <section>
              <h1 className="text-3xl font-bold mb-4">Pricing</h1>
              <p className="text-white/60 mb-8">
                Choose the plan that fits your needs.
              </p>

              <div className="grid md:grid-cols-3 gap-6">
                <PricingCard
                  name="Free"
                  price="$0"
                  description="For personal projects"
                  features={[
                    "Unlimited embeds",
                    "Polyx watermark",
                    "Community support",
                  ]}
                />
                <PricingCard
                  name="Pro"
                  price="$29"
                  description="For growing businesses"
                  features={[
                    "Unlimited embeds",
                    "No watermark",
                    "Custom themes",
                    "Priority support",
                  ]}
                  highlighted
                />
                <PricingCard
                  name="Business"
                  price="$99"
                  description="For enterprises"
                  features={[
                    "Unlimited embeds",
                    "No watermark",
                    "OHLCV API access",
                    "White-label option",
                    "Dedicated support",
                  ]}
                />
              </div>

              <div className="mt-8 text-center">
                <Link
                  href="/solutions#pricing"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-[#FF6B4A] text-white font-medium rounded-lg hover:bg-[#FF6B4A]/90 transition-colors"
                >
                  Subscribe Now
                </Link>
              </div>
            </section>
          )}

          {/* Examples */}
          {activeSection === "examples" && (
            <section>
              <h1 className="text-3xl font-bold mb-4">Examples</h1>
              <p className="text-white/60 mb-8">
                Real-world examples of Polyx embeds.
              </p>

              <div className="space-y-8">
                <div>
                  <h2 className="text-xl font-semibold mb-4">Basic Embed</h2>
                  <p className="text-white/60 mb-4">
                    A simple dark-themed chart for SOL:
                  </p>
                  <CodeBlock
                    code={`<iframe
  src="${baseUrl}/embed/So11111111111111111111111111111111111111112"
  width="100%"
  height="500"
  frameborder="0"
></iframe>`}
                    language="html"
                  />
                </div>

                <div>
                  <h2 className="text-xl font-semibold mb-4">Light Theme</h2>
                  <p className="text-white/60 mb-4">
                    For websites with light backgrounds:
                  </p>
                  <CodeBlock
                    code={`<iframe
  src="${baseUrl}/embed/TOKEN_ADDRESS?theme=light&header=false"
  width="100%"
  height="400"
  frameborder="0"
></iframe>`}
                    language="html"
                  />
                </div>

                <div>
                  <h2 className="text-xl font-semibold mb-4">Pro Embed (No Watermark)</h2>
                  <p className="text-white/60 mb-4">
                    Clean chart for paying subscribers:
                  </p>
                  <CodeBlock
                    code={`<iframe
  src="${baseUrl}/embed/TOKEN_ADDRESS?license=YOUR_LICENSE_KEY&timeframe=4h"
  width="100%"
  height="600"
  frameborder="0"
  style="border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.2);"
></iframe>`}
                    language="html"
                  />
                </div>

                <div>
                  <h2 className="text-xl font-semibold mb-4">React Component</h2>
                  <p className="text-white/60 mb-4">
                    Using Polyx in a React application:
                  </p>
                  <CodeBlock
                    code={`function TokenChart({ address, licenseKey }) {
  return (
    <iframe
      src={\`${baseUrl}/embed/\${address}?license=\${licenseKey}\`}
      width="100%"
      height={500}
      frameBorder="0"
      style={{ borderRadius: '8px' }}
    />
  );
}

// Usage
<TokenChart
  address="So11111111111111111111111111111111111111112"
  licenseKey={process.env.POLYX_LICENSE}
/>`}
                    language="tsx"
                  />
                </div>
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

// Code Block Component
function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <pre className="p-4 bg-[#111] rounded-lg overflow-x-auto border border-white/10">
        <code className="text-sm text-white/80 font-mono">{code}</code>
      </pre>
      <button
        onClick={copyCode}
        className="absolute top-2 right-2 px-2 py-1 text-xs bg-white/10 hover:bg-white/20 rounded transition-colors opacity-0 group-hover:opacity-100"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

// API Endpoint Component
function ApiEndpoint({
  method,
  path,
  description,
  params,
  body,
  response,
}: {
  method: string;
  path: string;
  description: string;
  params?: { name: string; type: string; required: boolean; description: string }[];
  body?: string;
  response: string;
}) {
  return (
    <div className="p-6 bg-white/5 rounded-xl border border-white/10">
      <div className="flex items-center gap-3 mb-4">
        <span className={`px-2 py-1 text-xs font-bold rounded ${
          method === "GET" ? "bg-green-500/20 text-green-400" : "bg-blue-500/20 text-blue-400"
        }`}>
          {method}
        </span>
        <code className="text-sm font-mono text-white">{path}</code>
      </div>
      <p className="text-white/60 mb-4">{description}</p>

      {params && params.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold mb-2 text-white/80">Parameters</h4>
          <div className="space-y-2">
            {params.map((param) => (
              <div key={param.name} className="flex items-start gap-2 text-sm">
                <code className="text-[#FF6B4A]">{param.name}</code>
                <span className="text-white/40">{param.type}</span>
                {param.required && <span className="text-red-400 text-xs">required</span>}
                <span className="text-white/60">- {param.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {body && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold mb-2 text-white/80">Request Body</h4>
          <pre className="p-3 bg-[#111] rounded-lg text-xs overflow-x-auto border border-white/10">
            <code className="text-white/70 font-mono">{body}</code>
          </pre>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold mb-2 text-white/80">Response</h4>
        <pre className="p-3 bg-[#111] rounded-lg text-xs overflow-x-auto border border-white/10">
          <code className="text-white/70 font-mono">{response}</code>
        </pre>
      </div>
    </div>
  );
}

// Pricing Card Component
function PricingCard({
  name,
  price,
  description,
  features,
  highlighted,
}: {
  name: string;
  price: string;
  description: string;
  features: string[];
  highlighted?: boolean;
}) {
  return (
    <div className={`p-6 rounded-xl border ${
      highlighted
        ? "bg-[#FF6B4A]/10 border-[#FF6B4A]/30"
        : "bg-white/5 border-white/10"
    }`}>
      <h3 className="text-xl font-bold mb-1">{name}</h3>
      <p className="text-white/60 text-sm mb-4">{description}</p>
      <div className="mb-6">
        <span className="text-3xl font-bold">{price}</span>
        <span className="text-white/40">/month</span>
      </div>
      <ul className="space-y-3">
        {features.map((feature, i) => (
          <li key={i} className="flex items-center gap-2 text-sm text-white/70">
            <svg className="w-4 h-4 text-[#FF6B4A]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {feature}
          </li>
        ))}
      </ul>
    </div>
  );
}
