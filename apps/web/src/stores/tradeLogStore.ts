import { create } from "zustand";
import { persist } from "zustand/middleware";

// A locally-recorded real (non-demo) trade. The client signs its own swaps, so it
// knows them exactly — we record them here instead of relying on the shared feed,
// whose trader-decoding is unreliable (many trades land with an empty trader).
// Drives the chart's B/S bubbles and the mobile-wallet portfolio, instantly and
// deterministically, with no feed lag.
export interface LoggedTrade {
  mint: string;
  symbol: string;
  side: "buy" | "sell";
  solAmount: number; // SOL spent (buy) or received (sell)
  tokenAmount: number; // UI token amount
  ts: number; // ms
  wallet: string; // signer pubkey, so a wallet switch shows the right history
  signature?: string;
  image?: string; // token logo, captured at trade time for the portfolio
  // Market cap in USD at the instant the fill landed — the chart's own y-axis unit.
  // Stamped here because it is the ONLY moment it can be known exactly. Deriving it
  // later from the candle covering the fill reads that candle's `close`, which keeps
  // moving until the candle closes, so the average lines drifted after every trade.
  capUsd?: number;
}

interface TradeLogState {
  trades: LoggedTrade[];
  addTrade: (t: LoggedTrade) => void;
  clear: () => void;
}

export const useTradeLogStore = create<TradeLogState>()(
  persist(
    (set) => ({
      trades: [],
      addTrade: (t) =>
        set((s) => ({
          // Dedupe by signature when present; cap history so localStorage stays small.
          trades: [
            ...s.trades.filter((x) => !(t.signature && x.signature === t.signature)),
            t,
          ].slice(-500),
        })),
      clear: () => set({ trades: [] }),
    }),
    { name: "polyx-trade-log" }
  )
);
