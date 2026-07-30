import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Demo / paper-trading mode — ONLY for the Apple App Review demo account
 * (unlocked with username "apple" / password "apple123"). Real users never
 * touch this: nothing here runs unless `isDemo` is true, which is only set by
 * the demo-login button. Buys/sells are simulated against a fake SOL balance;
 * no transactions ever hit the chain.
 */
export interface DemoPosition {
  mint: string;
  symbol: string;
  uiAmount: number; // token amount held
  costSol: number;  // total SOL spent acquiring it
}

interface DemoState {
  isDemo: boolean;
  solBalance: number; // fake SOL
  positions: Record<string, DemoPosition>;
  enterDemo: () => void;
  exitDemo: () => void;
  paperBuy: (mint: string, symbol: string, solSpent: number, tokensReceived: number) => void;
  paperSell: (mint: string, solReceived: number, tokensSold: number) => void;
}

// Pre-populated holding so the reviewer sees a non-empty wallet immediately.
const SEED_POSITION: DemoPosition = {
  mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
  symbol: "BONK",
  uiAmount: 1_250_000,
  costSol: 0.15,
};

export const useDemoStore = create<DemoState>()(
  persist(
    (set) => ({
      isDemo: false,
      solBalance: 0,
      positions: {},

      enterDemo: () =>
        set({
          isDemo: true,
          solBalance: 1, // 1 fake SOL to paper-trade with
          positions: { [SEED_POSITION.mint]: { ...SEED_POSITION } },
        }),

      exitDemo: () => set({ isDemo: false, solBalance: 0, positions: {} }),

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
          };
        }),

      paperSell: (mint, solReceived, tokensSold) =>
        set((s) => {
          const prev = s.positions[mint];
          if (!prev) return s;
          const remaining = Math.max(0, prev.uiAmount - tokensSold);
          const positions = { ...s.positions };
          if (remaining <= 0.000001) delete positions[mint];
          else positions[mint] = { ...prev, uiAmount: remaining };
          return { solBalance: s.solBalance + solReceived, positions };
        }),
    }),
    { name: "polyx-demo" }
  )
);
