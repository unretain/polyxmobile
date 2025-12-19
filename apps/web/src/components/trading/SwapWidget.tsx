"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Loader2, RefreshCw, RotateCcw, Pencil, X } from "lucide-react";

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
  source?: "jupiter" | "pumpfun";
  _rawQuote?: unknown;
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
  isGraduated?: boolean;
}

export function SwapWidget({
  defaultOutputMint,
  outputSymbol = "TOKEN",
  outputDecimals = 9,
  isGraduated = true,
}: SwapWidgetProps) {
  const { data: session, status } = useSession();
  const [inputAmount, setInputAmount] = useState("");
  const [slippage, setSlippage] = useState(100);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isBuy, setIsBuy] = useState(true);
  const [tradingSource, setTradingSource] = useState<"jupiter" | "pumpfun" | null>(null);
  // Sell mode: percentage vs absolute amount toggle
  const [sellMode, setSellMode] = useState<"percent" | "amount">("percent");
  const [selectedPercent, setSelectedPercent] = useState<number | null>(null);
  // Custom percentage editing
  const [isEditingPercents, setIsEditingPercents] = useState(false);
  const [customPercents, setCustomPercents] = useState([5, 25, 50, 100]);
  const [editingPercents, setEditingPercents] = useState([5, 25, 50, 100]);

  const inputMint = isBuy ? SOL_MINT : defaultOutputMint;
  const outputMint = isBuy ? defaultOutputMint : SOL_MINT;
  const inputSymbol = isBuy ? "SOL" : outputSymbol;
  const inputDecimals = isBuy ? 9 : outputDecimals;

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
    // Auto-refresh balance every 5 seconds
    const interval = setInterval(fetchBalance, 5000);
    return () => clearInterval(interval);
  }, [fetchBalance]);

  useEffect(() => {
    const fetchQuote = async () => {
      if (!inputAmount || !inputMint || !outputMint) {
        setQuote(null);
        setTradingSource(null);
        return;
      }

      const amountNum = parseFloat(inputAmount);
      if (isNaN(amountNum) || amountNum <= 0) {
        setQuote(null);
        setTradingSource(null);
        return;
      }

      const rawAmount = Math.floor(amountNum * Math.pow(10, inputDecimals)).toString();
      setLoading(true);
      setError(null);

      try {
        // Try Jupiter first for graduated tokens, or always try Jupiter
        const res = await fetch(
          `/api/trading/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${rawAmount}&slippage=${slippage}`
        );
        const data = await res.json();

        if (res.ok) {
          // Jupiter worked - use it
          setQuote({ ...data, source: "jupiter" });
          setTradingSource("jupiter");
          return;
        }

        // Jupiter failed - try pump.fun for non-graduated tokens
        if (!isGraduated || data.error?.includes("TOKEN_NOT_TRADABLE") || data.error?.includes("No route found")) {
          console.log("[SwapWidget] Jupiter failed, trying pump.fun...");
          try {
            const pumpRes = await fetch(
              `/api/trading/pump-quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${rawAmount}&slippage=${slippage}`
            );
            const pumpData = await pumpRes.json();
            if (pumpRes.ok) {
              setQuote({ ...pumpData, source: "pumpfun" });
              setTradingSource("pumpfun");
              return;
            }
            // Pump.fun also failed - show appropriate error
            if (pumpData.code === "NOT_ON_CURVE") {
              // Token graduated but Jupiter can't find route - likely no liquidity
              throw new Error("No trading route available. Token may have low liquidity.");
            }
            throw new Error(pumpData.error || "Failed to get quote");
          } catch (pumpErr) {
            if (pumpErr instanceof Error && !pumpErr.message.includes("NOT_ON_CURVE")) {
              throw pumpErr;
            }
            // Both failed - show Jupiter's original error
            throw new Error(data.error || "Failed to get quote");
          }
        }

        // Jupiter failed with other error
        let errorMsg = data.error || "Failed to get quote";
        if (errorMsg.includes("Unauthorized") || errorMsg.includes("401")) {
          errorMsg = "RPC connection error. Please try again later.";
        }
        throw new Error(errorMsg);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Quote failed";
        if (!errorMsg.includes("No route found")) {
          setError(errorMsg);
        }
        setQuote(null);
        setTradingSource(null);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(fetchQuote, 300);
    return () => clearTimeout(debounce);
  }, [inputAmount, inputMint, outputMint, slippage, inputDecimals, isGraduated]);

  const handleSwap = async () => {
    if (!quote || !inputMint || !outputMint || !tradingSource) return;

    setSwapping(true);
    setError(null);
    setSuccess(null);

    try {
      const rawAmount = Math.floor(
        parseFloat(inputAmount) * Math.pow(10, inputDecimals)
      ).toString();

      const endpoint = tradingSource === "pumpfun"
        ? "/api/trading/pump-swap"
        : "/api/trading/swap";

      const res = await fetch(endpoint, {
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

      setSuccess("Transaction successful!");
      setInputAmount("");
      setQuote(null);
      setTradingSource(null);
      fetchBalance();

      if (data.explorerUrl) {
        window.open(data.explorerUrl, "_blank");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Swap failed");
    } finally {
      setSwapping(false);
    }
  };

  const getInputBalance = () => {
    if (!balance) return 0;
    if (inputMint === SOL_MINT) {
      return balance.sol.uiBalance;
    }
    const token = balance.tokens.find((t) => t.mint === inputMint);
    return token?.uiBalance || 0;
  };

  const formatOutputAmount = () => {
    if (!quote) return "0.0";
    const outDecimals = isBuy ? outputDecimals : 9;
    const amount = Number(quote.outAmount) / Math.pow(10, outDecimals);
    return amount.toLocaleString(undefined, { maximumFractionDigits: 6 });
  };

  // Handle sell percentage selection
  const handleSellPercent = (percent: number) => {
    setSelectedPercent(percent);
    const tokenBalance = getInputBalance();
    if (tokenBalance > 0) {
      const amount = (tokenBalance * percent) / 100;
      setInputAmount(amount.toString());
    }
  };

  // Toggle sell mode between percentage and absolute amount
  const toggleSellMode = () => {
    setSellMode(prev => prev === "percent" ? "amount" : "percent");
    setSelectedPercent(null);
    setInputAmount("");
  };

  // Save custom percentages
  const saveCustomPercents = () => {
    const sorted = [...editingPercents].sort((a, b) => a - b);
    setCustomPercents(sorted);
    setIsEditingPercents(false);
  };

  if (status === "loading") {
    return (
      <div className="bg-[#0d0d0d] border border-white/10 p-4">
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-5 h-5 animate-spin text-white/40" />
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="bg-[#0d0d0d] border border-white/10 p-4">
        <p className="text-white/50 text-sm text-center mb-3">Sign in to trade</p>
        <a
          href="/auth/signin"
          className="block w-full py-2 bg-[#00ffa3] text-black text-center text-sm font-medium hover:bg-[#00dd8a] transition-colors"
        >
          Sign In
        </a>
      </div>
    );
  }

  return (
    <div className="bg-[#0d0d0d] border border-white/10">
      {/* Tabs */}
      <div className="flex border-b border-white/10">
        <button
          onClick={() => setIsBuy(true)}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            isBuy
              ? "bg-[#00ffa3]/10 text-[#00ffa3] border-b-2 border-[#00ffa3]"
              : "text-white/50 hover:text-white/70"
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setIsBuy(false)}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            !isBuy
              ? "bg-red-500/10 text-red-400 border-b-2 border-red-400"
              : "text-white/50 hover:text-white/70"
          }`}
        >
          Sell
        </button>
      </div>

      <div className="p-4">
        {/* Amount Input */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-white/40 uppercase tracking-wide">Amount</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40">
                {getInputBalance().toFixed(4)} {inputSymbol}
              </span>
              <button
                onClick={fetchBalance}
                className="p-1 hover:bg-white/5 transition-colors"
                title="Refresh"
              >
                <RefreshCw className="w-3 h-3 text-white/40" />
              </button>
            </div>
          </div>
          {/* Fee warning for low balance */}
          {isBuy && balance && balance.sol.uiBalance < 0.01 && (
            <div className="mb-2 p-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-[10px]">
              Low balance. First-time swaps need ~0.003 SOL for fees (token account + tip).
            </div>
          )}
          <div className="flex items-center gap-2 bg-black/40 border border-white/10 p-3">
            <input
              type="number"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              placeholder="0.0"
              className="flex-1 bg-transparent text-white text-lg font-mono outline-none placeholder-white/20"
            />
            <span className="text-white/60 text-sm font-medium">{inputSymbol}</span>
          </div>
          {/* Quick amounts - different for buy vs sell */}
          {isBuy ? (
            /* Buy mode: SOL amounts */
            <div className="flex gap-2 mt-2">
              {[0.1, 0.25, 0.5, 1].map((amt) => (
                <button
                  key={amt}
                  onClick={() => setInputAmount(amt.toString())}
                  className="flex-1 py-1.5 text-xs text-white/50 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors font-mono"
                >
                  {amt}
                </button>
              ))}
            </div>
          ) : (
            /* Sell mode: percentage or amount with controls */
            <div className="mt-2">
              {isEditingPercents ? (
                /* Editing custom percentages */
                <div className="space-y-2">
                  <div className="flex gap-1">
                    {editingPercents.map((pct, i) => (
                      <input
                        key={i}
                        type="number"
                        value={pct}
                        onChange={(e) => {
                          const newVal = parseInt(e.target.value) || 0;
                          setEditingPercents(prev => {
                            const copy = [...prev];
                            copy[i] = Math.min(100, Math.max(1, newVal));
                            return copy;
                          });
                        }}
                        className="flex-1 py-1.5 px-2 text-xs text-white bg-white/10 border border-white/20 font-mono text-center outline-none focus:border-[#FF6B4A]"
                        min="1"
                        max="100"
                      />
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={saveCustomPercents}
                      className="flex-1 py-1.5 text-xs bg-[#FF6B4A] text-white hover:bg-[#FF6B4A]/80 transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditingPercents([...customPercents]);
                        setIsEditingPercents(false);
                      }}
                      className="px-3 py-1.5 text-xs text-white/50 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ) : (
                /* Normal sell controls */
                <div className="flex gap-1 items-center">
                  {sellMode === "percent" ? (
                    /* Percentage buttons */
                    <>
                      {customPercents.map((pct) => (
                        <button
                          key={pct}
                          onClick={() => handleSellPercent(pct)}
                          className={`flex-1 py-1.5 text-xs font-mono transition-colors border ${
                            selectedPercent === pct
                              ? "bg-red-500/20 text-red-400 border-red-500/50"
                              : "text-white/50 bg-white/5 hover:bg-white/10 border-white/10"
                          }`}
                        >
                          {pct}%
                        </button>
                      ))}
                    </>
                  ) : (
                    /* Token amount buttons */
                    <>
                      {[0.1, 0.25, 0.5, 1].map((multiplier) => {
                        const tokenBal = getInputBalance();
                        const amt = tokenBal * multiplier;
                        return (
                          <button
                            key={multiplier}
                            onClick={() => setInputAmount(amt.toString())}
                            className="flex-1 py-1.5 text-xs text-white/50 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors font-mono"
                          >
                            {amt >= 1000000 ? `${(amt / 1000000).toFixed(1)}M` :
                             amt >= 1000 ? `${(amt / 1000).toFixed(1)}K` :
                             amt.toFixed(amt < 1 ? 4 : 2)}
                          </button>
                        );
                      })}
                    </>
                  )}
                  {/* Rotate button */}
                  <button
                    onClick={toggleSellMode}
                    className="p-1.5 text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
                    title={sellMode === "percent" ? "Switch to token amounts" : "Switch to percentages"}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  {/* Edit button (only in percent mode) */}
                  {sellMode === "percent" && (
                    <button
                      onClick={() => {
                        setEditingPercents([...customPercents]);
                        setIsEditingPercents(true);
                      }}
                      className="p-1.5 text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
                      title="Edit percentages"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Output Display */}
        <div className="mb-4 p-3 bg-black/20 border border-white/5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/40 uppercase tracking-wide">You Receive</span>
            <span className="text-white/60 text-sm">{isBuy ? outputSymbol : "SOL"}</span>
          </div>
          <div className="mt-2 text-xl font-mono text-white">
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin text-white/40" />
            ) : (
              formatOutputAmount()
            )}
          </div>
        </div>

        {/* Quote Details */}
        {quote && (
          <div className="mb-4 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-white/40">Price Impact</span>
              <span
                className={`font-mono ${
                  quote.priceImpactPct > 5
                    ? "text-red-400"
                    : quote.priceImpactPct > 1
                    ? "text-yellow-400"
                    : "text-[#00ffa3]"
                }`}
              >
                {quote.priceImpactPct.toFixed(2)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Slippage</span>
              <span className="text-white/60 font-mono">{slippage / 100}%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-white/40">Route</span>
              <span className={`px-2 py-0.5 text-xs font-medium ${
                tradingSource === "pumpfun"
                  ? "bg-pink-500/20 text-pink-400"
                  : "bg-[#00ffa3]/20 text-[#00ffa3]"
              }`}>
                {tradingSource === "pumpfun" ? "Pump.fun" : "Jupiter"}
              </span>
            </div>
          </div>
        )}

        {/* Slippage */}
        <div className="mb-4">
          <span className="text-xs text-white/40 uppercase tracking-wide">Slippage</span>
          <div className="flex gap-2 mt-2">
            {[50, 100, 300].map((bps) => (
              <button
                key={bps}
                onClick={() => setSlippage(bps)}
                className={`flex-1 py-1.5 text-xs font-mono transition-colors border ${
                  slippage === bps
                    ? "bg-[#00ffa3]/10 text-[#00ffa3] border-[#00ffa3]/50"
                    : "text-white/50 border-white/10 hover:border-white/20"
                }`}
              >
                {bps / 100}%
              </button>
            ))}
          </div>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="mb-4 p-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-2 bg-[#00ffa3]/10 border border-[#00ffa3]/30 text-[#00ffa3] text-xs">
            {success}
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={handleSwap}
          disabled={!quote || swapping || loading}
          className={`w-full py-3 text-sm font-medium transition-colors ${
            !quote || swapping || loading
              ? "bg-white/5 text-white/30 cursor-not-allowed"
              : isBuy
              ? "bg-[#00ffa3] text-black hover:bg-[#00dd8a]"
              : "bg-red-500 text-white hover:bg-red-600"
          }`}
        >
          {swapping ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </span>
          ) : !quote ? (
            "Enter Amount"
          ) : isBuy ? (
            `Buy ${outputSymbol}`
          ) : (
            `Sell ${outputSymbol}`
          )}
        </button>

        {/* Stats Row */}
        {balance && (
          <div className="mt-4 pt-3 border-t border-white/5 grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="text-[10px] text-white/30 uppercase">Bought</div>
              <div className="text-xs text-white/50 font-mono">0</div>
            </div>
            <div>
              <div className="text-[10px] text-white/30 uppercase">Sold</div>
              <div className="text-xs text-white/50 font-mono">0</div>
            </div>
            <div>
              <div className="text-[10px] text-white/30 uppercase">Holding</div>
              <div className="text-xs text-white/50 font-mono">0</div>
            </div>
            <div>
              <div className="text-[10px] text-white/30 uppercase">PnL</div>
              <div className="text-xs text-white/50 font-mono">+0%</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
