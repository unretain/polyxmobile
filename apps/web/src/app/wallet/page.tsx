"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  Check,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  ExternalLink,
  QrCode,
  Wallet
} from "lucide-react";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { useThemeStore } from "@/stores/themeStore";
import { shortenAddress } from "@/lib/wallet";

const SOL_MINT = "So11111111111111111111111111111111111111112";

interface BalanceResponse {
  walletAddress: string;
  sol: {
    mint: string;
    balance: string;
    uiBalance: number;
    decimals: number;
  };
  tokens: Array<{
    mint: string;
    balance: string;
    uiBalance: number;
    decimals: number;
    symbol?: string;
    name?: string;
    logoUri?: string;
  }>;
}

export default function WalletPage() {
  const router = useRouter();
  const { wallet } = useMobileWalletStore();
  const { isDark } = useThemeStore();

  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Withdraw state
  const [destinationAddress, setDestinationAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedToken, setSelectedToken] = useState<string>(SOL_MINT);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Redirect if no wallet
  useEffect(() => {
    if (!wallet) {
      router.push("/");
    }
  }, [wallet, router]);

  // Fetch balance
  const fetchBalance = useCallback(async () => {
    if (!wallet) return;

    try {
      const res = await fetch("/api/trading/balance");
      if (res.ok) {
        const data = await res.json();
        setBalance(data);
      }
    } catch (err) {
      console.error("Failed to fetch balance:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [wallet]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchBalance();
  };

  const copyAddress = async () => {
    if (wallet?.publicKey) {
      await navigator.clipboard.writeText(wallet.publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleWithdraw = async () => {
    if (!destinationAddress || !amount) return;

    setWithdrawing(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/trading/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationAddress,
          amount,
          tokenMint: selectedToken === SOL_MINT ? null : selectedToken,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Withdrawal failed");
      }

      setSuccess("Withdrawal successful!");
      setAmount("");
      setDestinationAddress("");
      fetchBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed");
    } finally {
      setWithdrawing(false);
    }
  };

  const getSelectedBalance = () => {
    if (!balance) return 0;
    if (selectedToken === SOL_MINT) {
      return balance.sol.uiBalance;
    }
    const token = balance.tokens.find((t) => t.mint === selectedToken);
    return token?.uiBalance || 0;
  };

  if (!wallet) return null;

  return (
    <div
      className={`min-h-screen ${isDark ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* Header */}
      <div className={`sticky top-0 z-10 px-4 py-4 border-b backdrop-blur-md ${
        isDark ? 'bg-[#0a0a0a]/90 border-white/10' : 'bg-white/90 border-black/10'
      }`} style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className={`p-2 rounded-full ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
          >
            <ArrowLeft className={`h-5 w-5 ${isDark ? 'text-white' : 'text-black'}`} />
          </button>

          <h1 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Wallet
          </h1>

          <button
            onClick={handleRefresh}
            className={`p-2 rounded-full ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''} ${isDark ? 'text-white' : 'text-black'}`} />
          </button>
        </div>
      </div>

      <div className="px-4 py-6 space-y-6">
        {/* Balance Card */}
        <div className={`rounded-2xl p-6 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-white border border-black/10'}`}>
          <div className="text-center mb-4">
            <p className={`text-sm mb-1 ${isDark ? 'text-white/50' : 'text-black/50'}`}>Total Balance</p>
            {loading ? (
              <div className="h-10 w-32 mx-auto rounded-lg bg-white/10 animate-pulse" />
            ) : (
              <p className={`text-3xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {balance?.sol.uiBalance.toFixed(4) || "0"} SOL
              </p>
            )}
          </div>

          {/* Wallet Address */}
          <div className={`flex items-center justify-center gap-2 p-3 rounded-xl ${isDark ? 'bg-black/30' : 'bg-gray-100'}`}>
            <Wallet className={`h-4 w-4 ${isDark ? 'text-white/40' : 'text-black/40'}`} />
            <code className={`text-sm font-mono ${isDark ? 'text-white/60' : 'text-black/60'}`}>
              {shortenAddress(wallet.publicKey, 6)}
            </code>
            <button onClick={copyAddress} className="p-1">
              {copied ? (
                <Check className="h-4 w-4 text-green-400" />
              ) : (
                <Copy className={`h-4 w-4 ${isDark ? 'text-white/40' : 'text-black/40'}`} />
              )}
            </button>
            <a
              href={`https://solscan.io/account/${wallet.publicKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1"
            >
              <ExternalLink className={`h-4 w-4 ${isDark ? 'text-white/40' : 'text-black/40'}`} />
            </a>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className={`flex gap-2 p-1 rounded-xl ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
          <button
            onClick={() => setActiveTab("deposit")}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
              activeTab === "deposit"
                ? "bg-[#FF6B4A] text-white"
                : isDark ? "text-white/60" : "text-black/60"
            }`}
          >
            <ArrowDownLeft className="h-4 w-4" />
            Deposit
          </button>
          <button
            onClick={() => setActiveTab("withdraw")}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
              activeTab === "withdraw"
                ? "bg-[#FF6B4A] text-white"
                : isDark ? "text-white/60" : "text-black/60"
            }`}
          >
            <ArrowUpRight className="h-4 w-4" />
            Withdraw
          </button>
        </div>

        {/* Deposit Tab */}
        {activeTab === "deposit" && (
          <div className={`rounded-2xl p-6 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-white border border-black/10'}`}>
            <div className="text-center space-y-4">
              <div className={`w-20 h-20 mx-auto rounded-2xl flex items-center justify-center ${isDark ? 'bg-[#FF6B4A]/20' : 'bg-[#FF6B4A]/10'}`}>
                <QrCode className="h-10 w-10 text-[#FF6B4A]" />
              </div>

              <div>
                <p className={`text-sm mb-2 ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                  Send SOL or SPL tokens to this address
                </p>
                <div className={`p-4 rounded-xl ${isDark ? 'bg-black/30' : 'bg-gray-100'}`}>
                  <code className={`text-sm font-mono break-all ${isDark ? 'text-[#FF6B4A]' : 'text-[#FF6B4A]'}`}>
                    {wallet.publicKey}
                  </code>
                </div>
              </div>

              <button
                onClick={copyAddress}
                className={`w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 ${
                  copied
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-[#FF6B4A] text-white hover:bg-[#FF8F6B]'
                } transition-colors`}
              >
                {copied ? (
                  <>
                    <Check className="h-5 w-5" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-5 w-5" />
                    Copy Address
                  </>
                )}
              </button>

              <p className={`text-xs ${isDark ? 'text-white/30' : 'text-black/30'}`}>
                Only send Solana (SOL) or SPL tokens to this address. Sending other assets may result in permanent loss.
              </p>
            </div>
          </div>
        )}

        {/* Withdraw Tab */}
        {activeTab === "withdraw" && (
          <div className={`rounded-2xl p-6 space-y-4 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-white border border-black/10'}`}>
            {/* Token Selection */}
            <div>
              <label className={`text-sm mb-2 block ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                Token
              </label>
              <select
                value={selectedToken}
                onChange={(e) => setSelectedToken(e.target.value)}
                className={`w-full px-4 py-3 rounded-xl border outline-none ${
                  isDark
                    ? 'bg-black/30 text-white border-white/10 focus:border-[#FF6B4A]/50'
                    : 'bg-gray-100 text-black border-black/10 focus:border-[#FF6B4A]/50'
                }`}
              >
                <option value={SOL_MINT}>SOL ({balance?.sol.uiBalance.toFixed(4) || 0})</option>
                {balance?.tokens.map((token) => (
                  <option key={token.mint} value={token.mint}>
                    {token.symbol || token.mint.slice(0, 8)}... ({token.uiBalance.toFixed(4)})
                  </option>
                ))}
              </select>
            </div>

            {/* Amount */}
            <div>
              <div className={`flex justify-between text-sm mb-2 ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                <label>Amount</label>
                <span>Balance: {getSelectedBalance().toFixed(4)}</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  className={`flex-1 px-4 py-3 rounded-xl border outline-none ${
                    isDark
                      ? 'bg-black/30 text-white border-white/10 focus:border-[#FF6B4A]/50'
                      : 'bg-gray-100 text-black border-black/10 focus:border-[#FF6B4A]/50'
                  }`}
                />
                <button
                  onClick={() => setAmount(getSelectedBalance().toString())}
                  className={`px-4 py-3 rounded-xl font-medium ${
                    isDark ? 'bg-white/10 text-white/60 hover:bg-white/15' : 'bg-black/10 text-black/60 hover:bg-black/15'
                  }`}
                >
                  MAX
                </button>
              </div>
            </div>

            {/* Destination Address */}
            <div>
              <label className={`text-sm mb-2 block ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                Destination Address
              </label>
              <input
                type="text"
                value={destinationAddress}
                onChange={(e) => setDestinationAddress(e.target.value)}
                placeholder="Solana wallet address..."
                className={`w-full px-4 py-3 rounded-xl border outline-none font-mono text-sm ${
                  isDark
                    ? 'bg-black/30 text-white border-white/10 focus:border-[#FF6B4A]/50'
                    : 'bg-gray-100 text-black border-black/10 focus:border-[#FF6B4A]/50'
                }`}
              />
            </div>

            {/* Error/Success */}
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 text-sm">
                {success}
              </div>
            )}

            {/* Withdraw Button */}
            <button
              onClick={handleWithdraw}
              disabled={!destinationAddress || !amount || withdrawing}
              className={`w-full py-3 rounded-xl font-medium transition-colors ${
                !destinationAddress || !amount || withdrawing
                  ? isDark ? 'bg-white/10 text-white/40 cursor-not-allowed' : 'bg-black/10 text-black/40 cursor-not-allowed'
                  : 'bg-[#FF6B4A] text-white hover:bg-[#FF8F6B]'
              }`}
            >
              {withdrawing ? (
                <span className="flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Withdrawing...
                </span>
              ) : (
                "Withdraw"
              )}
            </button>
          </div>
        )}

        {/* Token List */}
        {balance && balance.tokens.length > 0 && (
          <div className={`rounded-2xl overflow-hidden ${isDark ? 'bg-white/5 border border-white/10' : 'bg-white border border-black/10'}`}>
            <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
              <h3 className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Tokens</h3>
            </div>
            <div className="divide-y divide-white/5">
              {balance.tokens.map((token) => (
                <div key={token.mint} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {token.symbol || shortenAddress(token.mint, 4)}
                    </p>
                    <p className={`text-xs ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                      {token.name || token.mint.slice(0, 12)}...
                    </p>
                  </div>
                  <p className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {token.uiBalance.toFixed(4)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
