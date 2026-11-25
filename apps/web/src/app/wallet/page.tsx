"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  Check,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  ExternalLink,
  CreditCard,
  Repeat,
} from "lucide-react";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { useThemeStore } from "@/stores/themeStore";
import { shortenAddress } from "@/lib/wallet";
import { executeClientWithdraw } from "@/lib/mobileSwap";
import { SwapWidget } from "@/components/trading";
import { OnrampModal } from "@/components/onramp/OnrampModal";
import { WalletOnboarding } from "@/components/wallet/WalletOnboarding";
import { Eye, EyeOff, KeyRound, Plus, Users } from "lucide-react";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

interface BalanceResponse {
  walletAddress: string;
  sol: {
    mint: string;
    balance: string;
    uiBalance: number;
    decimals: number;
    priceUsd?: number | null;
    valueUsd?: number | null;
  };
  tokens: Array<{
    mint: string;
    balance: string;
    uiBalance: number;
    decimals: number;
    symbol?: string;
    name?: string;
    logoUri?: string;
    valueUsd?: number | null;
  }>;
  totalValueUsd?: number | null;
}

type Panel = "buy" | "swap" | "deposit" | "withdraw";

const ACTIONS: Array<{ id: Panel; label: string; icon: typeof CreditCard }> = [
  { id: "buy", label: "Buy", icon: CreditCard },
  { id: "swap", label: "Swap", icon: Repeat },
  { id: "deposit", label: "Deposit", icon: ArrowDownLeft },
  { id: "withdraw", label: "Withdraw", icon: ArrowUpRight },
];

