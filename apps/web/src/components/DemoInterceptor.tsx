"use client";

import { useEffect } from "react";
import { useDemoStore, DemoPosition } from "@/stores/demoStore";

/**
 * Apple App Review demo mode ONLY. While `isDemo` is true, this transparently
 * intercepts the server trading endpoints (balance / pnl / holdings / withdraw)
 * and answers them from the in-memory paper-trading store — so the token-page
 * HOLDING, the /wallet balance, and the /portfolio positions all reflect the
 * simulated wallet consistently, with zero changes to those pages.
 *
 * Not active for real users: the effect no-ops unless demo mode is on, and it
 * restores the original fetch on cleanup. Only /api/trading/* is touched; every
 * other request (quotes, feed, etc.) passes straight through.
 */
const SOL_MINT = "So11111111111111111111111111111111111111112";

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function toFullPosition(p: DemoPosition) {
  return {
    mint: p.mint,
    symbol: p.symbol,
    totalBought: p.uiAmount,
    totalSold: 0,
    avgBuyPrice: p.uiAmount > 0 ? p.costSol / p.uiAmount : 0,
    avgSellPrice: 0,
    totalBuyCost: p.costSol,
    totalSellRevenue: 0,
    currentBalance: p.uiAmount,
    realizedPnl: 0,
    unrealizedPnl: 0,
    trades: 1,
    lastTradeAt: new Date().toISOString(),
    isOpen: p.uiAmount > 0.000001,
  };
}

export function DemoInterceptor() {
  const isDemo = useDemoStore((s) => s.isDemo);

  useEffect(() => {
    if (!isDemo || typeof window === "undefined") return;
    const original = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      const demo = useDemoStore.getState();

      // Wallet balance (used by /wallet, SwapWidget, header)
      if (url.includes("/api/trading/balance")) {
        return json({
          walletAddress: "",
          sol: {
            mint: SOL_MINT,
            balance: String(Math.round(demo.solBalance * 1e9)),
            uiBalance: demo.solBalance,
            decimals: 9,
          },
          tokens: Object.values(demo.positions).map((p) => ({
            mint: p.mint,
            symbol: p.symbol,
            balance: String(Math.round(p.uiAmount * 1e6)),
            uiBalance: p.uiAmount,
            decimals: 6,
          })),
        });
      }

      // PnL — token-specific (token page HOLDING/PNL) or portfolio-wide
      if (url.includes("/api/trading/pnl")) {
        let tokenMint: string | null = null;
        try {
          tokenMint = new URL(url, "http://x").searchParams.get("tokenMint");
        } catch { /* ignore */ }

        if (tokenMint) {
          const p = demo.positions[tokenMint];
          return json({ bought: p?.uiAmount || 0, sold: 0, holding: p?.uiAmount || 0, pnlPercent: 0 });
        }

        const positions = Object.values(demo.positions).map(toFullPosition);
        return json({
          period: "30d",
          cumulativePnLBaseline: 0,
          summary: {
            totalRealizedPnl: 0,
            totalVolume: positions.reduce((s, p) => s + p.totalBuyCost, 0),
            totalTrades: positions.length,
            currentStreak: 0,
            bestStreak: 0,
            winRate: 0,
          },
          dailyPnL: [],
          positions,
          activePositions: positions,
          closedPositions: [],
        });
      }

      // Withdraw / swap should never really run in demo (handled client-side),
      // but answer success defensively so nothing errors.
      if (url.includes("/api/trading/withdraw") || url.includes("/api/trading/swap") || url.includes("/api/trading/pump-swap")) {
        return json({ success: true, demo: true, txSignature: "DEMO" });
      }

      return original(input, init);
    };

    return () => {
      window.fetch = original;
    };
  }, [isDemo]);

  return null;
}
