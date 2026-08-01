/**
 * pump.fun ingestor: the SINGLE Corvus gRPC consumer.
 *
 * Decodes pump.fun Anchor self-CPI events (Create / Trade / Complete) off the
 * yellowstone stream and batch-inserts them into ClickHouse. Everything the app
 * shows (new pairs, OHLCV, market cap, 24h volume, trades, graduations) is then
 * derived from ClickHouse, so it's identical for every user and survives restarts.
 *
 * Discriminators & the bonding-curve math were validated live against Corvus.
 */
import { PublicKey } from "@solana/web3.js";
import { getClickHouse } from "../clickhouse/client";

const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const SELF_CPI_DISC = "e445a52e51cb9a1d";
const CREATE_EVENT_DISC = "1b72a94ddeeb6376";
const TRADE_EVENT_DISC = "bddb7fd34ee661ee";
const COMPLETE_EVENT_DISC = "5f72619cd42e9808";

const TOTAL_SUPPLY = 1_000_000_000;
const INITIAL_REAL_TOKEN_RAW = 793_100_000 * 1e6;

const FLUSH_MS = 1000;
const MAX_RECONNECT_DELAY = 30000;

// No SOL price here on purpose: we store SOL-denominated values (from on-chain
// reserves) and convert to USD at read time, so a price-feed hiccup never writes $0.

