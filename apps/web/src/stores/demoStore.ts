import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Demo / paper-trading mode — ONLY for Apple App Review (username "apple" /
 * password "apple123"). Real users never touch this. Everything below is real
 * paper accounting: a trade log drives balance, positions, and realized PnL, so
 * the portfolio reflects what was actually traded — no fabricated numbers.
 */
/** Paper balance a demo session starts with. */
export const DEMO_START_SOL = 1000;

export interface DemoPosition {
  mint: string;
  symbol: string;
  uiAmount: number; // tokens held
  costSol: number;  // remaining cost basis in SOL
}

export interface DemoTrade {
  mint: string;
  symbol: string;
  side: "buy" | "sell";
  solAmount: number;   // SOL spent (buy) or received (sell)
  tokenAmount: number;
  realized?: number;   // realized PnL in SOL (sells only)
  ts: number;
  // Market cap in USD at the fill, so the chart's average entry/exit lines can be
  // pinned exactly the way real trades are — otherwise a demo line is recovered from
  // the live candle and drifts until that candle closes.
  capUsd?: number;
}

interface DemoState {
  isDemo: boolean;
  solBalance: number;
  positions: Record<string, DemoPosition>;
  trades: DemoTrade[];
  enterDemo: () => void;
  exitDemo: () => void;
  paperBuy: (mint: string, symbol: string, solSpent: number, tokensReceived: number, capUsd?: number) => void;
  paperSell: (mint: string, solReceived: number, tokensSold: number, capUsd?: number) => void;
}

export const useDemoStore = create<DemoState>()(
  persist(
    (set) => ({
      isDemo: false,
      solBalance: 0,
      positions: {},
      trades: [],

      // Clean start: a funded 1000 SOL wallet, nothing else. Everything (positions,
      // volume, PnL, history) populates from the reviewer's own paper trades.
      enterDemo: () =>
        set({
          isDemo: true,
          solBalance: DEMO_START_SOL,
          positions: {},
          trades: [],
        }),

      exitDemo: () => set({ isDemo: false, solBalance: 0, positions: {}, trades: [] }),

      paperBuy: (mint, symbol, solSpent, tokensReceived, capUsd) =>
        set((s) => {
          const prev = s.positions[mint] || { mint, symbol, uiAmount: 0, costSol: 0 };
          return {
            solBalance: Math.max(0, s.solBalance - solSpent),
            positions: {
              ...s.positions,
              [mint]: {
                ...prev,
                symbol,
                uiAmount: prev.uiAmount + tokensReceived,
                costSol: prev.costSol + solSpent,
              },
            },
            trades: [
              ...s.trades,
              { mint, symbol, side: "buy", solAmount: solSpent, tokenAmount: tokensReceived, ts: Date.now(), capUsd },
            ],
          };
        }),

      paperSell: (mint, solReceived, tokensSold, capUsd) =>
        set((s) => {
          const prev = s.positions[mint];
          if (!prev || prev.uiAmount <= 0) return s;
          const sellFrac = Math.min(1, tokensSold / prev.uiAmount);
          const costOfSold = prev.costSol * sellFrac; // cost basis of the sold portion
          const realized = Number((solReceived - costOfSold).toFixed(6));
          const remaining = Math.max(0, prev.uiAmount - tokensSold);
          const positions = { ...s.positions };
          if (remaining <= 0.000001) delete positions[mint];
          else positions[mint] = { ...prev, uiAmount: remaining, costSol: prev.costSol - costOfSold };
          return {
            solBalance: s.solBalance + solReceived,
            positions,
            trades: [
              ...s.trades,
              { mint, symbol: prev.symbol, side: "sell", solAmount: solReceived, tokenAmount: tokensSold, realized, ts: Date.now(), capUsd },
            ],
          };
        }),
    }),
    {
      name: "polyx-demo",
      // Sessions created before the starting balance changed are persisted in
      // localStorage, so without this a demo already in progress would sit on the old
      // 5 SOL until it was exited and re-entered. Only an UNTRADED wallet is topped
      // up — once there are trades the balance is the result of them, and overwriting
      // it would contradict the position and PnL history it belongs to.
      version: 2,
      migrate: (persisted: any, from: number) => {
        if (from < 2 && persisted?.isDemo && !persisted?.trades?.length) {
          return { ...persisted, solBalance: DEMO_START_SOL };
        }
        return persisted;
      },
    }
  )
);
