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
