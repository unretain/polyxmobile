"use client";

import { useEffect } from "react";
import { useDemoStore, DemoPosition } from "@/stores/demoStore";

/**
 * Apple App Review demo mode ONLY. While `isDemo` is true, this transparently
 * intercepts the server trading endpoints (balance / pnl / holdings / withdraw)
 * and answers them from the in-memory paper-trading store PLUS a synthetic but
 * realistic trading history — so the token-page HOLDING, the /wallet balance,
 * and the /portfolio (PnL, volume, win rate, streaks, daily chart, positions)
 * are all fully populated and consistent, with zero changes to those pages.
 *
 * Not active for real users: no-ops unless demo mode is on, restores the
 * original fetch on cleanup, and only touches /api/trading/*.
 */
const SOL_MINT = "So11111111111111111111111111111111111111112";

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// Positions carry a pretend +25% unrealized gain so the Positions tab looks alive.
function toFullPosition(p: DemoPosition) {
  const unrealizedPnl = Number((p.costSol * 0.25).toFixed(4));
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
    currentValue: Number((p.costSol * 1.25).toFixed(4)),
    realizedPnl: 0,
    unrealizedPnl,
    pnlPercent: 25,
    trades: 1,
    lastTradeAt: new Date().toISOString(),
    isOpen: p.uiAmount > 0.000001,
  };
}

// Deterministic, realistic daily P&L history so the portfolio isn't empty.
function demoPortfolio(period: string) {
  const days = period === "1d" ? 1 : period === "7d" ? 7 : 30;
  let s = 1337; // fixed seed -> stable across reloads
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const today = new Date();
  const dailyPnL: Array<{ date: string; pnl: number; trades: number; volume: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const trades = 1 + Math.floor(rnd() * 4); // 1–4 trades/day
    const win = rnd() < 0.65; // ~65% win days
    const mag = 0.005 + rnd() * 0.05;
    const pnl = Number((win ? mag : -mag * 0.7).toFixed(4));
    const volume = Number((trades * (0.02 + rnd() * 0.06)).toFixed(4));
    dailyPnL.push({ date: d.toISOString().slice(0, 10), pnl, trades, volume });
  }
  const totalRealizedPnl = Number(dailyPnL.reduce((a, x) => a + x.pnl, 0).toFixed(4));
  const totalVolume = Number(dailyPnL.reduce((a, x) => a + x.volume, 0).toFixed(4));
  const totalTrades = dailyPnL.reduce((a, x) => a + x.trades, 0);
  const winRate = dailyPnL.filter((x) => x.pnl > 0).length / Math.max(dailyPnL.length, 1);
  let currentStreak = 0;
  for (let i = dailyPnL.length - 1; i >= 0; i--) {
    if (dailyPnL[i].pnl > 0) currentStreak++;
    else break;
  }
  let bestStreak = 0, run = 0;
  for (const x of dailyPnL) {
    if (x.pnl > 0) { run++; bestStreak = Math.max(bestStreak, run); }
    else run = 0;
  }
  const calendarData: Record<string, { date: string; pnl: number; trades: number; volume: number }> = {};
  for (const x of dailyPnL) calendarData[x.date] = x;
  return { dailyPnL, calendarData, summary: { totalRealizedPnl, totalVolume, totalTrades, currentStreak, bestStreak, winRate } };
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
        let period = "30d";
        try {
          const params = new URL(url, "http://x").searchParams;
          tokenMint = params.get("tokenMint");
          period = params.get("period") || "30d";
        } catch { /* ignore */ }

        if (tokenMint) {
          const p = demo.positions[tokenMint];
          return json({ bought: p?.uiAmount || 0, sold: 0, holding: p?.uiAmount || 0, pnlPercent: p ? 25 : 0 });
        }

        const { dailyPnL, calendarData, summary } = demoPortfolio(period);
        const positions = Object.values(demo.positions).map(toFullPosition);
        const posVolume = positions.reduce((a, p) => a + p.totalBuyCost, 0);
        const now = new Date();
        const start = new Date(now);
        start.setDate(start.getDate() - (period === "1d" ? 1 : period === "7d" ? 7 : 30));
        return json({
          period,
          startDate: start.toISOString(),
          endDate: now.toISOString(),
          cumulativePnLBaseline: 0,
          summary: {
            ...summary,
            totalVolume: Number((summary.totalVolume + posVolume).toFixed(4)),
          },
          dailyPnL,
          calendarData: period === "calendar" ? calendarData : undefined,
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
