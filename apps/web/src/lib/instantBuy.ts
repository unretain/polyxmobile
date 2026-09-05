"use client";

/**
 * Instant buy from a pulse row — one click, no token page, no quote.
 *
 * The amount lives per COLUMN, not globally: what you'd throw at a 30-second-old
 * launch is not what you'd put into something that already migrated. Persisted so it
 * survives a reload.
 *
 * Execution deliberately mirrors SwapWidget's client-side path: the quote is not an
 * input to it (executeClientPumpSwap fetches its own and builds its own transaction
 * from the raw lamports), so a buy here costs exactly one round trip and needs no
 * server session. The fill is resolved separately, in parallel, only so the trade log
 * has the token count — a 0 there would poison the cost basis and the chart's
 * average-entry line.
 */
import { useCallback, useEffect, useState } from "react";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { useDemoStore } from "@/stores/demoStore";
import { useTradeLogStore } from "@/stores/tradeLogStore";
import { executeClientPumpSwap } from "@/lib/mobileSwap";

export type ColumnKey = "new" | "final" | "migrated";

const KEY = "polyx.pulse.instantBuy.v1";
const DEFAULTS: Record<ColumnKey, number> = { new: 0.1, final: 0.1, migrated: 0.1 };
const SLIPPAGE_BPS = 3000; // 30%, same as the swap panel — memecoins move mid-flight
// Base fee + priority fee + rent for the token account a first buy has to create.
// Spending right up to the balance leaves nothing for these and the tx never lands.
export const FEE_HEADROOM_SOL = 0.003;

