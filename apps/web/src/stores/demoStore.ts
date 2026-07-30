import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Demo / paper-trading mode — ONLY for Apple App Review (username "apple" /
 * password "apple123"). Real users never touch this. Everything below is real
 * paper accounting: a trade log drives balance, positions, and realized PnL, so
 * the portfolio reflects what was actually traded — no fabricated numbers.
 */
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
}

interface DemoState {
  isDemo: boolean;
  solBalance: number;
  positions: Record<string, DemoPosition>;
  trades: DemoTrade[];
  enterDemo: () => void;
  exitDemo: () => void;
  paperBuy: (mint: string, symbol: string, solSpent: number, tokensReceived: number) => void;
  paperSell: (mint: string, solReceived: number, tokensSold: number) => void;
}

const SEED_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"; // BONK

export const useDemoStore = create<DemoState>()(
  persist(
    (set) => ({
      isDemo: false,
      solBalance: 0,
      positions: {},
      trades: [],

      // Funded with 5 SOL plus one pre-existing BONK buy so the wallet/portfolio
      // aren't empty. Fully consistent: total deposited 5.15 SOL, 0.15 spent on BONK.
      enterDemo: () => {
        const now = Date.now();
        set({
          isDemo: true,
          solBalance: 5,
          positions: {
            [SEED_MINT]: { mint: SEED_MINT, symbol: "BONK", uiAmount: 1_250_000, costSol: 0.15 },
          },
          trades: [
            { mint: SEED_MINT, symbol: "BONK", side: "buy", solAmount: 0.15, tokenAmount: 1_250_000, ts: now - 2 * 86_400_000 },
          ],
        });
      },

      exitDemo: () => set({ isDemo: false, solBalance: 0, positions: {}, trades: [] }),

      paperBuy: (mint, symbol, solSpent, tokensReceived) =>
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
              { mint, symbol, side: "buy", solAmount: solSpent, tokenAmount: tokensReceived, ts: Date.now() },
            ],
          };
        }),

      paperSell: (mint, solReceived, tokensSold) =>
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
              { mint, symbol: prev.symbol, side: "sell", solAmount: solReceived, tokenAmount: tokensSold, realized, ts: Date.now() },
            ],
          };
        }),
    }),
    { name: "polyx-demo" }
  )
);
