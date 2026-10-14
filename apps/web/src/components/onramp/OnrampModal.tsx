"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { X, CreditCard, DollarSign, Loader2 } from "lucide-react";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { useThemeStore } from "@/stores/themeStore";
import { createOnrampOrder } from "@/app/actions/createOnrampOrder";
import { cn } from "@/lib/utils";

const CLIENT_API_KEY = process.env.NEXT_PUBLIC_CROSSMINT_CLIENT_API_KEY || "";

// Dynamically import Crossmint components — they depend on browser APIs
// and break SSR if imported at the top level.
const CrossmintCheckout = dynamic(
  () => import("./CrossmintCheckoutWrapper"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-[#FF6B4A]" />
      </div>
    ),
  }
);

// Preset amounts
const PRESETS = ["10", "25", "50", "100"];

interface OnrampModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function OnrampModal({ isOpen, onClose }: OnrampModalProps) {
  const { isDark } = useThemeStore();
  const { wallet } = useMobileWalletStore();

  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("25");
  const [customAmount, setCustomAmount] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<{ orderId: string; clientSecret: string } | null>(null);

  if (!isOpen) return null;

  const effectiveAmount = customAmount || amount;

  const handleSubmit = async () => {
    if (!wallet?.publicKey) {
      setError("No wallet found. Create a wallet first.");
      return;
    }
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email for your receipt.");
      return;
    }
    const numAmount = parseFloat(effectiveAmount);
    if (!numAmount || numAmount < 1) {
      setError("Minimum amount is $1.");
      return;
    }

    setIsCreating(true);
    setError("");

    try {
      const result = await createOnrampOrder({
        walletAddress: wallet.publicKey,
        receiptEmail: email,
        amount: effectiveAmount,
      });
      if (!result.ok) {
        setError(result.error);
      } else {
        setOrder({ orderId: result.orderId, clientSecret: result.clientSecret });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create order");
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setOrder(null);
    setEmail("");
    setAmount("25");
    setCustomAmount("");
    setError("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 backdrop-blur-sm ${isDark ? "bg-black/60" : "bg-black/40"}`}
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        className={cn(
          "relative w-full max-w-md border shadow-2xl overflow-hidden",
          isDark ? "bg-[#111] border-white/10" : "bg-white border-gray-200"
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex items-center justify-between p-4 border-b",
            isDark ? "border-white/10" : "border-gray-200"
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
            className={`p-1.5 transition-colors ${
              isDark ? "hover:bg-white/10 text-white/60" : "hover:bg-black/10 text-gray-500"
            }`}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {order ? (
            /* Crossmint Checkout — loaded client-side only */
            <div className="min-h-[400px]">
              <CrossmintCheckout
                apiKey={CLIENT_API_KEY}
                orderId={order.orderId}
                clientSecret={order.clientSecret}
                receiptEmail={email}
              />
            </div>
          ) : (
            /* Order Form */
            <div className="space-y-4">
              {/* Wallet display */}
              <div>
                <label className={`text-xs uppercase tracking-wide ${isDark ? "text-white/40" : "text-gray-500"}`}>
                  Receiving Wallet
                </label>
                <div
                  className={cn(
                    "mt-1 px-3 py-2.5 text-sm font-mono truncate border",
                    isDark ? "bg-white/5 border-white/10 text-white/60" : "bg-gray-50 border-gray-200 text-gray-600"
                  )}
                >
                  {wallet?.publicKey || "No wallet"}
                </div>
              </div>

              {/* Email */}
              <div>
                <label className={`text-xs uppercase tracking-wide ${isDark ? "text-white/40" : "text-gray-500"}`}>
                  Receipt Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className={cn(
                    "mt-1 w-full px-3 py-2.5 text-sm border outline-none transition-colors focus:border-[#FF6B4A]/50",
                    isDark
                      ? "bg-white/5 border-white/10 text-white placeholder-white/30"
                      : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"
                  )}
                />
              </div>

              {/* Amount */}
              <div>
                <label className={`text-xs uppercase tracking-wide ${isDark ? "text-white/40" : "text-gray-500"}`}>
                  Amount (USD)
                </label>

                {/* Preset buttons */}
                <div className="mt-1 grid grid-cols-4 gap-2">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => {
                        setAmount(preset);
                        setCustomAmount("");
                      }}
                      className={cn(
                        "py-2 text-sm font-medium border transition-colors",
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

                {/* Custom amount */}
                <div className="mt-2 relative">
                  <DollarSign
                    className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${
                      isDark ? "text-white/30" : "text-gray-400"
                    }`}
                  />
                  <input
                    type="number"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder="Custom amount"
                    min="1"
                    className={cn(
                      "w-full pl-8 pr-3 py-2.5 text-sm border outline-none transition-colors focus:border-[#FF6B4A]/50",
                      isDark
                        ? "bg-white/5 border-white/10 text-white placeholder-white/30"
                        : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"
                    )}
                  />
                </div>
              </div>

              {/* Info */}
              <div
                className={cn(
                  "text-xs px-3 py-2 border",
                  isDark ? "border-white/10 text-white/40 bg-white/5" : "border-gray-200 text-gray-500 bg-gray-50"
                )}
              >
                USDC will be sent directly to your Polyx wallet. Supports cards, Apple Pay & Google Pay.
                Light KYC up to $1,000.
              </div>

              {/* Error */}
              {error && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2">
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={isCreating || !wallet?.publicKey}
                className={cn(
                  "w-full py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-2",
                  "bg-[#FF6B4A] text-white hover:bg-[#FF6B4A]/90",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating order...
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" />
                    Buy ${effectiveAmount} USDC
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
