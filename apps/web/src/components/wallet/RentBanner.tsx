"use client";

import { useCallback, useEffect, useState } from "react";
import { Coins, Loader2 } from "lucide-react";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { useThemeStore } from "@/stores/themeStore";
import { useToast } from "@/components/ui/Toast";
import { getReclaimableRent, claimRent } from "@/lib/rent";

/**
 * "X SOL rent to recover" banner. Every emptied token account still holds
 * ~0.002 SOL of rent; this finds them and closes them all in one tap.
 * Renders nothing when there's nothing to claim.
 */
export function RentBanner() {
  const { wallet } = useMobileWalletStore();
  const { isDark } = useThemeStore();
  const { showToast } = useToast();
  const [sol, setSol] = useState(0);
  const [count, setCount] = useState(0);
  const [claiming, setClaiming] = useState(false);

  const refresh = useCallback(async () => {
    if (!wallet?.publicKey) return;
    try {
      const r = await getReclaimableRent(wallet.publicKey);
      setSol(r.sol);
      setCount(r.accounts.length);
    } catch { /* RPC hiccup, banner just stays hidden */ }
  }, [wallet?.publicKey]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!wallet || count === 0) return null;

  const claim = async () => {
    setClaiming(true);
    try {
      const mnemonic = await useMobileWalletStore.getState().getMnemonic();
      if (!mnemonic) throw new Error("Wallet locked, re-import your phrase to claim.");
      const r = await claimRent(mnemonic);
      showToast(`Recovered ${r.sol.toFixed(4)} SOL from ${r.closed} empty accounts`, "success");
      setSol(0);
      setCount(0);
      setTimeout(refresh, 4000);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Claim failed", "error");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 ${
      isDark ? "border-[#FF6B4A]/25 bg-[#FF6B4A]/5" : "border-[#FF6B4A]/30 bg-[#FF6B4A]/5"
    }`}>
      <Coins className="h-4 w-4 shrink-0 text-[#FF6B4A]" />
      <p className={`flex-1 text-sm ${isDark ? "text-white/70" : "text-gray-700"}`}>
        <span className="font-mono font-semibold">{sol.toFixed(4)} SOL</span> rent to recover
        <span className={isDark ? "text-white/40" : "text-gray-400"}> · {count} empty token account{count > 1 ? "s" : ""}</span>
      </p>
      <button
        onClick={claim}
        disabled={claiming}
        className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-[#FF6B4A] text-white hover:bg-[#FF8F6B] transition-colors disabled:opacity-50 flex items-center gap-1.5"
      >
        {claiming ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        Claim
      </button>
    </div>
  );
}
