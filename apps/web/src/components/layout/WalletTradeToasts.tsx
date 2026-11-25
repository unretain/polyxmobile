"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { getTrackedWallets } from "@/stores/pulseStore";
import { shortenAddress } from "@/lib/wallet";

/**
 * App-wide listener for tracked-wallet trades (pushed over the pulse socket,
 * re-dispatched as a window event by pulseStore). Shows a toast and, when the
 * browser allows it, a system notification. Mounted once in AppShell.
 */
export function WalletTradeToasts() {
  const { showToast } = useToast();
  const router = useRouter();

  useEffect(() => {
    const onTrade = (e: Event) => {
      const t = (e as CustomEvent).detail;
      if (!t?.trader) return;
      const tracked = getTrackedWallets().find((w) => w.address === t.trader);
      const who = tracked?.label || shortenAddress(t.trader, 4);
      const verb = t.type === "buy" ? "bought" : "sold";
      const msg = `${who} ${verb} ${Number(t.solAmount).toFixed(2)} SOL of ${t.symbol}`;
      showToast(msg, t.type === "buy" ? "success" : "error");
      try {
        if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
          const n = new Notification("Polyx — wallet activity", { body: msg });
          n.onclick = () => { window.focus(); router.push(`/token/${t.mint}?source=pulse`); };
        }
      } catch {}
    };
    window.addEventListener("polyx:wallet-trade", onTrade);
    return () => window.removeEventListener("polyx:wallet-trade", onTrade);
  }, [showToast, router]);

  return null;
}