// ---- decode helpers --------------------------------------------------------
function readString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  offset += 4;
  return [buf.slice(offset, offset + len).toString("utf8"), offset + len];
}
function b58(buf: Buffer): string {
  return new PublicKey(buf).toBase58();
}
function chDateTime(ms: number): string {
  // 'YYYY-MM-DD HH:MM:SS.mmm' in UTC for DateTime64(3)
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

type TokenRow = { mint: string; name: string; symbol: string; uri: string; image: string; creator: string; created_at: string; created_slot: number };
type TradeRow = { mint: string; signature: string; slot: number; ts: string; is_buy: number; sol_amount: number; token_amount: number; price_sol: number; mcap_sol: number; real_token_reserves: number; trader: string };
type GradRow = { mint: string; ts: string };

// ---- ingestor state --------------------------------------------------------
const state = {
  connected: false,
  connecting: false,
  stream: null as any,
  reconnectAttempts: 0,
  tokenBuf: [] as TokenRow[],
  tradeBuf: [] as TradeRow[],
  gradBuf: [] as GradRow[],
  imageCache: new Map<string, string>(),
  seenTokens: new Set<string>(),
  stats: { creates: 0, trades: 0, graduations: 0, flushed: 0 },
};

function resolveImageAsync(row: TokenRow) {
  const uri = row.uri;
  if (!uri || state.imageCache.has(uri)) return;
  state.imageCache.set(uri, ""); // mark in-flight
  fetch(uri, { signal: AbortSignal.timeout(6000) })
    .then((r) => r.json())
    .then((j) => {
      const img = typeof j?.image === "string" ? j.image : "";
      if (!img) return;
      state.imageCache.set(uri, img);
      // Re-insert the FULL row with the image filled (same name/symbol/created_at).
      // ReplacingMergeTree(ingested_at) keeps this later row, so metadata is intact.
      state.tokenBuf.push({ ...row, image: img });
    })
    .catch(() => {});
}

function decodeAndBuffer(update: any) {
  const tx = update.transaction?.transaction;
  if (!tx?.meta) return;
  const keys: Uint8Array[] = tx.transaction?.message?.accountKeys || [];
  const slot = Number(update.transaction?.slot || 0);

  const outer = tx.transaction?.message?.instructions || [];
  const inner: any[] = [];
  for (const g of tx.meta.innerInstructions || []) for (const ix of g.instructions || []) inner.push(ix);

  for (const ix of [...outer, ...inner]) {
    const progIdx = ix.programIdIndex;
    if (progIdx === undefined || !ix.data) continue;
    const pk = keys[progIdx];
    if (!pk || b58(Buffer.from(pk)) !== PUMP_FUN_PROGRAM) continue;

    const data = typeof ix.data === "string" ? Buffer.from(ix.data, "base64") : Buffer.from(ix.data);
    if (data.length < 16 || data.slice(0, 8).toString("hex") !== SELF_CPI_DISC) continue;
    const disc = data.slice(8, 16).toString("hex");

    try {
      if (disc === CREATE_EVENT_DISC) {
        let o = 16;
        let name: string, symbol: string, uri: string;
        [name, o] = readString(data, o);
        [symbol, o] = readString(data, o);
        [uri, o] = readString(data, o);
        const mint = b58(data.slice(o, o + 32)); o += 32;
        o += 32; // bonding curve
        const creator = data.length >= o + 32 ? b58(data.slice(o, o + 32)) : "";
        if (state.seenTokens.has(mint)) continue;
        state.seenTokens.add(mint);
        const row: TokenRow = {
          mint, name: name.trim(), symbol: symbol.trim(), uri: uri.trim(),
          image: "", creator, created_at: chDateTime(Date.now()), created_slot: slot,
        };
        state.tokenBuf.push(row);
        resolveImageAsync(row);
        state.stats.creates++;
      } else if (disc === TRADE_EVENT_DISC) {
        let o = 16;
        const mint = b58(data.slice(o, o + 32)); o += 32;
        const solLamports = Number(data.readBigUInt64LE(o)); o += 8;
        const tokenRaw = Number(data.readBigUInt64LE(o)); o += 8;
        const isBuy = data.readUInt8(o) === 1; o += 1;
        o += 32; // user
        const tsSec = Number(data.readBigUInt64LE(o)); o += 8;
        const vSol = Number(data.readBigUInt64LE(o)); o += 8;
        const vTok = Number(data.readBigUInt64LE(o)); o += 8;
        o += 8; // real sol reserves
        const realTok = Number(data.readBigUInt64LE(o)); o += 8;
        if (vTok <= 0) continue;
        const priceSol = (vSol / 1e9) / (vTok / 1e6);
        const solAmt = solLamports / 1e9;
        const ts = tsSec > 1_600_000_000 && tsSec < 4_000_000_000 ? tsSec * 1000 : Date.now();
        state.tradeBuf.push({
          mint, signature: "", slot, ts: chDateTime(ts), is_buy: isBuy ? 1 : 0,
          sol_amount: solAmt, token_amount: tokenRaw / 1e6,
          price_sol: priceSol,
          mcap_sol: priceSol * TOTAL_SUPPLY,
          real_token_reserves: realTok,
          trader: "",
        });
        state.stats.trades++;
      } else if (disc === COMPLETE_EVENT_DISC) {
        const mint = b58(data.slice(16 + 32, 16 + 64));
        state.gradBuf.push({ mint, ts: chDateTime(Date.now()) });
        state.stats.graduations++;
      }
    } catch { /* skip malformed */ }
  }
}

async function flush() {
  const ch = getClickHouse();
  if (!ch) return;
  const tokens = state.tokenBuf; state.tokenBuf = [];
  const trades = state.tradeBuf; state.tradeBuf = [];
  const grads = state.gradBuf; state.gradBuf = [];
  try {
    if (tokens.length) await ch.insert({ table: "tokens", values: tokens, format: "JSONEachRow" });
    if (trades.length) await ch.insert({ table: "trades", values: trades, format: "JSONEachRow" });
    if (grads.length) await ch.insert({ table: "graduations", values: grads, format: "JSONEachRow" });
    if (tokens.length + trades.length + grads.length > 0) {
      state.stats.flushed += tokens.length + trades.length + grads.length;
    }
  } catch (err) {
    console.error("[ingestor] flush error:", (err as Error).message);
    // drop this batch rather than growing unbounded; next batches continue.
  }
}

async function connect(endpoint: string, token?: string) {
  if (state.connected || state.connecting) return;
  state.connecting = true;
  try {
    const { default: Client, CommitmentLevel } = await import("@triton-one/yellowstone-grpc");
    const client = new Client(endpoint, token || undefined, { "grpc.max_receive_message_length": 64 * 1024 * 1024 });
    state.stream = await client.subscribe();

    state.stream.on("data", (u: any) => { try { decodeAndBuffer(u); } catch {} });
    state.stream.on("error", (e: Error) => { console.error("[ingestor] stream error:", e.message); teardown(endpoint, token); });
    state.stream.on("end", () => { console.warn("[ingestor] stream ended"); teardown(endpoint, token); });

    await new Promise<void>((resolve, reject) => {
      state.stream.write({
        slots: {}, accounts: {},
        transactions: { pump: { vote: false, failed: false, accountInclude: [PUMP_FUN_PROGRAM], accountExclude: [], accountRequired: [] } },
        transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {},
        commitment: CommitmentLevel.CONFIRMED, accountsDataSlice: [],
      }, (err: Error | null) => (err ? reject(err) : resolve()));
    });

    state.connected = true;
    state.connecting = false;
    state.reconnectAttempts = 0;
    console.log(`[ingestor] connected to ${endpoint}, streaming pump.fun -> ClickHouse`);
  } catch (err) {
    console.error("[ingestor] connect failed:", (err as Error).message);
    state.connecting = false;
    teardown(endpoint, token);
  }
}

function teardown(endpoint: string, token?: string) {
  state.connected = false;
  state.connecting = false;
  state.stream = null;
  state.reconnectAttempts++;
  const delay = Math.min(1000 * 2 ** state.reconnectAttempts, MAX_RECONNECT_DELAY);
  console.log(`[ingestor] reconnecting in ${delay}ms`);
  setTimeout(() => connect(endpoint, token), delay);
}

/** Start the ingestor. No-op if ClickHouse or the gRPC endpoint isn't configured. */
export function startIngestor() {
  const endpoint = process.env.GRPC_ENDPOINT;
  if (!endpoint) { console.log("[ingestor] GRPC_ENDPOINT not set — ingestor disabled"); return; }
  if (!getClickHouse()) { console.log("[ingestor] ClickHouse not configured — ingestor disabled"); return; }

  setInterval(() => { flush().catch(() => {}); }, FLUSH_MS);
  setInterval(() => {
    const s = state.stats;
    console.log(`[ingestor] creates=${s.creates} trades=${s.trades} grads=${s.graduations} flushed=${s.flushed} conn=${state.connected}`);
  }, 60000);

  connect(endpoint, process.env.GRPC_TOKEN);
}
