"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { ArrowDownIcon, Loader2, RefreshCw } from "lucide-react";

const SOL_MINT = "So11111111111111111111111111111111111111112";

interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  outAmountMin: string;
  priceImpactPct: number;
  slippageBps: number;
  routePlan: Array<{ label: string; percent: number }>;
  _rawQuote: unknown;
}

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

interface SwapWidgetProps {
  defaultOutputMint?: string;
  outputSymbol?: string;
  outputDecimals?: number;
  isGraduated?: boolean; // Whether token has graduated from bonding curve
}

export function SwapWidget({
  defaultOutputMint,
  outputSymbol = "TOKEN",
  outputDecimals = 9,
  isGraduated = true, // Default to true for backward compatibility
}: SwapWidgetProps) {
  const { data: session, status } = useSession();
  const [inputAmount, setInputAmount] = useState("");
  const [slippage, setSlippage] = useState(50); // 0.5% default
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isBuy, setIsBuy] = useState(true); // true = buy token, false = sell token

  const inputMint = isBuy ? SOL_MINT : defaultOutputMint;
  const outputMint = isBuy ? defaultOutputMint : SOL_MINT;
  const inputSymbol = isBuy ? "SOL" : outputSymbol;
  const inputDecimals = isBuy ? 9 : outputDecimals;

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

  // Fetch quote when input changes
  useEffect(() => {
    const fetchQuote = async () => {
      if (!inputAmount || !inputMint || !outputMint) {
        setQuote(null);
        return;
      }

      const amountNum = parseFloat(inputAmount);
      if (isNaN(amountNum) || amountNum <= 0) {
        setQuote(null);
        return;
      }

      // Convert to raw amount
      const rawAmount = Math.floor(amountNum * Math.pow(10, inputDecimals)).toString();

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/trading/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${rawAmount}&slippage=${slippage}`
        );
        const data = await res.json();

        if (!res.ok) {
          // Provide user-friendly error messages
          let errorMsg = data.error || "Failed to get quote";
          if (errorMsg.includes("TOKEN_NOT_TRADABLE") || errorMsg.includes("not tradable")) {
            errorMsg = "This token hasn't migrated to Raydium yet. Only graduated tokens can be traded.";
          } else if (errorMsg.includes("Unauthorized") || errorMsg.includes("401")) {
            errorMsg = "RPC connection error. Please try again later.";
          }
          throw new Error(errorMsg);
        }

        setQuote(data);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Quote failed";
        // Don't show error for common non-critical issues
        if (!errorMsg.includes("No route found")) {
          setError(errorMsg);
        }
        setQuote(null);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(fetchQuote, 300);
    return () => clearTimeout(debounce);
  }, [inputAmount, inputMint, outputMint, slippage, inputDecimals]);

  // Execute swap
  const handleSwap = async () => {
    if (!quote || !inputMint || !outputMint) return;

    setSwapping(true);
    setError(null);
    setSuccess(null);

    try {
      const rawAmount = Math.floor(
        parseFloat(inputAmount) * Math.pow(10, inputDecimals)
      ).toString();

      const res = await fetch("/api/trading/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputMint,
          outputMint,
          amount: rawAmount,
          slippageBps: slippage,
          inputSymbol: isBuy ? "SOL" : outputSymbol,
          outputSymbol: isBuy ? outputSymbol : "SOL",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Swap failed");
      }

      setSuccess(`Swap successful! View on Solscan`);
      setInputAmount("");
      setQuote(null);
      fetchBalance(); // Refresh balance

      // Open explorer in new tab
      if (data.explorerUrl) {
        window.open(data.explorerUrl, "_blank");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Swap failed");
    } finally {
      setSwapping(false);
    }
  };

  // Get available balance for input token
  const getInputBalance = () => {
    if (!balance) return 0;
    if (inputMint === SOL_MINT) {
      return balance.sol.uiBalance;
    }
    const token = balance.tokens.find((t) => t.mint === inputMint);
    return token?.uiBalance || 0;
  };

  // Format output amount
  const formatOutputAmount = () => {
    if (!quote) return "0";
    const outDecimals = isBuy ? outputDecimals : 9;
    const amount = Number(quote.outAmount) / Math.pow(10, outDecimals);
    return amount.toLocaleString(undefined, { maximumFractionDigits: 6 });
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
          <p className="text-white/60 mb-4">Sign in to trade</p>
          <a
            href="/auth/signin"
            className="inline-block px-4 py-2 bg-[#00ffa3] text-black rounded-lg font-medium hover:bg-[#00dd8a] transition-colors"
          >
            Sign In
          </a>
        </div>
      </div>
    );
  }

  // Show message for non-graduated tokens
  if (!isGraduated) {
    return (
      <div className="bg-[#1a1a1a] rounded-xl p-6 border border-white/10">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-yellow-500/10 flex items-center justify-center mx-auto mb-3">
            <span className="text-2xl">⏳</span>
          </div>
          <p className="text-white font-medium mb-2">Token Not Yet Tradable</p>
          <p className="text-white/50 text-sm">
            This token is still on the bonding curve. Trading will be available once it graduates to Raydium.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1a1a1a] rounded-xl p-4 border border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          <button
            onClick={() => setIsBuy(true)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              isBuy
                ? "bg-[#00ffa3] text-black"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => setIsBuy(false)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              !isBuy
                ? "bg-red-500 text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            Sell
          </button>
        </div>
        <button
          onClick={fetchBalance}
          className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          title="Refresh balance"
        >
          <RefreshCw className="w-4 h-4 text-white/40" />
        </button>
      </div>

      {/* Input */}
      <div className="bg-black/30 rounded-xl p-4 mb-2">
        <div className="flex justify-between text-sm text-white/40 mb-2">
          <span>You pay</span>
          <span>
            Balance: {getInputBalance().toLocaleString(undefined, { maximumFractionDigits: 4 })}{" "}
            {inputSymbol}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={inputAmount}
            onChange={(e) => setInputAmount(e.target.value)}
            placeholder="0.0"
            className="flex-1 bg-transparent text-2xl font-medium text-white outline-none"
          />
          <div className="flex items-center gap-2 px-3 py-2 bg-white/5 rounded-lg">
            <span className="font-medium">{inputSymbol}</span>
          </div>
        </div>
        <button
          onClick={() => setInputAmount(getInputBalance().toString())}
          className="mt-2 text-xs text-[#00ffa3] hover:underline"
        >
          MAX
        </button>
      </div>

      {/* Arrow */}
      <div className="flex justify-center -my-2 z-10 relative">
        <div className="bg-[#1a1a1a] p-2 rounded-lg border border-white/10">
          <ArrowDownIcon className="w-4 h-4 text-white/40" />
        </div>
      </div>

      {/* Output */}
      <div className="bg-black/30 rounded-xl p-4 mt-2">
        <div className="flex justify-between text-sm text-white/40 mb-2">
          <span>You receive</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 text-2xl font-medium text-white">
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              formatOutputAmount()
            )}
          </div>
          <div className="flex items-center gap-2 px-3 py-2 bg-white/5 rounded-lg">
            <span className="font-medium">{isBuy ? outputSymbol : "SOL"}</span>
          </div>
        </div>
      </div>

      {/* Quote Details */}
      {quote && (
        <div className="mt-4 p-3 bg-black/20 rounded-lg text-sm">
          <div className="flex justify-between text-white/60">
            <span>Price Impact</span>
            <span
              className={
                quote.priceImpactPct > 5
                  ? "text-red-400"
                  : quote.priceImpactPct > 1
                  ? "text-yellow-400"
                  : "text-green-400"
              }
            >
              {quote.priceImpactPct.toFixed(2)}%
            </span>
          </div>
          <div className="flex justify-between text-white/60 mt-1">
            <span>Slippage</span>
            <span>{slippage / 100}%</span>
          </div>
          <div className="flex justify-between text-white/60 mt-1">
            <span>Route</span>
            <span>{quote.routePlan.map((r) => r.label).join(" → ")}</span>
          </div>
        </div>
      )}

      {/* Slippage Settings */}
      <div className="mt-4 flex items-center gap-2">
        <span className="text-sm text-white/40">Slippage:</span>
        {[50, 100, 300].map((bps) => (
          <button
            key={bps}
            onClick={() => setSlippage(bps)}
            className={`px-2 py-1 text-xs rounded ${
              slippage === bps
                ? "bg-[#00ffa3] text-black"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            {bps / 100}%
          </button>
        ))}
      </div>

      {/* Error/Success */}
      {error && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">
          {success}
        </div>
      )}

      {/* Swap Button */}
      <button
        onClick={handleSwap}
        disabled={!quote || swapping || loading}
        className={`w-full mt-4 py-3 rounded-xl font-medium transition-colors ${
          !quote || swapping || loading
            ? "bg-white/10 text-white/40 cursor-not-allowed"
            : isBuy
            ? "bg-[#00ffa3] text-black hover:bg-[#00dd8a]"
            : "bg-red-500 text-white hover:bg-red-600"
        }`}
      >
        {swapping ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Swapping...
          </span>
        ) : !quote ? (
          "Enter an amount"
        ) : isBuy ? (
          `Buy ${outputSymbol}`
        ) : (
          `Sell ${outputSymbol}`
        )}
      </button>

      {/* Wallet Address */}
      {balance && (
        <div className="mt-4 text-center text-xs text-white/40">
          Wallet: {balance.walletAddress.slice(0, 6)}...{balance.walletAddress.slice(-4)}
        </div>
      )}
    </div>
  );
}
