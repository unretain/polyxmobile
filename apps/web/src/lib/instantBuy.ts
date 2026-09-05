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
import { useTradeLogStore } from "@/stores/tradeLogStore";
import { executeClientPumpSwap } from "@/lib/mobileSwap";

export type ColumnKey = "new" | "final" | "migrated";

const KEY = "polyx.pulse.instantBuy.v1";
const DEFAULTS: Record<ColumnKey, number> = { new: 0.1, final: 0.1, migrated: 0.1 };
const SLIPPAGE_BPS = 3000; // 30%, same as the swap panel — memecoins move mid-flight

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

  const wallet = useMobileWalletStore.getState().wallet;
  if (!wallet?.publicKey) return { ok: false, error: "No wallet" };

  const mnemonic = await useMobileWalletStore.getState().getMnemonic();
  if (!mnemonic) {
    return { ok: false, error: "Wallet locked — re-import your recovery phrase in Settings" };
  }

  const lamports = Math.floor(solAmount * 1e9).toString();

  // Started before the swap so it costs no extra wall clock.
  const fillPromise: Promise<number> = (async () => {
    if (priceSol > 0) return solAmount / priceSol;
    try {
      const path = isGraduated ? "quote" : "pump-quote";
      const r = await fetch(
        `/api/trading/${path}?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${lamports}&slippage=${SLIPPAGE_BPS}`
      );
      if (!r.ok) return 0;
      const j = await r.json();
      // pump.fun mints are 6dp; the quote is in base units.
      return Number(j.outAmount) / 1e6 || 0;
    } catch {
      return 0;
    }
  })();

  try {
    const result = await executeClientPumpSwap(mnemonic, mint, lamports, SLIPPAGE_BPS, true);
    const tokenAmount = await fillPromise;
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
