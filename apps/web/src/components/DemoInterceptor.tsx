"use client";

import { useEffect } from "react";
import { useDemoStore, DemoPosition, DemoTrade } from "@/stores/demoStore";

/**
 * Apple App Review demo mode ONLY. While `isDemo` is true, this intercepts the
 * server trading endpoints and answers them from the paper-trading store — real
 * accounting driven by the actual trade log, so token HOLDING, /wallet balance,
 * and /portfolio (PnL, volume, win rate, streaks, daily chart, positions) all
 * reflect what was actually traded. No fabricated numbers.
 *
 * No-ops unless demo mode is on; restores fetch on cleanup; only /api/trading/*.
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
    currentValue: p.costSol, // valued at cost (no live price in paper mode)
    realizedPnl: 0,
    unrealizedPnl: 0,
    pnlPercent: 0,
    trades: 1,
    lastTradeAt: new Date().toISOString(),
    isOpen: p.uiAmount > 0.000001,
  };
}

// Everything below is computed from the REAL trade log — nothing invented.
function computePortfolio(trades: DemoTrade[], positions: Record<string, DemoPosition>, period: string) {
  const now = Date.now();
  const days = period === "1d" ? 1 : period === "7d" ? 7 : period === "all" ? 3650 : 30;
  const cutoff = now - days * 86_400_000;
  const inPeriod = trades.filter((t) => t.ts >= cutoff);

  const volume = inPeriod.reduce((a, t) => a + t.solAmount, 0);
  const sells = inPeriod.filter((t) => t.side === "sell");
  const totalRealizedPnl = sells.reduce((a, t) => a + (t.realized || 0), 0);
  const totalTrades = inPeriod.length;
  const winRate = sells.length ? sells.filter((t) => (t.realized || 0) > 0).length / sells.length : 0;

  const dayMap = new Map<string, { date: string; pnl: number; trades: number; volume: number }>();
  for (const t of inPeriod) {
    const date = new Date(t.ts).toISOString().slice(0, 10);
    const d = dayMap.get(date) || { date, pnl: 0, trades: 0, volume: 0 };
    d.pnl += t.side === "sell" ? t.realized || 0 : 0;
    d.trades += 1;
    d.volume += t.solAmount;
    dayMap.set(date, d);
  }
  const dailyPnL = Array.from(dayMap.values())
    .map((d) => ({ ...d, pnl: Number(d.pnl.toFixed(4)), volume: Number(d.volume.toFixed(4)) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  let currentStreak = 0;
  for (let i = dailyPnL.length - 1; i >= 0; i--) {
    if (dailyPnL[i].pnl > 0) currentStreak++;
    else if (dailyPnL[i].pnl < 0) break;
  }
  let bestStreak = 0, run = 0;
  for (const d of dailyPnL) {
    if (d.pnl > 0) { run++; bestStreak = Math.max(bestStreak, run); }
    else if (d.pnl < 0) run = 0;
  }

  const posArr = Object.values(positions).map(toFullPosition);
  return {
    dailyPnL,
    positions: posArr,
    summary: {
      totalRealizedPnl: Number(totalRealizedPnl.toFixed(4)),
      totalVolume: Number(volume.toFixed(4)),
      totalTrades,
      currentStreak,
      bestStreak,
      winRate,
    },
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

      if (url.includes("/api/trading/pnl")) {
        let tokenMint: string | null = null;
        let period = "30d";
        try {
          const params = new URL(url, "http://x").searchParams;
          tokenMint = params.get("tokenMint");
          period = params.get("period") || "30d";
        } catch { /* ignore */ }

        if (tokenMint) {
          const p = demo.positions[tokenMint];
          return json({ bought: p?.uiAmount || 0, sold: 0, holding: p?.uiAmount || 0, pnlPercent: 0 });
        }

        const { dailyPnL, positions, summary } = computePortfolio(demo.trades, demo.positions, period);
        const now = new Date();
        const start = new Date(now);
        start.setDate(start.getDate() - (period === "1d" ? 1 : period === "7d" ? 7 : 30));
        return json({
          period,
          startDate: start.toISOString(),
          endDate: now.toISOString(),
          cumulativePnLBaseline: 0,
          summary,
          dailyPnL,
          positions,
          activePositions: positions,
          closedPositions: [],
        });
      }

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