export function loadAmounts(): Record<ColumnKey, number> {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAmounts(a: Record<ColumnKey, number>) {
  try { window.localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* private mode */ }
}

/** Amounts shared by every column, kept in sync across the three headers. */
export function useInstantBuyAmounts() {
  const [amounts, setAmounts] = useState<Record<ColumnKey, number>>(DEFAULTS);
  useEffect(() => { setAmounts(loadAmounts()); }, []);
  const set = useCallback((col: ColumnKey, v: number) => {
    setAmounts((prev) => {
      const next = { ...prev, [col]: v };
      saveAmounts(next);
      return next;
    });
  }, []);
  return { amounts, set };
}

export interface BuyResult {
  ok: boolean;
  error?: string;
  signature?: string;
}

/**
 * Buy `solAmount` of `mint` immediately. Returns rather than throws so the caller can
 * render the outcome inline on the row.
 */
export async function instantBuy(opts: {
  mint: string;
  symbol: string;
  solAmount: number;
  image?: string;
  /** Live price in SOL, for estimating the token count when no quote is handy. */
  priceSol?: number;
  /** Live market cap in USD — pins the chart's average-entry line at this fill. */
  capUsd?: number;
  isGraduated?: boolean;
}): Promise<BuyResult> {
  const { mint, symbol, solAmount, image, priceSol = 0, capUsd = 0, isGraduated = false } = opts;
  if (!(solAmount > 0)) return { ok: false, error: "Set an amount first" };

  const lamports = Math.floor(solAmount * 1e9).toString();

  // How many tokens `solAmount` buys. Kicked off here so the real path can overlap it
  // with signing; demo awaits it directly, since paper trading has no fill to measure.
  const estimate: Promise<number> = (async () => {
    if (priceSol > 0) return solAmount / priceSol;
    try {
      // Derive the SOL price from the coin's own USD figures — the same trick the
      // portfolio uses, and it works when the caller's row had a zero in it (a
      // migrated coin with no trades in the window reports marketCapSol = 0).
      const r = await fetch(`/api/pulse/token/${mint}`, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        const solUsd = j.marketCapSol > 0 ? j.marketCap / j.marketCapSol : 0;
        const ps = j.priceSol > 0 ? j.priceSol : solUsd > 0 && j.price ? j.price / solUsd : 0;
        if (ps > 0) return solAmount / ps;
      }
    } catch { /* fall through */ }
    try {
      const path = isGraduated ? "quote" : "pump-quote";
      const q = await fetch(
        `/api/trading/${path}?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${lamports}&slippage=${SLIPPAGE_BPS}`
      );
      if (!q.ok) return 0;
      const j = await q.json();
      return Number(j.outAmount) / 1e6 || 0; // pump.fun mints are 6dp
    } catch {
      return 0;
    }
  })();

  // DEMO: paper trade against the demo balance. No wallet, no key, no chain — the
  // demo store IS the account, so every check below about seeds and RPC balances is
  // meaningless here. Without this branch instant buy demanded a real wallet and
  // failed on the seed check, which is why it did nothing in demo mode.
  const demo = useDemoStore.getState();
  if (demo.isDemo) {
    if (solAmount > demo.solBalance + 1e-9) {
      return { ok: false, error: `Not enough demo SOL — you have ${demo.solBalance.toFixed(3)}` };
    }
    const tokens = await estimate;
    // Never book a zero: it is skipped by the chart's average-entry pass and makes
    // the average cost Infinity. Same trap as the real path.
    if (!(tokens > 0)) return { ok: false, error: "No price yet — try again in a moment" };
    demo.paperBuy(mint, symbol, solAmount, tokens, capUsd > 0 ? capUsd : undefined);
    return { ok: true };
  }

  const wallet = useMobileWalletStore.getState().wallet;
  if (!wallet?.publicKey) return { ok: false, error: "No wallet on this device" };

  const mnemonic = await useMobileWalletStore.getState().getMnemonic();
  if (!mnemonic) {
    // Say WHICH failure it is. The seed and the key that encrypts it both live in
    // localStorage, which is per-origin — a wallet set up on polyx.trade simply is
    // not present on a *.railway.app preview URL, and vice versa.
    return {
      ok: false,
      error: wallet.encryptedMnemonic
        ? "Saved key won't unlock in this browser — re-import your phrase in Settings"
        : "No key saved on this domain — re-import your phrase in Settings",
    };
  }

  /** SOL + this coin's balance, as the RPC sees it. */
  const snapshot = async (): Promise<{ sol: number; token: number } | null> => {
    try {
      const r = await fetch(`/api/trading/balance?address=${wallet.publicKey}`, { cache: "no-store" });
      if (!r.ok) return null;
      const j = await r.json();
      const t = (j.tokens || []).find((x: any) => x.mint === mint);
      return { sol: Number(j?.sol?.uiBalance) || 0, token: t ? Number(t.uiBalance) || 0 : 0 };
    } catch {
      return null;
    }
  };

  // Read balances BEFORE the swap. This is both the baseline for the fill delta and
  // the affordability check — and the check has to happen HERE, not on chain.
  //
  // executeClientPumpSwap sends with skipPreflight, so an unaffordable buy is
  // broadcast anyway, never lands, and confirmByPolling then waits its full 45s for a
  // signature that will never confirm. That is the "it just loads forever" symptom:
  // the trade was doomed before it was sent and we spent 45 seconds finding out.
  const before = await snapshot();
  if (before && before.sol < solAmount + FEE_HEADROOM_SOL) {
    return {
      ok: false,
      error: `Not enough SOL — you have ${before.sol.toFixed(4)}, this needs ~${(solAmount + FEE_HEADROOM_SOL).toFixed(4)}`,
    };
  }

  try {
    const result = await executeClientPumpSwap(mnemonic, mint, lamports, SLIPPAGE_BPS, true);

    // MEASURE the fill rather than trusting an estimate.
    //
    // This used to record whatever the estimate produced, and when the estimate came
    // back 0 — a row with marketCapSol = 0, or a quote endpoint that 404s — it wrote
    // `tokenAmount: 0`. That is not a harmless approximation: the chart's average
    // entry/exit pass skips any fill with tokenAmount <= 0 outright, so no green line
    // ever appeared, and tokenPnl divides SOL spent by tokens bought, making the
    // average entry price Infinity. The buy had happened; it just left no trace.
    const after = before === null ? null : await snapshot();
    const measured = before !== null && after !== null ? after.token - before.token : 0;
    const tokenAmount = measured > 0 ? measured : await estimate;

    useTradeLogStore.getState().addTrade({
      mint,
      symbol,
      side: "buy",
      solAmount,
      tokenAmount,
      ts: Date.now(),
      wallet: wallet.publicKey,
      signature: result?.signature,
      image,
      capUsd: capUsd > 0 ? capUsd : undefined,
    });
    return { ok: true, signature: result?.signature };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Buy failed" };
  }
}