export default function WalletPage() {
  const router = useRouter();
  const { wallet, accounts, switchAccount } = useMobileWalletStore();
  const { isDark } = useThemeStore();

  // Account management
  const [exportOpen, setExportOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [phraseCopied, setPhraseCopied] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);

  const [panel, setPanel] = useState<Panel>("deposit");
  const [buyOpen, setBuyOpen] = useState(false);
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

  useEffect(() => {
    if (!wallet) router.push("/");
  }, [wallet, router]);

  const fetchBalance = useCallback(async () => {
    if (!wallet) return;
    try {
      const res = await fetch(`/api/trading/balance?address=${wallet.publicKey}`);
      if (res.ok) setBalance(await res.json());
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
      // Non-custodial: sign the transfer on this device. The server never holds keys.
      const mnemonic = await useMobileWalletStore.getState().getMnemonic();
      if (mnemonic) {
        const isSol = selectedToken === SOL_MINT;
        const decimals = isSol
          ? 9
          : balance?.tokens.find((t) => t.mint === selectedToken)?.decimals ?? 6;
        await executeClientWithdraw(
          mnemonic,
          destinationAddress,
          parseFloat(amount),
          isSol ? null : selectedToken,
          decimals
        );
        setSuccess("Withdrawal successful!");
        setAmount("");
        setDestinationAddress("");
        fetchBalance();
        return;
      }
      throw new Error("Wallet locked — re-import your recovery phrase in Settings to withdraw.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed");
    } finally {
      setWithdrawing(false);
    }
  };

  const getSelectedBalance = () => {
    if (!balance) return 0;
    if (selectedToken === SOL_MINT) return balance.sol.uiBalance;
    return balance.tokens.find((t) => t.mint === selectedToken)?.uiBalance || 0;
  };

  if (!wallet) return null;

  const card = `rounded-2xl border ${isDark ? "bg-white/5 border-white/10" : "bg-white border-black/10"}`;
  const input = `w-full px-4 py-3 rounded-xl border outline-none ${
    isDark
      ? "bg-black/30 text-white border-white/10 focus:border-[#FF6B4A]/50"
      : "bg-gray-100 text-black border-black/10 focus:border-[#FF6B4A]/50"
  }`;
  const totalUsd = balance?.totalValueUsd;

  return (
    <div className={`mx-auto max-w-md space-y-4 ${isDark ? "text-white" : "text-gray-900"}`}>
      {/* Balance hero */}
      <div className={`${card} p-6`}>
        <div className="flex items-start justify-between">
          <p className={`text-sm ${isDark ? "text-white/50" : "text-black/50"}`}>Total Balance</p>
          <button
            onClick={handleRefresh}
            className={`p-1.5 -m-1 rounded-full ${isDark ? "hover:bg-white/10" : "hover:bg-black/10"}`}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""} ${isDark ? "text-white/40" : "text-black/40"}`} />
          </button>
        </div>

        {loading ? (
          <div className="mt-2 h-10 w-40 rounded-lg bg-white/10 animate-pulse" />
        ) : (
          <>
            <p className="text-4xl font-bold tracking-tight">
              {totalUsd != null
                ? `$${totalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                : `${balance?.sol.uiBalance.toFixed(4) || "0"} SOL`}
            </p>
            {totalUsd != null && (
              <p className={`mt-1 text-sm ${isDark ? "text-white/40" : "text-black/40"}`}>
                {balance?.sol.uiBalance.toFixed(4)} SOL
                {balance && balance.tokens.length > 0 && ` · ${balance.tokens.length} token${balance.tokens.length > 1 ? "s" : ""}`}
              </p>
            )}
          </>
        )}

        {/* Address */}
        <div className={`mt-4 flex items-center gap-2 p-2.5 rounded-xl ${isDark ? "bg-black/30" : "bg-gray-100"}`}>
          <code className={`flex-1 text-sm font-mono truncate ${isDark ? "text-white/60" : "text-black/60"}`}>
            {shortenAddress(wallet.publicKey, 8)}
          </code>
          <button onClick={copyAddress} className="p-1">
            {copied ? <Check className="h-4 w-4 text-up" /> : <Copy className={`h-4 w-4 ${isDark ? "text-white/40" : "text-black/40"}`} />}
          </button>
          <a href={`https://solscan.io/account/${wallet.publicKey}`} target="_blank" rel="noopener noreferrer" className="p-1">
            <ExternalLink className={`h-4 w-4 ${isDark ? "text-white/40" : "text-black/40"}`} />
          </a>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-2">
        {ACTIONS.map(({ id, label, icon: Icon }) => {
          const active = id === "buy" ? buyOpen : panel === id && !buyOpen;
          return (
            <button
              key={id}
              onClick={() => (id === "buy" ? setBuyOpen(true) : setPanel(id))}
              className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl border transition-colors ${
                active
                  ? "border-[#FF6B4A] bg-[#FF6B4A]/10"
                  : isDark
                  ? "border-white/10 bg-white/5 hover:bg-white/10"
                  : "border-black/10 bg-white hover:bg-black/5"
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? "text-[#FF6B4A]" : isDark ? "text-white/70" : "text-black/70"}`} />
              <span className={`text-xs font-medium ${active ? "text-[#FF6B4A]" : isDark ? "text-white/60" : "text-black/60"}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Swap panel — SOL ⇄ USDC on Jupiter, signed on-device */}
      {panel === "swap" && (
        <SwapWidget
          defaultOutputMint={USDC_MINT}
          outputSymbol="USDC"
          outputDecimals={6}
          isGraduated
          compactMobile
        />
      )}

      {/* Deposit panel */}
      {panel === "deposit" && (
        <div className={`${card} p-6`}>
          <div className="text-center space-y-4">
            <div>
              <p className={`text-sm mb-2 ${isDark ? "text-white/50" : "text-black/50"}`}>
                Send SOL or SPL tokens to this address
              </p>
              <div className={`p-4 rounded-xl ${isDark ? "bg-black/30" : "bg-gray-100"}`}>
                <code className="text-sm font-mono break-all text-[#FF6B4A]">{wallet.publicKey}</code>
              </div>
            </div>
            <button
              onClick={copyAddress}
              className={`w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors ${
                copied ? "bg-up/15 text-up" : "bg-[#FF6B4A] text-white hover:bg-[#FF8F6B]"
              }`}
            >
              {copied ? (<><Check className="h-5 w-5" />Copied!</>) : (<><Copy className="h-5 w-5" />Copy Address</>)}
            </button>
            <p className={`text-xs ${isDark ? "text-white/30" : "text-black/30"}`}>
              Only send Solana (SOL) or SPL tokens to this address. Sending other assets may result in permanent loss.
            </p>
          </div>
        </div>
      )}

      {/* Withdraw panel */}
      {panel === "withdraw" && (
        <div className={`${card} p-6 space-y-4`}>
          <div>
            <label className={`text-sm mb-2 block ${isDark ? "text-white/50" : "text-black/50"}`}>Token</label>
            <select value={selectedToken} onChange={(e) => setSelectedToken(e.target.value)} className={input}>
              <option value={SOL_MINT}>SOL ({balance?.sol.uiBalance.toFixed(4) || 0})</option>
              {balance?.tokens.map((token) => (
                <option key={token.mint} value={token.mint}>
                  {token.symbol || token.mint.slice(0, 8)}... ({token.uiBalance.toFixed(4)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className={`flex justify-between text-sm mb-2 ${isDark ? "text-white/50" : "text-black/50"}`}>
              <label>Amount</label>
              <span>Balance: {getSelectedBalance().toFixed(4)}</span>
            </div>
            <div className="flex gap-2">
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" className={input} />
              <button
                onClick={() => {
                  const bal = getSelectedBalance();
                  // Leave ~0.00001 SOL so the transfer can pay its own network fee.
                  const max = selectedToken === SOL_MINT ? Math.max(0, bal - 0.00001) : bal;
                  setAmount(max.toString());
                }}
                className={`px-4 py-3 rounded-xl font-medium ${
                  isDark ? "bg-white/10 text-white/60 hover:bg-white/15" : "bg-black/10 text-black/60 hover:bg-black/15"
                }`}
              >
                MAX
              </button>
            </div>
          </div>

          <div>
            <label className={`text-sm mb-2 block ${isDark ? "text-white/50" : "text-black/50"}`}>Destination Address</label>
            <input
              type="text"
              value={destinationAddress}
              onChange={(e) => setDestinationAddress(e.target.value)}
              placeholder="Solana wallet address..."
              className={`${input} font-mono text-sm`}
            />
          </div>

          {error && <div className="p-3 bg-down/10 border border-down/20 rounded-xl text-down text-sm">{error}</div>}
          {success && <div className="p-3 bg-up/10 border border-up/20 rounded-xl text-up text-sm">{success}</div>}

          <button
            onClick={handleWithdraw}
            disabled={!destinationAddress || !amount || withdrawing}
            className={`w-full py-3 rounded-xl font-medium transition-colors ${
              !destinationAddress || !amount || withdrawing
                ? isDark ? "bg-white/10 text-white/40 cursor-not-allowed" : "bg-black/10 text-black/40 cursor-not-allowed"
                : "bg-[#FF6B4A] text-white hover:bg-[#FF8F6B]"
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

      {/* ---------------- Account ---------------- */}
      <div className={`${card} p-4 space-y-3`}>
        <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${isDark ? "text-white/50" : "text-black/50"}`}>
          Account
        </p>

        {/* Switch between wallets on this device */}
        {accounts.length > 1 && (
          <div className="space-y-1">
            {accounts.map((a) => (
              <button
                key={a.publicKey}
                onClick={() => { if (a.publicKey !== wallet.publicKey) { switchAccount(a.publicKey); setBalance(null); setLoading(true); } }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                  a.publicKey === wallet.publicKey
                    ? "border-[#FF6B4A]/40 bg-[#FF6B4A]/5"
                    : isDark ? "border-white/10 hover:bg-white/5" : "border-black/10 hover:bg-black/5"
                }`}
              >
                <Users className={`h-4 w-4 ${a.publicKey === wallet.publicKey ? "text-[#FF6B4A]" : isDark ? "text-white/40" : "text-black/40"}`} />
                <span className={`flex-1 text-sm font-mono truncate ${isDark ? "text-white/70" : "text-black/70"}`}>
                  {shortenAddress(a.publicKey, 6)}
                </span>
                {a.publicKey === wallet.publicKey && (
                  <span className="text-[10px] font-semibold uppercase text-[#FF6B4A]">active</span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => { setExportOpen(true); setRevealed(false); setPhrase(null); }}
            className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-colors ${
              isDark ? "border-white/10 text-white/70 hover:bg-white/5" : "border-black/10 text-black/70 hover:bg-black/5"
            }`}
          >
            <KeyRound className="h-4 w-4" /> Export phrase
          </button>
          <button
            onClick={() => setOnboardOpen(true)}
            className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-colors ${
              isDark ? "border-white/10 text-white/70 hover:bg-white/5" : "border-black/10 text-black/70 hover:bg-black/5"
            }`}
          >
            <Plus className="h-4 w-4" /> Add wallet
          </button>
        </div>
      </div>

      {/* Export recovery phrase — stays on this device, revealed only on tap */}
      {exportOpen && (
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center sm:p-4">
          <div className={`absolute inset-0 backdrop-blur-sm ${isDark ? "bg-black/60" : "bg-black/40"}`} onClick={() => setExportOpen(false)} />
          <div className={`relative w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border shadow-2xl p-5 space-y-4 ${isDark ? "bg-[#111] border-white/10" : "bg-white border-gray-200"}`}>
            <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Recovery phrase</h2>
            <p className={`text-xs ${isDark ? "text-white/40" : "text-gray-500"}`}>
              Anyone with these words controls this wallet. Never share them, never type them into another site.
            </p>
            <button
              onClick={async () => {
                if (!revealed) {
                  const m = await useMobileWalletStore.getState().getMnemonic();
                  setPhrase(m);
                  setRevealed(true);
                } else setRevealed(false);
              }}
              className={`w-full rounded-xl border p-4 text-left ${isDark ? "border-white/10 bg-black/30" : "border-gray-200 bg-gray-50"}`}
            >
              {revealed && phrase ? (
                <div className="grid grid-cols-3 gap-1.5">
                  {phrase.split(" ").map((w, i) => (
                    <span key={i} className={`text-xs font-mono ${isDark ? "text-white/80" : "text-gray-800"}`}>
                      <span className={isDark ? "text-white/30" : "text-gray-400"}>{i + 1}.</span> {w}
                    </span>
                  ))}
                </div>
              ) : revealed && !phrase ? (
                <span className="text-sm text-down">Wallet locked — re-import your phrase to export it.</span>
              ) : (
                <span className={`flex items-center justify-center gap-2 text-sm ${isDark ? "text-white/50" : "text-gray-500"}`}>
                  <Eye className="h-4 w-4" /> Tap to reveal
                </span>
              )}
            </button>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const m = phrase ?? (await useMobileWalletStore.getState().getMnemonic());
                  if (m) {
                    await navigator.clipboard.writeText(m);
                    setPhraseCopied(true);
                    setTimeout(() => setPhraseCopied(false), 2000);
                  }
                }}
                className="flex-1 py-3 rounded-xl text-sm font-semibold bg-[#FF6B4A] text-white hover:bg-[#FF8F6B] transition-colors"
              >
                {phraseCopied ? "Copied!" : "Copy phrase"}
              </button>
              <button
                onClick={() => setExportOpen(false)}
                className={`px-5 rounded-xl border text-sm ${isDark ? "border-white/10 text-white/60" : "border-gray-200 text-gray-600"}`}
              >
                {revealed ? <EyeOff className="h-4 w-4" /> : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / import another wallet (reuses onboarding) */}
      <WalletOnboarding isOpen={onboardOpen} onClose={() => { setOnboardOpen(false); fetchBalance(); }} />

      {/* Token holdings intentionally live in the Portfolio (Positions), not here. */}

      <OnrampModal
        isOpen={buyOpen}
        onClose={() => {
          setBuyOpen(false);
          fetchBalance();
        }}
      />
    </div>
  );
}
