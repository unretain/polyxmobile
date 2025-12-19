"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Key, Copy, Check, RefreshCw, Globe, Eye, AlertCircle, Plus, Trash2, ExternalLink, BarChart3, Loader2, CreditCard } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { Header } from "@/components/layout/Header";

interface SubscriptionStatus {
  plan: "FREE" | "PRO" | "BUSINESS";
  status: string;
  hasSubscription: boolean;
  features: {
    domains: number;
    viewsPerMonth: number;
    watermark: boolean;
    whiteLabel?: boolean;
  };
  domains: { domain: string; isVerified: boolean }[];
  usage: {
    embedViews: number;
    limit: number;
    remaining: number;
    resetAt: string;
  };
}

interface LicenseData {
  licenseKey: string;
  plan: string;
  domains: string[];
  usage: {
    embedViews: number;
    limit: number;
  };
}

export default function LicenseDashboard() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const { isDark } = useThemeStore();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [license, setLicense] = useState<LicenseData | null>(null);
  const [domains, setDomains] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [copied, setCopied] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (sessionStatus === "unauthenticated") {
      router.push("/auth/signin?callbackUrl=/dashboard/license");
    }
  }, [sessionStatus, router]);

  // Load subscription status on mount
  useEffect(() => {
    if (sessionStatus === "authenticated") {
      loadSubscription();
    }
  }, [sessionStatus]);

  const loadSubscription = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/subscription/status");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load subscription");
      }

      setSubscription(data);
      setDomains(data.domains?.map((d: { domain: string }) => d.domain) || []);

      // If they have an active subscription, get license key
      if (data.hasSubscription) {
        await loadLicense();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  // Load license key (single key per subscription, not per domain)
  const loadLicense = async () => {
    try {
      const response = await fetch("/api/embed/license");
      const data = await response.json();

      if (response.ok) {
        setLicense(data);
      } else if (response.status !== 403) {
        console.error("License error:", data.error);
      }
    } catch (err) {
      console.error("License error:", err);
    }
  };

  // Copy license key to clipboard
  const copyLicense = async () => {
    if (license?.licenseKey) {
      await navigator.clipboard.writeText(license.licenseKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Add a new domain
  const addDomain = async () => {
    if (!newDomain || domains.includes(newDomain)) return;

    try {
      const response = await fetch("/api/subscription/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: newDomain }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to add domain");
        return;
      }

      setDomains([...domains, newDomain]);
      setNewDomain("");
      setError(null);
    } catch {
      setError("Failed to add domain");
    }
  };

  // Remove a domain
  const removeDomain = async (domain: string) => {
    try {
      const response = await fetch(`/api/subscription/domains?domain=${encodeURIComponent(domain)}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to remove domain");
        return;
      }

      setDomains(domains.filter((d) => d !== domain));
      setError(null);
    } catch {
      setError("Failed to remove domain");
    }
  };

  // Open billing portal
  const openBillingPortal = async () => {
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const data = await response.json();

      if (response.ok && data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Failed to open billing portal");
      }
    } catch (err) {
      setError("Failed to open billing portal");
    }
  };

  // Loading state
  if (sessionStatus === "loading" || (sessionStatus === "authenticated" && isLoading)) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-[#0a0a0a] text-white' : 'bg-gray-50 text-gray-900'}`}>
        <Loader2 className="h-8 w-8 animate-spin text-[#FF6B4A]" />
      </div>
    );
  }

  // Not authenticated
  if (sessionStatus === "unauthenticated") {
    return null; // Will redirect
  }

  const maxDomains = subscription?.features?.domains === -1 ? Infinity : (subscription?.features?.domains || 1);
  const canAddDomain = domains.length < maxDomains;

  return (
    <div className={`min-h-screen ${isDark ? 'bg-[#0a0a0a] text-white' : 'bg-gray-50 text-gray-900'}`}>
      <Header />

      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className={`text-3xl font-bold mb-2 flex items-center gap-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            <Key className="h-8 w-8 text-[#FF6B4A]" />
            License Dashboard
          </h1>
          <p className={isDark ? 'text-white/60' : 'text-gray-600'}>
            Manage your embed license keys and domain restrictions.
          </p>
          {session?.user?.email && (
            <p className={`text-sm mt-1 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
              Signed in as {session.user.email}
            </p>
          )}
        </div>

        {error && (
          <div className="mb-8 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400">
            <AlertCircle className="h-5 w-5" />
            {error}
            <button
              onClick={loadSubscription}
              className="ml-auto text-sm underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {subscription && (
          <div className="space-y-6">
            {/* Plan Overview */}
            <div className={`p-6 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
              <div className="flex items-center justify-between mb-6">
                <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Subscription Status</h2>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  subscription.plan === "BUSINESS"
                    ? "bg-purple-500/20 text-purple-500"
                    : subscription.plan === "PRO"
                    ? "bg-[#FF6B4A]/20 text-[#FF6B4A]"
                    : isDark ? "bg-white/10 text-white/60" : "bg-gray-100 text-gray-600"
                }`}>
                  {subscription.plan}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className={`p-4 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  <div className={`text-xs mb-1 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Status</div>
                  <div className={`font-medium ${subscription.hasSubscription ? "text-green-500" : isDark ? "text-white/60" : "text-gray-600"}`}>
                    {subscription.hasSubscription ? "Active" : "Free Tier"}
                  </div>
                </div>
                <div className={`p-4 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  <div className={`text-xs mb-1 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Domains</div>
                  <div className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {subscription.features.domains === -1 ? "Unlimited" : subscription.features.domains}
                  </div>
                </div>
                <div className={`p-4 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  <div className={`text-xs mb-1 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Views/Month</div>
                  <div className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {subscription.features.viewsPerMonth === -1 ? "Unlimited" : subscription.features.viewsPerMonth.toLocaleString()}
                  </div>
                </div>
                <div className={`p-4 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  <div className={`text-xs mb-1 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Watermark</div>
                  <div className={`font-medium ${subscription.features.watermark ? (isDark ? "text-white/60" : "text-gray-600") : "text-green-500"}`}>
                    {subscription.features.watermark ? "Yes" : "Removed"}
                  </div>
                </div>
              </div>

              {!subscription.hasSubscription ? (
                <Link
                  href="/solutions#pricing"
                  className="mt-6 w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#FF6B4A] text-white font-medium rounded-lg hover:bg-[#FF6B4A]/90 transition-colors"
                >
                  Upgrade to Pro
                  <ExternalLink className="h-4 w-4" />
                </Link>
              ) : (
                <button
                  onClick={openBillingPortal}
                  className={`mt-6 w-full flex items-center justify-center gap-2 px-6 py-3 border font-medium rounded-lg transition-colors ${isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-300 text-gray-900 hover:bg-gray-100'}`}
                >
                  <CreditCard className="h-4 w-4" />
                  Manage Subscription
                </button>
              )}
            </div>

            {/* Usage Statistics */}
            {subscription.usage && (
              <div className={`p-6 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className={`text-lg font-semibold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    <BarChart3 className="h-5 w-5 text-[#FF6B4A]" />
                    Usage This Period
                  </h2>
                  <button
                    onClick={loadSubscription}
                    className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
                    title="Refresh usage"
                  >
                    <RefreshCw className={`h-4 w-4 ${isDark ? 'text-white/40' : 'text-gray-400'}`} />
                  </button>
                </div>

                {/* Usage Progress Bar */}
                <div className="mb-4">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className={isDark ? 'text-white/60' : 'text-gray-600'}>Embed Views</span>
                    <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {subscription.usage.embedViews.toLocaleString()} / {subscription.usage.limit === -1 ? "∞" : subscription.usage.limit.toLocaleString()}
                    </span>
                  </div>
                  <div className={`h-3 rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}>
                    <div
                      className={`h-full transition-all ${
                        subscription.usage.limit !== -1 && subscription.usage.embedViews / subscription.usage.limit > 0.9
                          ? "bg-red-500"
                          : subscription.usage.limit !== -1 && subscription.usage.embedViews / subscription.usage.limit > 0.7
                          ? "bg-yellow-500"
                          : "bg-[#FF6B4A]"
                      }`}
                      style={{
                        width: subscription.usage.limit === -1
                          ? "5%"
                          : `${Math.min(100, (subscription.usage.embedViews / subscription.usage.limit) * 100)}%`
                      }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className={`p-3 rounded-lg text-center ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                    <div className={`text-xs mb-1 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Used</div>
                    <div className={`font-bold text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>{subscription.usage.embedViews.toLocaleString()}</div>
                  </div>
                  <div className={`p-3 rounded-lg text-center ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                    <div className={`text-xs mb-1 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Remaining</div>
                    <div className={`font-bold text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {subscription.usage.remaining === -1 ? "∞" : subscription.usage.remaining.toLocaleString()}
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg text-center ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                    <div className={`text-xs mb-1 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Resets</div>
                    <div className={`font-medium text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {new Date(subscription.usage.resetAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                {subscription.usage.limit !== -1 && subscription.usage.embedViews / subscription.usage.limit > 0.8 && (
                  <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-yellow-400">
                    <AlertCircle className="inline h-4 w-4 mr-2" />
                    You&apos;re approaching your view limit. Consider upgrading for more views.
                  </div>
                )}
              </div>
            )}

            {/* License Key - Only for paid subscribers */}
            {subscription.hasSubscription && license && (
              <div className={`p-6 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
                <h2 className={`text-lg font-semibold mb-4 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  <Key className="h-5 w-5 text-[#FF6B4A]" />
                  Your License Key
                </h2>

                <p className={`text-sm mb-4 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
                  Use this license key to embed charts without watermark. Add allowed domains below to restrict where it can be used.
                </p>

                {/* License Key Display */}
                <div className="relative">
                  <div className={`p-4 rounded-lg border font-mono text-sm break-all pr-12 ${isDark ? 'bg-[#111] border-white/10 text-white' : 'bg-gray-100 border-gray-200 text-gray-900'}`}>
                    {license.licenseKey}
                  </div>
                  <button
                    onClick={copyLicense}
                    className={`absolute top-1/2 right-3 -translate-y-1/2 p-2 rounded transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-200'}`}
                    title="Copy license key"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <Copy className={`h-4 w-4 ${isDark ? 'text-white/40' : 'text-gray-400'}`} />
                    )}
                  </button>
                </div>

                <div className={`mt-4 text-sm ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                  Add <code className="text-[#FF6B4A]">?license={license.licenseKey.slice(0, 20)}...</code> to your embed URL
                </div>
              </div>
            )}

            {/* Upgrade prompt for free users */}
            {!subscription.hasSubscription && (
              <div className="p-6 bg-gradient-to-r from-[#FF6B4A]/10 to-purple-500/10 rounded-xl border border-[#FF6B4A]/30">
                <h2 className={`text-lg font-semibold mb-2 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  <Key className="h-5 w-5 text-[#FF6B4A]" />
                  Get Your License Key
                </h2>
                <p className={`mb-4 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
                  Upgrade to Pro or Business to generate license keys for embedding charts on your website without watermarks.
                </p>
                <Link
                  href="/solutions#pricing"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-[#FF6B4A] text-white font-medium rounded-lg hover:bg-[#FF6B4A]/90 transition-colors"
                >
                  View Pricing
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            )}

            {/* Domain Management - Only for paid subscribers */}
            {subscription.hasSubscription && (
              <div className={`p-6 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
                <h2 className={`text-lg font-semibold mb-4 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  <Globe className="h-5 w-5 text-[#FF6B4A]" />
                  Registered Domains
                </h2>

                <p className={`text-sm mb-4 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
                  Register domains to restrict your license key usage. Using a wildcard (*) allows any domain.
                </p>

                {/* Domain List */}
                <div className="space-y-2 mb-4">
                  {domains.length === 0 ? (
                    <div className={`p-4 rounded-lg text-sm text-center ${isDark ? 'bg-white/5 text-white/40' : 'bg-gray-50 text-gray-500'}`}>
                      No domains registered. Using wildcard (*) - any domain allowed.
                    </div>
                  ) : (
                    domains.map((domain) => (
                      <div
                        key={domain}
                        className={`flex items-center justify-between p-3 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}
                      >
                        <span className={`font-mono text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{domain}</span>
                        <button
                          onClick={() => removeDomain(domain)}
                          className="p-1 hover:bg-red-500/20 rounded text-red-400 transition-colors"
                          title="Remove domain"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Add Domain */}
                {canAddDomain && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newDomain}
                      onChange={(e) => setNewDomain(e.target.value)}
                      placeholder="example.com"
                      className={`flex-1 px-4 py-2 border rounded-lg font-mono text-sm focus:outline-none focus:border-[#FF6B4A]/50 ${isDark ? 'bg-white/5 border-white/10 text-white placeholder:text-white/40' : 'bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400'}`}
                      onKeyDown={(e) => e.key === "Enter" && addDomain()}
                    />
                    <button
                      onClick={addDomain}
                      disabled={!newDomain}
                      className="px-4 py-2 bg-[#FF6B4A] text-white font-medium rounded-lg hover:bg-[#FF6B4A]/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      Add
                    </button>
                  </div>
                )}

                <div className={`mt-4 text-xs ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                  {domains.length} / {maxDomains === Infinity ? "∞" : maxDomains} domains used
                </div>
              </div>
            )}

            {/* Usage Example - Only for paid subscribers */}
            {subscription.hasSubscription && license && (
              <div className={`p-6 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
                <h2 className={`text-lg font-semibold mb-4 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  <Eye className="h-5 w-5 text-[#FF6B4A]" />
                  Usage Example
                </h2>

                <pre className={`p-4 rounded-lg border overflow-x-auto text-sm ${isDark ? 'bg-[#111] border-white/10' : 'bg-gray-100 border-gray-200'}`}>
                  <code className={isDark ? 'text-white/80' : 'text-gray-800'}>{`<iframe
  src="https://polyx.xyz/embed/TOKEN_ADDRESS?license=${license.licenseKey}"
  width="100%"
  height="500"
  frameborder="0"
></iframe>`}</code>
                </pre>

                <Link
                  href="/docs"
                  className="mt-4 inline-flex items-center gap-2 text-[#FF6B4A] hover:underline text-sm"
                >
                  View full documentation
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
