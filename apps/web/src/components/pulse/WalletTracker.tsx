"use client";

import { useState } from "react";
import { X, Bell, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortenAddress } from "@/lib/wallet";
import {
  getTrackedWallets,
  saveTrackedWallets,
  type TrackedWallet,
} from "@/stores/pulseStore";

const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Track wallets and get a toast whenever one of them buys or sells.
 * (Native iOS push needs the next app build — web toasts + browser
 * notifications work today.)
 */
export function WalletTracker({ isDark }: { isDark: boolean }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<TrackedWallet[]>([]);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

  const openModal = () => {
    setList(getTrackedWallets());
    setOpen(true);
    // Ask for browser-notification permission the first time the feature is used.
    try {
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    } catch {}
  };

  const add = () => {
    const addr = address.trim();
    if (!SOLANA_ADDR.test(addr)) {
      setError("That's not a valid Solana address.");
      return;
    }
    if (list.some((w) => w.address === addr)) {
      setError("Already tracking that wallet.");
      return;
    }
    const next = [{ address: addr, label: label.trim() || undefined }, ...list].slice(0, 25);
    setList(next);
    saveTrackedWallets(next);
    setAddress("");
    setLabel("");
    setError("");
  };

  const remove = (addr: string) => {
    const next = list.filter((w) => w.address !== addr);
    setList(next);
    saveTrackedWallets(next);
  };

  const input = cn(
    "w-full px-3 py-2 text-sm rounded-xl border outline-none transition-colors focus:border-[#FF6B4A]/50",
    isDark ? "bg-white/5 border-white/10 text-white placeholder-white/30" : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"
  );

  return (
    <>
      <button
        onClick={openModal}
        className={`relative flex items-center gap-2 rounded-xl border px-2 md:px-3 py-2 text-sm transition-colors ${
          isDark
            ? 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
            : 'bg-black/5 border-black/10 text-gray-500 hover:bg-black/10'
        }`}
        title="Track wallets"
      >
        <Bell className="h-4 w-4" />
        <span className="hidden md:inline">Track</span>
        {getTrackedWallets().length > 0 && (
          <span className="px-1.5 rounded-full text-[10px] font-mono bg-[#FF6B4A]/10 text-[#FF6B4A]">
            {getTrackedWallets().length}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center sm:p-4">
          <div className={`absolute inset-0 backdrop-blur-sm ${isDark ? "bg-black/60" : "bg-black/40"}`} onClick={() => setOpen(false)} />
          <div className={cn(
            "relative w-full sm:max-w-md max-h-[85dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border shadow-2xl p-4",
            isDark ? "bg-[#111] border-white/10" : "bg-white border-gray-200"
          )}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-[#FF6B4A]" />
                <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Track wallets</h2>
              </div>
              <button onClick={() => setOpen(false)} className={`p-1.5 rounded-full ${isDark ? "hover:bg-white/10 text-white/60" : "hover:bg-black/10 text-gray-500"}`}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className={`text-xs mb-3 ${isDark ? "text-white/40" : "text-gray-500"}`}>
              Get an in-app alert whenever a tracked wallet buys or sells on pump.fun.
            </p>

            <div className="flex gap-2 mb-2">
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Wallet address" className={cn(input, "flex-[2] font-mono")} />
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" maxLength={16} className={cn(input, "flex-1")} />
              <button onClick={add} className="px-3 rounded-xl bg-[#FF6B4A] text-white hover:bg-[#FF8F6B] transition-colors">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {error && <p className="text-xs text-down mb-2">{error}</p>}

            <div className="space-y-1">
              {list.length === 0 ? (
                <p className={`py-6 text-center text-sm ${isDark ? "text-white/30" : "text-gray-400"}`}>No wallets tracked yet</p>
              ) : (
                list.map((w) => (
                  <div key={w.address} className={`flex items-center gap-2 px-3 py-2 rounded-xl ${isDark ? "bg-white/5" : "bg-gray-50"}`}>
                    <div className="flex-1 min-w-0">
                      {w.label && <span className={`text-sm font-medium mr-2 ${isDark ? "text-white" : "text-gray-900"}`}>{w.label}</span>}
                      <span className={`text-xs font-mono ${isDark ? "text-white/40" : "text-gray-500"}`}>{shortenAddress(w.address, 6)}</span>
                    </div>
                    <button onClick={() => remove(w.address)} className={`p-1 rounded ${isDark ? "text-white/30 hover:text-down" : "text-gray-400 hover:text-down"}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
