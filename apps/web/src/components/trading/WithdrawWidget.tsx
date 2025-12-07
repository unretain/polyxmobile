"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Loader2, ExternalLink, Copy, Check } from "lucide-react";

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
  }>;
}

export function WithdrawWidget() {
  const { data: session, status } = useSession();
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [destinationAddress, setDestinationAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedToken, setSelectedToken] = useState<string>(SOL_MINT);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch balance
  const fetchBalance = useCallback(async () => {
    if (status !== "authenticated") return;

    try {
      const res = await fetch("/api/trading/balance");
      if (res.ok) {
        const data = await res.json();
        setBalance(data);
      }
    } catch (err) {
      console.error("Failed to fetch balance:", err);
    }
  }, [status]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

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

      if (data.explorerUrl) {
        window.open(data.explorerUrl, "_blank");
      }
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

  const copyAddress = () => {
    if (balance?.walletAddress) {
      navigator.clipboard.writeText(balance.walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (status === "loading") {
    return (
      <div className="bg-[#1a1a1a] rounded-xl p-6 border border-white/10">
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 animate-spin text-white/50" />
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="bg-[#1a1a1a] rounded-xl p-6 border border-white/10">
        <div className="text-center">
          <p className="text-white/60 mb-4">Sign in to withdraw</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1a1a1a] rounded-xl p-4 border border-white/10">
      <h3 className="text-lg font-medium text-white mb-4">Withdraw</h3>

      {/* Deposit Address */}
      {balance && (
        <div className="mb-4 p-3 bg-black/30 rounded-lg">
          <div className="text-sm text-white/40 mb-1">Your Deposit Address</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm text-[#00ffa3] font-mono break-all">
              {balance.walletAddress}
            </code>
            <button
              onClick={copyAddress}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-400" />
              ) : (
                <Copy className="w-4 h-4 text-white/40" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Token Selection */}
      <div className="mb-4">
        <label className="text-sm text-white/40 mb-2 block">Token</label>
        <select
          value={selectedToken}
          onChange={(e) => setSelectedToken(e.target.value)}
          className="w-full bg-black/30 text-white px-4 py-3 rounded-xl border border-white/10 outline-none focus:border-[#00ffa3]/50"
        >
          <option value={SOL_MINT}>SOL ({balance?.sol.uiBalance.toFixed(4) || 0})</option>
          {balance?.tokens.map((token) => (
            <option key={token.mint} value={token.mint}>
              {token.mint.slice(0, 8)}... ({token.uiBalance.toFixed(4)})
            </option>
          ))}
        </select>
      </div>

      {/* Amount */}
      <div className="mb-4">
        <div className="flex justify-between text-sm text-white/40 mb-2">
          <label>Amount</label>
          <span>Balance: {getSelectedBalance().toFixed(4)}</span>
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="flex-1 bg-black/30 text-white px-4 py-3 rounded-xl border border-white/10 outline-none focus:border-[#00ffa3]/50"
          />
          <button
            onClick={() => setAmount(getSelectedBalance().toString())}
            className="px-4 py-3 bg-white/5 text-white/60 rounded-xl hover:bg-white/10 transition-colors"
          >
            MAX
          </button>
        </div>
      </div>

      {/* Destination Address */}
      <div className="mb-4">
        <label className="text-sm text-white/40 mb-2 block">
          Destination Address
        </label>
        <input
          type="text"
          value={destinationAddress}
          onChange={(e) => setDestinationAddress(e.target.value)}
          placeholder="Solana wallet address..."
          className="w-full bg-black/30 text-white px-4 py-3 rounded-xl border border-white/10 outline-none focus:border-[#00ffa3]/50 font-mono text-sm"
        />
      </div>

      {/* Error/Success */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">
          {success}
        </div>
      )}

      {/* Withdraw Button */}
      <button
        onClick={handleWithdraw}
        disabled={!destinationAddress || !amount || withdrawing}
        className={`w-full py-3 rounded-xl font-medium transition-colors ${
          !destinationAddress || !amount || withdrawing
            ? "bg-white/10 text-white/40 cursor-not-allowed"
            : "bg-[#00ffa3] text-black hover:bg-[#00dd8a]"
        }`}
      >
        {withdrawing ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Withdrawing...
          </span>
        ) : (
          "Withdraw"
        )}
      </button>
    </div>
  );
}
