"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  X,
  CreditCard,
  DollarSign,
  Loader2,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { useThemeStore } from "@/stores/themeStore";
import {
  createOnrampOrder,
  getOnrampOrderStatus,
  type OnrampQuote,
} from "@/app/actions/createOnrampOrder";
import { shortenAddress } from "@/lib/wallet";
import { cn } from "@/lib/utils";

const CLIENT_API_KEY = process.env.NEXT_PUBLIC_CROSSMINT_CLIENT_API_KEY || "";

// Crossmint components touch browser APIs, client-side only.
const CrossmintCheckout = dynamic(() => import("./CrossmintCheckoutWrapper"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[360px]">
      <Loader2 className="h-8 w-8 animate-spin text-[#FF6B4A]" />
    </div>
  ),
});

const PRESETS = ["10", "25", "50", "100"];

type Step = "form" | "checkout" | "success";

interface OnrampModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function OnrampModal({ isOpen, onClose }: OnrampModalProps) {
  const { isDark } = useThemeStore();
  const { wallet } = useMobileWalletStore();

  const [step, setStep] = useState<Step>("form");
  // Receipt email pre-fills from the verified sign-up email (editable).
  const [email, setEmail] = useState("");
  useEffect(() => {
    if (!isOpen || email) return;
    try {
      const saved = localStorage.getItem("polyx-email");
      if (saved) setEmail(saved);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  const [amount, setAmount] = useState("25");
  const [customAmount, setCustomAmount] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<{ orderId: string; clientSecret: string; quote: OnrampQuote } | null>(null);
  const [phase, setPhase] = useState<string>("payment");
  const [txId, setTxId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const effectiveAmount = customAmount || amount;

  // Once the payment is in (delivery phase), confirm delivery server-side so the
  // success screen can link the actual Solana transaction.
  useEffect(() => {
    if (!order || (phase !== "delivery" && phase !== "completed")) return;
    if (phase === "completed") setStep("success");
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const s = await getOnrampOrderStatus(order.orderId);
      if (s.txId) setTxId(s.txId);
      if (s.phase === "completed") {
        setStep("success");
        if (s.txId || phase === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [order, phase]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!wallet?.publicKey) {
      setError("No wallet found. Create a wallet first.");
      return;
    }
    if (!accepted) {
      setError("Please accept the Crossmint Terms of Service to continue.");
      return;
    }
    setIsCreating(true);
    setError("");
    try {
      const result = await createOnrampOrder({
        walletAddress: wallet.publicKey,
        receiptEmail: email,
        amount: effectiveAmount,
        acceptedTerms: accepted,
      });
      if (!result.ok) {
        setError(result.error);
      } else {
        setOrder(result);
        setStep("checkout");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create order");
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setStep("form");
    setOrder(null);
    setEmail("");
    setAmount("25");
    setCustomAmount("");
    setAccepted(false);
    setError("");
    setPhase("payment");
    setTxId(null);
    onClose();
  };

  const label = `text-xs uppercase tracking-wide ${isDark ? "text-white/40" : "text-gray-500"}`;
  const inputCls = cn(
    "mt-1 w-full px-3 py-2.5 text-sm rounded-xl border outline-none transition-colors focus:border-[#FF6B4A]/60",
    isDark
      ? "bg-white/5 border-white/10 text-white placeholder-white/30"
      : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"
  );

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center sm:p-4">
      <div
        className={`absolute inset-0 backdrop-blur-sm ${isDark ? "bg-black/60" : "bg-black/40"}`}
        onClick={handleClose}
      />

      <div
        className={cn(
          "relative w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border shadow-2xl",
          isDark ? "bg-[#111] border-white/10" : "bg-white border-gray-200"
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "sticky top-0 z-10 flex items-center justify-between p-4 border-b backdrop-blur-xl",
            isDark ? "border-white/10 bg-[#111]/90" : "border-gray-200 bg-white/90"
          )}
        >
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-[#FF6B4A]" />
            <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
              Buy USDC
            </h2>
          </div>
          <button
            onClick={handleClose}
            className={`p-1.5 rounded-full transition-colors ${
              isDark ? "hover:bg-white/10 text-white/60" : "hover:bg-black/10 text-gray-500"
            }`}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          {step === "success" && order ? (
            /* ---------------- Confirmation ---------------- */
            <div className="py-8 text-center space-y-4">
              <CheckCircle2 className="h-14 w-14 mx-auto text-up" />
              <div>
                <p className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Purchase complete
                </p>
                <p className={`mt-1 text-sm ${isDark ? "text-white/50" : "text-gray-500"}`}>
                  ${order.quote.totalUsd} {order.quote.currency} paid,{" "}
                  {order.quote.receiveAmount ? `${order.quote.receiveAmount} ` : ""}USDC sent to{" "}
                  <span className="font-mono">{shortenAddress(wallet?.publicKey || "", 4)}</span>
                </p>
                <p className={`mt-2 text-xs ${isDark ? "text-white/30" : "text-gray-400"}`}>
                  Order {order.orderId.slice(0, 18)}… · receipt sent to {email}
                </p>
              </div>
              {txId && (
                <a
                  href={`https://solscan.io/tx/${txId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-[#FF6B4A] hover:underline"
                >
                  View transaction <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <button
                onClick={handleClose}
                className="w-full py-3 rounded-xl text-sm font-semibold bg-[#FF6B4A] text-white hover:bg-[#FF8F6B] transition-colors"
              >
                Done
              </button>
            </div>
          ) : step === "checkout" && order ? (
            /* ---------------- Pay (fees shown before paying) ---------------- */
            <div className="space-y-3">
              <div
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-sm space-y-1",
                  isDark ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50"
                )}
              >
                <div className="flex justify-between">
                  <span className={isDark ? "text-white/50" : "text-gray-500"}>You buy</span>
                  <span className={isDark ? "text-white" : "text-gray-900"}>
                    {order.quote.receiveAmount ? `~${order.quote.receiveAmount} ` : ""}USDC (${effectiveAmount})
                  </span>
                </div>
                {order.quote.fees.map((f) => (
                  <div key={f.label} className="flex justify-between">
                    <span className={isDark ? "text-white/50" : "text-gray-500"}>{f.label}</span>
                    <span className={isDark ? "text-white/80" : "text-gray-700"}>
                      ${f.amount} {f.currency !== "USD" ? f.currency : ""}
                    </span>
                  </div>
                ))}
                <div className={`flex justify-between pt-1 border-t font-semibold ${isDark ? "border-white/10 text-white" : "border-gray-200 text-gray-900"}`}>
                  <span>Total charged</span>
                  <span>
                    ${order.quote.totalUsd}
                    {order.quote.fees.length === 0 && " + card fees shown below"}
                  </span>
                </div>
              </div>

              {/* Live order status */}
              <div className={`flex items-center gap-2 text-xs ${isDark ? "text-white/40" : "text-gray-500"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${phase === "delivery" ? "bg-[#FF6B4A] animate-pulse" : "bg-up"}`} />
                {phase === "delivery"
                  ? "Payment received, delivering USDC to your wallet…"
                  : "Awaiting payment, complete the form below"}
              </div>

              {error && (
                <div className="text-sm text-down bg-down/10 border border-down/20 rounded-xl px-3 py-2">
                  {error}
                </div>
              )}

              <div className="min-h-[360px]">
                <CrossmintCheckout
                  apiKey={CLIENT_API_KEY}
                  orderId={order.orderId}
                  clientSecret={order.clientSecret}
                  receiptEmail={email}
                  isDark={isDark}
                  onPhase={(p) => {
                    setPhase(p);
                    if (p === "completed") setStep("success");
                    if (p === "delivery" || p === "completed") setError("");
                  }}
                  onPaymentError={(msg) => setError(msg)}
                />
              </div>
            </div>
          ) : (
            /* ---------------- Order form ---------------- */
            <div className="space-y-4">
              <div>
                <label className={label}>Receiving Wallet</label>
                <div
                  className={cn(
                    "mt-1 px-3 py-2.5 text-sm font-mono truncate rounded-xl border",
                    isDark ? "bg-white/5 border-white/10 text-white/60" : "bg-gray-50 border-gray-200 text-gray-600"
                  )}
                >
                  {wallet?.publicKey || "No wallet"}
                </div>
              </div>

              <div>
                <label className={label}>Receipt Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className={inputCls}
                />
              </div>

              <div>
                <label className={label}>Amount (USD)</label>
                <div className="mt-1 grid grid-cols-4 gap-2">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => {
                        setAmount(preset);
                        setCustomAmount("");
                      }}
                      className={cn(
                        "py-2 text-sm font-medium rounded-xl border transition-colors",
                        amount === preset && !customAmount
                          ? "border-[#FF6B4A] bg-[#FF6B4A]/15 text-[#FF6B4A]"
                          : isDark
                          ? "border-white/10 text-white/60 hover:border-white/20"
                          : "border-gray-200 text-gray-600 hover:border-gray-300"
                      )}
                    >
                      ${preset}
                    </button>
                  ))}
                </div>
                <div className="mt-2 relative">
                  <DollarSign className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${isDark ? "text-white/30" : "text-gray-400"}`} />
                  <input
                    type="number"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder="Custom amount"
                    min="1"
                    max="5000"
                    className={cn(inputCls, "pl-8 mt-0")}
                  />
                </div>
              </div>

              {/* Crossmint ToS consent, required before any order is created */}
              <label
                className={cn(
                  "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer select-none",
                  accepted
                    ? "border-[#FF6B4A]/50 bg-[#FF6B4A]/5"
                    : isDark
                    ? "border-white/10 bg-white/5"
                    : "border-gray-200 bg-gray-50"
                )}
              >
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#FF6B4A]"
                />
                <span className={`text-xs leading-relaxed ${isDark ? "text-white/60" : "text-gray-600"}`}>
                  I agree to Crossmint&apos;s{" "}
                  <a href="https://www.crossmint.com/legal/terms-of-service" target="_blank" rel="noopener noreferrer" className="text-[#FF6B4A] underline" onClick={(e) => e.stopPropagation()}>
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="https://www.crossmint.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-[#FF6B4A] underline" onClick={(e) => e.stopPropagation()}>
                    Privacy Policy
                  </a>
                  . Crossmint is the regulated payment provider; order emails come from Crossmint.
                </span>
              </label>

              <div className={cn("flex items-start gap-2 text-xs px-3 py-2 rounded-xl border", isDark ? "border-white/10 text-white/40 bg-white/5" : "border-gray-200 text-gray-500 bg-gray-50")}>
                <ShieldCheck className="h-4 w-4 shrink-0 text-[#FF6B4A]" />
                <span>
                  USDC is delivered straight to your Polyx wallet. Card, Apple Pay &amp; Google Pay.
                  The exact total with fees is shown before you pay.
                </span>
              </div>

              {error && (
                <div className="text-sm text-down bg-down/10 border border-down/20 rounded-xl px-3 py-2">
                  {error}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={isCreating || !wallet?.publicKey || !accepted || !email}
                className={cn(
                  "w-full py-3 text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2",
                  "bg-[#FF6B4A] text-white hover:bg-[#FF8F6B]",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating order…
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" />
                    Continue ${effectiveAmount || "0"}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
