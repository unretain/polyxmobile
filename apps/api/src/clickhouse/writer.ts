/**
 * Dual-write buffer for the SINGLE feed decoder. Instead of running a second
 * gRPC connection + decoder (the old ingestor), the live feed decodes each
 * pump.fun event once and calls record*() here; a 1s timer batch-inserts into
 * ClickHouse. Halves CPU vs two decoders, which is what removes the stream lag.
 *
 * No-ops entirely if CLICKHOUSE_URL isn't set.
 */
import { getClickHouse } from "./client";

export type TokenRow = { mint: string; name: string; symbol: string; uri: string; image: string; creator: string; twitter?: string; telegram?: string; website?: string; created_at: string; created_slot: number };
export type TradeRow = { mint: string; signature: string; slot: number; seq?: number; ts: string; is_buy: number; sol_amount: number; token_amount: number; price_sol: number; mcap_sol: number; real_token_reserves: number; real_sol?: number; fee_sol?: number; creator_fee_sol?: number; recv_ts?: string; trader: string };
export type GradRow = { mint: string; ts: string };

let tokenBuf: TokenRow[] = [];
let tradeBuf: TradeRow[] = [];
let gradBuf: GradRow[] = [];
let flushTimer: NodeJS.Timeout | null = null;
const stats = { tokens: 0, trades: 0, grads: 0, flushed: 0 };

/** 'YYYY-MM-DD HH:MM:SS.mmm' UTC for DateTime64(3). */
export function chDateTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

// Guard against a second API writing to the same ClickHouse. Two writers on one
// stream means every row lands twice — it doubled volume/fees/tx counts and drew
// phantom candles. Local dev sets CH_READONLY=true and reads without writing.
const READONLY = String(process.env.CH_READONLY || "").toLowerCase() === "true";

export function recordToken(r: TokenRow) { if (flushTimer && !READONLY) tokenBuf.push(r); }
// Stamped here, not at the call sites, so every trade gets ordering for free.
let tradeSeq = 0;
export function recordTrade(r: TradeRow) {
  if (flushTimer && !READONLY) {
    r.seq = ++tradeSeq;
    // Millisecond receive time — block time only has second resolution.
    if (!r.recv_ts) r.recv_ts = chDateTime(Date.now());
    tradeBuf.push(r);
  }
}
export function recordGraduation(r: GradRow) { if (flushTimer && !READONLY) gradBuf.push(r); }

async function flush() {
  const ch = getClickHouse();
  if (!ch) return;
  const tokens = tokenBuf; tokenBuf = [];
  const trades = tradeBuf; tradeBuf = [];
  const grads = gradBuf; gradBuf = [];
  try {
    if (tokens.length) await ch.insert({ table: "tokens", values: tokens, format: "JSONEachRow" });
    if (trades.length) await ch.insert({ table: "trades", values: trades, format: "JSONEachRow" });
    if (grads.length) await ch.insert({ table: "graduations", values: grads, format: "JSONEachRow" });
    stats.flushed += tokens.length + trades.length + grads.length;
  } catch (err) {
    // Drop the batch rather than growing unbounded; keep the feed healthy.
    console.error("[ch-writer] flush error:", (err as Error).message);
  }
}

/** Start the 1s flush timer. No-op if ClickHouse isn't configured. */
export function startChWriter() {
  if (flushTimer) return;
  if (!getClickHouse()) { console.log("[ch-writer] ClickHouse not configured — persistence off"); return; }
  flushTimer = setInterval(() => { flush().catch(() => {}); }, 1000);
  setInterval(() => {
    console.log(`[ch-writer] buffered tokens=${tokenBuf.length} trades=${tradeBuf.length} grads=${gradBuf.length} flushed=${stats.flushed}`);
  }, 60000);
  console.log("[ch-writer] dual-write to ClickHouse started (single decoder, no 2nd gRPC)");
}
