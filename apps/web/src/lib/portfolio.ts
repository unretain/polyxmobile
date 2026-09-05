// Minimal trade shape shared by the real (LoggedTrade) and demo (DemoTrade) stores.
type PnlTrade = { side: "buy" | "sell"; solAmount: number; tokenAmount: number; ts: number };

// Single source of truth for PnL from the local trade log. Everything (swap panel
// stats, portfolio positions + totals) runs through here, so PnL is consistent.
//
// The key fix over the old "SOL spent vs SOL received" math: open positions are
// valued at the CURRENT price (unrealized PnL). Without it, an unsold buy looked
// like -100% (no SOL back yet) and a round-trip looked like 0%.
export interface TokenPnl {
  bought: number; // total tokens bought
  sold: number; // total tokens sold
  holding: number; // tokens still held
  solSpent: number; // total SOL spent buying
  solReceived: number; // total SOL from sells
  avgBuyPrice: number; // SOL per token
  realizedPnl: number; // SOL, from sells
  unrealizedPnl: number; // SOL, from remaining holdings at current price
  currentValue: number; // SOL value of remaining holdings
  totalPnl: number; // realized + unrealized, SOL
  pnlPercent: number; // total PnL as % of SOL spent
}

// priceSol = current price per token in SOL (0 if unknown → unrealized treated as 0).
export function tokenPnl(trades: PnlTrade[], priceSol: number): TokenPnl {
  let bought = 0, sold = 0, solSpent = 0, solReceived = 0, realizedPnl = 0;
  // A fill whose token amount couldn't be determined is worse than a missing fill:
  // its SOL still lands in solSpent, so `solSpent / bought` goes to Infinity and every
  // number downstream is garbage. Drop those rather than poisoning the average.
  trades = trades.filter((t) => t.tokenAmount > 0 && t.solAmount > 0);
  for (const t of [...trades].sort((a, b) => a.ts - b.ts)) {
    if (t.side === "buy") {
      bought += t.tokenAmount;
      solSpent += t.solAmount;
    } else {
      // Realized against the running average buy price at the time of the sell.
      const avg = bought > 0 ? solSpent / bought : 0;
      realizedPnl += t.solAmount - avg * t.tokenAmount;
      sold += t.tokenAmount;
      solReceived += t.solAmount;
    }
  }
  const holding = Math.max(0, bought - sold);
  const avgBuyPrice = bought > 0 ? solSpent / bought : 0;
  const currentValue = holding * (priceSol > 0 ? priceSol : 0);
  const unrealizedPnl = holding > 0 && priceSol > 0 ? (priceSol - avgBuyPrice) * holding : 0;
  const totalPnl = realizedPnl + unrealizedPnl;
  const pnlPercent = solSpent > 0 ? (totalPnl / solSpent) * 100 : 0;
  return {
    bought, sold, holding, solSpent, solReceived,
    avgBuyPrice, realizedPnl, unrealizedPnl, currentValue, totalPnl, pnlPercent,
  };
}
