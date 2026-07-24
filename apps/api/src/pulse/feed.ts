/**
 * THE pulse feed. One server-side Yellowstone gRPC connection → in-memory live
 * state → broadcast over WebSocket to every user. This is how memecoin apps
 * (Axiom/Photon/etc.) do it: no DB in the hot path, everyone sees the same stream.
 *
 * - CreateEvent  → new token (name/symbol/uri; image resolved async)
 * - TradeEvent   → live market cap / curve progress / % change / volume
 * - CompleteEvent→ graduation
 * Discriminators + bonding-curve math verified live against Corvus.
 */
import { EventEmitter } from "events";
import { PublicKey, Connection } from "@solana/web3.js";
import bs58 from "bs58";

const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
// PumpSwap (pump.fun's AMM) — where tokens trade AFTER graduation. Verified live.
const PUMPSWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const WSOL = "So11111111111111111111111111111111111111112";
const SELF_CPI_DISC = "e445a52e51cb9a1d";
const CREATE_EVENT_DISC = "1b72a94ddeeb6376";
const TRADE_EVENT_DISC = "bddb7fd34ee661ee";
const COMPLETE_EVENT_DISC = "5f72619cd42e9808";

const TOTAL_SUPPLY = 1_000_000_000;
const INITIAL_REAL_TOKEN_RAW = 793_100_000 * 1e6;
const MIGRATION_MC_SOL = 410.9;
const INITIAL_MC_SOL = 28;
const FINAL_STRETCH_PROGRESS = 80;
const MAX_RECONNECT_DELAY = 30000;

export interface PulseToken {
  address: string;
  symbol: string;
  name: string;
  logoUri: string | null;
  price: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  marketCapSol: number;
  migrationMc: number;
  txCount: number;
  createdAt: number;
  source: string;
  complete: boolean;
  progress: number;
  destination?: string;
  // internal
  priceSol?: number;
  launchPriceSol?: number;
  uri?: string;
}

export const feedEvents = new EventEmitter();

// OHLCV candles in SOL (converted to USD at read). Built from OUR gRPC stream.
// Two tiers so we get true 1-SECOND candles for the live view AND longer history:
//   - 1s candles: a new bar every second there's a trade (short window)
//   - 1m candles: 12h window; 5m/15m/1h/... roll up from here
interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
const SEC_MS = 1_000;
const MIN_MS = 60_000;
const MAX_1S = 1_800; // 30 min of per-second candles
const MAX_1M = 720;   // 12h of 1-minute candles

const state = {
  connected: false,
  connecting: false,
  stream: null as any,
  reconnectAttempts: 0,
  solPrice: 0,
  solPriceAt: 0,
  newTokens: new Map<string, PulseToken>(),
  graduatingTokens: new Map<string, PulseToken>(),
  graduatedTokens: new Map<string, PulseToken>(),
  candles1s: new Map<string, Map<number, Candle>>(),
  candles1m: new Map<string, Map<number, Candle>>(),
  imageCache: new Map<string, string>(),
  // Mints explicitly requested (a user searched/opened them) that migrated before
  // we saw them — we watch these on PumpSwap on-demand so their charts keep updating.
  watched: new Set<string>(),
  stats: { creates: 0, trades: 0, graduations: 0, pumpswap: 0 },
};

function upsertCandle(map: Map<number, Candle>, bucket: number, price: number, vol: number, cap: number) {
  const c = map.get(bucket);
  if (!c) {
    map.set(bucket, { t: bucket, o: price, h: price, l: price, c: price, v: vol });
    if (map.size > cap) { const oldest = map.keys().next().value; if (oldest !== undefined) map.delete(oldest); }
  } else {
    if (price > c.h) c.h = price;
    if (price < c.l) c.l = price;
    c.c = price;
    c.v += vol;
  }
}

// Last recorded price per mint (SOL), used to reject outlier PumpSwap decodes.
const lastPrice = new Map<string, number>();

// Record a trade into BOTH the 1s and 1m candle series (price in SOL).
function recordCandle(mint: string, priceSol: number, solAmount: number) {
  if (priceSol <= 0) return;
  lastPrice.set(mint, priceSol);
  let s = state.candles1s.get(mint);
  if (!s) { s = new Map(); state.candles1s.set(mint, s); }
  let m = state.candles1m.get(mint);
  if (!m) { m = new Map(); state.candles1m.set(mint, m); }
  const now = Date.now();
  upsertCandle(s, Math.floor(now / SEC_MS) * SEC_MS, priceSol, solAmount, MAX_1S);
  upsertCandle(m, Math.floor(now / MIN_MS) * MIN_MS, priceSol, solAmount, MAX_1M);
}

function dropCandles(mint: string) {
  state.candles1s.delete(mint);
  state.candles1m.delete(mint);
}

// Record a trade at an EXPLICIT timestamp (used by backfill for historical trades).
function recordCandleAt(mint: string, priceSol: number, solAmount: number, tsMs: number) {
  if (priceSol <= 0) return;
  let s = state.candles1s.get(mint);
  if (!s) { s = new Map(); state.candles1s.set(mint, s); }
  let m = state.candles1m.get(mint);
  if (!m) { m = new Map(); state.candles1m.set(mint, m); }
  upsertCandle(s, Math.floor(tsMs / SEC_MS) * SEC_MS, priceSol, solAmount, MAX_1S);
  upsertCandle(m, Math.floor(tsMs / MIN_MS) * MIN_MS, priceSol, solAmount, MAX_1M);
}

// ---- SOL price (only to render USD; not a data dependency) ------------------
async function refreshSolPrice() {
  if (Date.now() - state.solPriceAt < 30000 && state.solPrice > 0) return;
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT");
    const j = await r.json();
    if (j?.price) { state.solPrice = parseFloat(j.price); state.solPriceAt = Date.now(); return; }
  } catch {}
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const j = await r.json();
    if (j?.solana?.usd) { state.solPrice = j.solana.usd; state.solPriceAt = Date.now(); }
  } catch {}
}

// ---- decode helpers --------------------------------------------------------
function readString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  offset += 4;
  return [buf.slice(offset, offset + len).toString("utf8"), offset + len];
}
function b58(buf: Buffer): string {
  return new PublicKey(buf).toBase58();
}

async function resolveImage(mint: string, uri: string) {
  if (!uri) return;
  const attach = (img: string) => {
    const t = state.newTokens.get(mint) || state.graduatingTokens.get(mint) || state.graduatedTokens.get(mint);
    if (t && !t.logoUri) t.logoUri = img;
  };
  const cached = state.imageCache.get(uri);
  if (cached) { attach(cached); return; } // already resolved — (re)attach
  if (cached === "") return;              // fetch in flight — don't duplicate
  state.imageCache.set(uri, "");          // mark in-flight
  try {
    const res = await fetch(uri, { signal: AbortSignal.timeout(8000) });
    const j = await res.json();
    const img = typeof j?.image === "string" ? j.image : "";
    // On failure/no-image DELETE the marker (not leave "") so a later view retries,
    // instead of caching an empty result forever after one transient blip.
    if (!img) { state.imageCache.delete(uri); return; }
    state.imageCache.set(uri, img);
    attach(img);
  } catch {
    state.imageCache.delete(uri);
  }
}

function usd(token: PulseToken): PulseToken {
  const p = state.solPrice;
  return {
    ...token,
    marketCap: token.marketCapSol * p,
    price: (token.priceSol || 0) * p,
    migrationMc: MIGRATION_MC_SOL * p,
  };
}

function newToken(mint: string, name: string, symbol: string, uri: string): PulseToken {
  return {
    address: mint,
    symbol: symbol || mint.slice(0, 6),
    name: name || symbol || mint.slice(0, 8),
    logoUri: null,
    price: 0,
    priceChange24h: 0,
    volume24h: 0,
    liquidity: 0,
    marketCap: INITIAL_MC_SOL * state.solPrice,
    marketCapSol: INITIAL_MC_SOL,
    migrationMc: MIGRATION_MC_SOL * state.solPrice,
    txCount: 0,
    createdAt: Date.now(),
    source: "pump.fun",
    complete: false,
    progress: 0,
    priceSol: 0,
    uri,
  };
}

function handleTransaction(update: any) {
  const tx = update.transaction?.transaction;
  if (!tx?.meta) return;
  const keys: Uint8Array[] = tx.transaction?.message?.accountKeys || [];
  const signature = tx.signature ? bs58.encode(Buffer.from(tx.signature)) : "";
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
        const mint = b58(data.slice(o, o + 32));
        if (state.newTokens.has(mint) || state.graduatingTokens.has(mint) || state.graduatedTokens.has(mint)) continue;
        const token = newToken(mint, name.trim(), symbol.trim(), uri.trim());
        state.newTokens.set(mint, token);
        if (uri.trim()) resolveImage(mint, uri.trim());
        if (state.newTokens.size > 200) {
          const oldest = state.newTokens.keys().next().value;
          if (oldest) { state.newTokens.delete(oldest); dropCandles(oldest); }
        }
        state.stats.creates++;
        feedEvents.emit("new", usd(token));
      } else if (disc === TRADE_EVENT_DISC) {
        let o = 16;
        const mint = b58(data.slice(o, o + 32)); o += 32;
        const solLamports = Number(data.readBigUInt64LE(o)); o += 8;
        const tokenRaw = Number(data.readBigUInt64LE(o)); o += 8; // token amount (6 decimals)
        const isBuy = data.readUInt8(o) === 1; o += 1;
        const trader = b58(data.slice(o, o + 32)); o += 32; // user
        const tsSec = Number(data.readBigInt64LE(o)); o += 8; // on-chain block time (i64 seconds)
        const vSol = Number(data.readBigUInt64LE(o)); o += 8;
        const vTok = Number(data.readBigUInt64LE(o)); o += 8;
        o += 8; // real sol reserves
        const realTok = Number(data.readBigUInt64LE(o)); o += 8;
        if (vTok <= 0) continue;
        const token = state.newTokens.get(mint) || state.graduatingTokens.get(mint);
        if (!token) continue; // only tokens we saw created (no fake entries)
        const priceSol = (vSol / 1e9) / (vTok / 1e6);
        token.priceSol = priceSol;
        token.marketCapSol = priceSol * TOTAL_SUPPLY;
        token.progress = Math.max(0, Math.min(100, (1 - realTok / INITIAL_REAL_TOKEN_RAW) * 100));
        if (!token.launchPriceSol) token.launchPriceSol = priceSol;
        token.priceChange24h = token.launchPriceSol > 0 ? ((priceSol - token.launchPriceSol) / token.launchPriceSol) * 100 : 0;
        token.volume24h += (solLamports / 1e9) * state.solPrice;
        token.txCount++;
        // Bucket by ON-CHAIN block time (what Axiom/indexers use), NOT our processing
        // clock — bursty gRPC delivery otherwise piles trades into one wrong second and
        // mangles the candle wicks.
        recordCandleAt(mint, priceSol, solLamports / 1e9, tsSec > 0 ? tsSec * 1000 : Date.now());
        // Per-trade event for the token page's live "recent trades" panel.
        feedEvents.emit("trade", {
          mint, type: isBuy ? "buy" : "sell", tokenAmount: tokenRaw / 1e6,
          solAmount: solLamports / 1e9, marketCapSol: token.marketCapSol, trader, signature,
          timestamp: (tsSec > 0 ? tsSec : Math.floor(Date.now() / 1000)) * 1000,
        });
        state.stats.trades++;
        if (token.progress >= FINAL_STRETCH_PROGRESS && state.newTokens.has(mint)) {
          state.newTokens.delete(mint);
          state.graduatingTokens.set(mint, token);
        }
      } else if (disc === COMPLETE_EVENT_DISC) {
        const mint = b58(data.slice(16 + 32, 16 + 64));
        const token = state.newTokens.get(mint) || state.graduatingTokens.get(mint);
        if (!token || state.graduatedTokens.has(mint)) continue;
        state.newTokens.delete(mint);
        state.graduatingTokens.delete(mint);
        token.complete = true;
        token.progress = 100;
        token.destination = "pumpswap";
        state.graduatedTokens.set(mint, token);
        if (state.graduatedTokens.size > 100) {
          const oldest = state.graduatedTokens.keys().next().value;
          if (oldest) { state.graduatedTokens.delete(oldest); dropCandles(oldest); }
        }
        state.stats.graduations++;
        feedEvents.emit("graduated", usd(token));
      }
    } catch { /* skip malformed */ }
  }

  // PumpSwap (post-graduation AMM). A token we track trading here = it MIGRATED.
  if (keys.some((k) => b58(Buffer.from(k)) === PUMPSWAP_PROGRAM)) handlePumpSwap(tx, signature, keys);
}

// Price from pool reserves (uiAmount handles decimals) — IDL-independent, robust
// to pump changing their event layout. quote=WSOL(9), base=token.
function handlePumpSwap(tx: any, signature = "", keys: Uint8Array[] = []) {
  const post = tx.meta.postTokenBalances || [];
  if (!post.length) return;
  const mints = [...new Set(post.map((b: any) => b.mint))].filter((m: any) => m && m !== WSOL) as string[];
  if (mints.length !== 1) return;
  const mint = mints[0];
  // Only tokens we already know (migrated out of our own feed). Ones created
  // before we started need the RPC backfill instead.
  const token = state.newTokens.get(mint) || state.graduatingTokens.get(mint) || state.graduatedTokens.get(mint);
  // Process if we track this token OR it's an on-demand watched (searched) mint.
  if (!token && !state.watched.has(mint)) return;

  // Price from the actual swap DELTAS (balance changes), NOT absolute max reserves.
  // Otherwise a large unrelated holder or a big wrapped-SOL account gets picked as
  // the "reserve" and spikes the price. Only accounts involved in the swap have a
  // non-zero delta; the pool leg is the largest delta on each side.
  const preByIdx = new Map<number, any>();
  for (const b of (tx.meta.preTokenBalances || [])) preByIdx.set(b.accountIndex, b);
  let tokenDelta = 0, solDelta = 0;
  for (const b of post) {
    const pb = preByIdx.get(b.accountIndex);
    const d = Number(b.uiTokenAmount?.uiAmount || 0) - Number(pb?.uiTokenAmount?.uiAmount || 0);
    if (b.mint === mint) { if (Math.abs(d) > Math.abs(tokenDelta)) tokenDelta = d; }
    else if (b.mint === WSOL) { if (Math.abs(d) > Math.abs(solDelta)) solDelta = d; }
  }
  const absTok = Math.abs(tokenDelta), absSol = Math.abs(solDelta);
  if (absTok <= 0 || absSol <= 0) return;
  const priceSol = absSol / absTok;
  const volSol = absSol;

  // Safety net: drop an egregious outlier so one bad decode can't spike the chart.
  const ref = lastPrice.get(mint);
  if (ref && ref > 0 && (priceSol > ref * 20 || priceSol < ref * 0.05)) return;

  if (token) {
    // Migration: was on the bonding curve, now trading on PumpSwap.
    if (state.newTokens.has(mint) || state.graduatingTokens.has(mint)) {
      state.newTokens.delete(mint);
      state.graduatingTokens.delete(mint);
      token.complete = true;
      token.progress = 100;
      token.destination = "pumpswap";
      state.graduatedTokens.set(mint, token);
      feedEvents.emit("graduated", usd(token));
    }
    token.priceSol = priceSol;
    token.marketCapSol = priceSol * TOTAL_SUPPLY;
    if (!token.launchPriceSol) token.launchPriceSol = priceSol;
    token.priceChange24h = token.launchPriceSol > 0 ? ((priceSol - token.launchPriceSol) / token.launchPriceSol) * 100 : 0;
    token.volume24h += volSol * state.solPrice;
    token.txCount++;
  }
  recordCandle(mint, priceSol, volSol); // keep charting under the same mint
  // Per-trade event for the live trades panel. Buy/sell from the pool's token
  // reserve change (pool = largest token holder): pool loses tokens => user bought.
  let poolPre = 0, poolPost = -1;
  for (const b of post) {
    if (b.mint !== mint) continue;
    const amt = Number(b.uiTokenAmount?.uiAmount || 0);
    if (amt > poolPost) { poolPost = amt; poolPre = Number(preByIdx.get(b.accountIndex)?.uiTokenAmount?.uiAmount || 0); }
  }
  feedEvents.emit("trade", {
    mint, type: poolPost < poolPre ? "buy" : "sell", tokenAmount: absTok,
    solAmount: volSol, marketCapSol: priceSol * TOTAL_SUPPLY,
    trader: keys[0] ? b58(Buffer.from(keys[0])) : "", signature, timestamp: Date.now(),
  });
  state.stats.pumpswap++;
}

// ---- gRPC subscription (bonding-curve firehose + scoped PumpSwap) ----------
// CommitmentLevel loads lazily with the client; stash it so we can re-write the
// subscription when the set of migrated tokens changes.
let commitmentLevel: any = null;
let lastSubSig = "";
const MAX_SUB_MINTS = 150;

// Mints trading on PumpSwap (post-migration). We watch ONLY these, never the full
// PumpSwap firehose — that's what blows the rate limit. Scoped like this it's tiny.
function pumpswapWatchMints(): string[] {
  const set = new Set<string>();
  for (const m of state.graduatedTokens.keys()) set.add(m);
  for (const m of state.graduatingTokens.keys()) set.add(m);
  for (const m of state.watched) set.add(m);
  return Array.from(set).slice(-MAX_SUB_MINTS);
}

// Explicitly watch a mint's PumpSwap trades on-demand (e.g. a user opened an
// already-migrated coin we didn't see graduate). Picked up by maybeResubscribe().
const MAX_WATCHED = 80;
export function watchMint(mint: string) {
  if (state.watched.has(mint)) return;
  state.watched.add(mint);
  if (state.watched.size > MAX_WATCHED) {
    const oldest = state.watched.values().next().value;
    if (oldest) state.watched.delete(oldest);
  }
}

function buildSubscribeRequest() {
  const transactions: any = {
    // Bonding-curve activity: creates / trades / graduations.
    pump: { vote: false, failed: false, accountInclude: [PUMP_FUN_PROGRAM], accountExclude: [], accountRequired: [] },
  };
  const mints = pumpswapWatchMints();
  if (mints.length > 0) {
    // Post-migration trades for tokens we track. handleTransaction filters these
    // to the PumpSwap program, so non-AMM txns for these mints are ignored.
    transactions.pumpswap = { vote: false, failed: false, accountInclude: mints, accountExclude: [], accountRequired: [] };
  }
  return {
    slots: {}, accounts: {}, transactions,
    transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {},
    commitment: commitmentLevel, accountsDataSlice: [],
  };
}

function writeSubscription(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!state.stream) return resolve();
    state.stream.write(buildSubscribeRequest(), (err: Error | null) => (err ? reject(err) : resolve()));
  });
}

// When a token migrates, re-write the subscription so its PumpSwap trades start
// streaming. Cheap: only re-writes when the watched-mint set actually changes.
async function maybeResubscribe() {
  if (!state.connected || !state.stream) return;
  const sig = pumpswapWatchMints().join(",");
  if (sig === lastSubSig) return;
  lastSubSig = sig;
  try { await writeSubscription(); } catch { /* retry next tick */ }
}

// ---- connection ------------------------------------------------------------
async function connect(endpoint: string, token?: string) {
  if (state.connected || state.connecting) return;
  state.connecting = true;
  try {
    await refreshSolPrice();
    const { default: Client, CommitmentLevel } = await import("@triton-one/yellowstone-grpc");
    commitmentLevel = CommitmentLevel.CONFIRMED;
    const client = new Client(endpoint, token || undefined, { "grpc.max_receive_message_length": 64 * 1024 * 1024 });
    state.stream = await client.subscribe();
    state.stream.on("data", (u: any) => { try { handleTransaction(u); } catch {} });
    state.stream.on("error", (e: Error) => { console.error("[pulse] stream error:", e.message); teardown(endpoint, token); });
    state.stream.on("end", () => { console.warn("[pulse] stream ended"); teardown(endpoint, token); });
    // Bonding-curve firehose + PumpSwap trades scoped to tokens we already track
    // (post-migration). maybeResubscribe() re-writes this as new tokens migrate.
    await writeSubscription();
    lastSubSig = pumpswapWatchMints().join(",");
    state.connected = true;
    state.connecting = false;
    state.reconnectAttempts = 0;
    console.log(`[pulse] connected to ${endpoint} — one gRPC stream for everyone`);
  } catch (err) {
    console.error("[pulse] connect failed:", (err as Error).message);
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
  setTimeout(() => connect(endpoint, token), delay);
}

// Cheap, targeted migration check: read ONLY the graduating tokens' bonding-curve
// accounts and look at the on-chain `complete` flag. Definitive, and avoids
// subscribing to the whole PumpSwap firehose (which blows the trial rate limit).
// Bonding curve layout: [8 disc][vTok u64][vSol u64][realTok u64][realSol u64]
//                       [supply u64][complete bool @ offset 48].
function bondingCurvePda(mint: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()],
    new PublicKey(PUMP_FUN_PROGRAM)
  )[0];
}

async function checkGraduations() {
  if (state.graduatingTokens.size === 0) return;
  const rpc = process.env.SOLANA_RPC_URL || "http://tyo.corvus-labs.io:8899";
  const conn = new Connection(rpc, "confirmed");
  for (const [mint, token] of [...state.graduatingTokens]) {
    try {
      const info = await conn.getAccountInfo(bondingCurvePda(mint));
      // Account gone (migrated) OR complete flag set → graduated.
      const complete = !info || info.data.length <= 48 || info.data[48] === 1;
      if (complete) {
        state.graduatingTokens.delete(mint);
        token.complete = true;
        token.progress = 100;
        token.destination = "pumpswap";
        state.graduatedTokens.set(mint, token);
        state.stats.graduations++;
        feedEvents.emit("graduated", usd(token));
        if (state.graduatedTokens.size > 100) {
          const oldest = state.graduatedTokens.keys().next().value;
          if (oldest) { state.graduatedTokens.delete(oldest); dropCandles(oldest); }
        }
      }
    } catch { /* ignore, try next tick */ }
  }
}

// ---- on-demand RPC backfill (past coins) -----------------------------------
const backfilling = new Set<string>();
const backfilled = new Set<string>();

function decodeBondingTrade(tx: any, _mint: string): { priceSol: number; solAmount: number } | null {
  try {
    const msg = tx?.transaction?.message;
    if (!msg) return null;
    const keys = (msg.staticAccountKeys || msg.accountKeys || []).map((k: any) => (k.toBase58 ? k.toBase58() : k));
    const all = [...(msg.compiledInstructions || msg.instructions || [])];
    for (const g of tx.meta?.innerInstructions || []) all.push(...(g.instructions || []));
    for (const ix of all) {
      const pid = keys[ix.programIdIndex];
      if (pid !== PUMP_FUN_PROGRAM || !ix.data) continue;
      const data = typeof ix.data === "string" ? bs58.decode(ix.data) : Buffer.from(ix.data);
      const b = Buffer.from(data);
      if (b.length < 16 || b.slice(0, 8).toString("hex") !== SELF_CPI_DISC || b.slice(8, 16).toString("hex") !== TRADE_EVENT_DISC) continue;
      let o = 16 + 32; // skip prefix + mint
      const solLamports = Number(b.readBigUInt64LE(o)); o += 8;
      o += 8 + 1 + 32 + 8; // tokenAmount, isBuy, user, ts
      const vSol = Number(b.readBigUInt64LE(o)); o += 8;
      const vTok = Number(b.readBigUInt64LE(o));
      if (vTok <= 0) return null;
      return { priceSol: (vSol / 1e9) / (vTok / 1e6), solAmount: solLamports / 1e9 };
    }
  } catch { /* skip */ }
  return null;
}

// Reconstruct a past token's chart from historical bonding-curve transactions via
// RPC. Rate-capped (~8 req/s) so it can't starve the live feed or blow the trial
// limit. On-demand + cached: runs once per token, then served from candles.
export async function backfillToken(mint: string): Promise<void> {
  if (backfilling.has(mint) || backfilled.has(mint) || hasCandles(mint)) return;
  backfilling.add(mint);
  try {
    const rpc = process.env.SOLANA_RPC_URL || "http://tyo.corvus-labs.io:8899";
    const conn = new Connection(rpc, "confirmed");
    const sigs = (await conn.getSignaturesForAddress(bondingCurvePda(mint), { limit: 1000 }))
      .slice(0, 200)  // recent 200 txns is plenty for a chart, bounds RPC cost
      .reverse();     // oldest-first so candle eviction keeps the newest
    let n = 0, i = 0;
    for (const s of sigs) {
      try {
        const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
        const t = decodeBondingTrade(tx, mint);
        if (t) { recordCandleAt(mint, t.priceSol, t.solAmount * state.solPrice, (s.blockTime || 0) * 1000); n++; }
      } catch { /* skip tx */ }
      if (++i % 8 === 0) await new Promise((r) => setTimeout(r, 1000)); // ~8 req/s
    }
    backfilled.add(mint);
    console.log(`[pulse] backfilled ${mint.slice(0, 8)} — ${n} trades`);
  } catch (e) {
    console.error("[pulse] backfill failed:", (e as Error).message);
  } finally {
    backfilling.delete(mint);
  }
}

export function isBackfilling(mint: string): boolean {
  return backfilling.has(mint) || backfilled.has(mint);
}

// ---- public API ------------------------------------------------------------
export function startPulseFeed() {
  const endpoint = process.env.GRPC_ENDPOINT;
  if (!endpoint) { console.log("[pulse] GRPC_ENDPOINT not set — feed disabled"); return; }
  // Log our outbound IP so it can be whitelisted with the gRPC provider (Corvus).
  fetch("https://api.ipify.org")
    .then((r) => r.text())
    .then((ip) => console.log(`[pulse] >>> OUTBOUND IP (whitelist this with the gRPC provider): ${ip} <<<`))
    .catch(() => {});
  setInterval(() => { refreshSolPrice().catch(() => {}); }, 30000);
  setInterval(() => { checkGraduations().catch(() => {}); }, 15000);
  // Keep the PumpSwap filter in sync with the set of migrated tokens.
  setInterval(() => { maybeResubscribe().catch(() => {}); }, 3000);
  setInterval(() => {
    const s = state.stats;
    console.log(`[pulse] creates=${s.creates} trades=${s.trades} ps=${s.pumpswap} grads=${s.graduations} new=${state.newTokens.size} grad-ing=${state.graduatingTokens.size} watch=${pumpswapWatchMints().length} conn=${state.connected}`);
  }, 60000);
  connect(endpoint, process.env.GRPC_TOKEN);
}

export function isPulseConnected() { return state.connected; }
export function getSolPrice() { return state.solPrice; }

export function getNewPairs(limit = 50): PulseToken[] {
  return Array.from(state.newTokens.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map(usd);
}
export function getGraduating(limit = 20): PulseToken[] {
  return Array.from(state.graduatingTokens.values()).sort((a, b) => b.marketCapSol - a.marketCapSol).slice(0, limit).map(usd);
}
export function getGraduated(limit = 20): PulseToken[] {
  return Array.from(state.graduatedTokens.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map(usd);
}
export function getToken(mint: string): PulseToken | null {
  const t = state.newTokens.get(mint) || state.graduatingTokens.get(mint) || state.graduatedTokens.get(mint);
  // Retry image resolution on view — covers coins whose metadata blipped at create
  // time. Async fire-and-forget; the page's 1s poll picks up the logo next tick.
  if (t && !t.logoUri && t.uri) resolveImage(mint, t.uri);
  return t ? usd(t) : null;
}

// OHLCV built from OUR gRPC stream. Picks the 1s tier for sub-minute timeframes,
// the 1m tier otherwise, rolls up to `intervalSec`, and converts SOL->USD at read.
export function getCandles(mint: string, intervalSec: number, limit: number) {
  // Someone's viewing this chart — start watching its PumpSwap trades so a
  // migrated coin keeps updating live (picked up on the next resubscribe tick).
  watchMint(mint);
  const useSecond = intervalSec < 60;
  const src = useSecond ? state.candles1s.get(mint) : state.candles1m.get(mint);
  if (!src || src.size === 0) return [];
  const p = state.solPrice || 0;
  const base = Array.from(src.values()).sort((a, b) => a.t - b.t);
  const baseSec = useSecond ? 1 : 60;

  let out: Candle[];
  if (intervalSec <= baseSec) {
    out = base; // no roll-up needed (1s->1s or 1m->1m)
  } else {
    const iv = intervalSec * 1000;
    const buckets = new Map<number, Candle>();
    for (const c of base) {
      const b = Math.floor(c.t / iv) * iv;
      const agg = buckets.get(b);
      if (!agg) buckets.set(b, { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
      else { if (c.h > agg.h) agg.h = c.h; if (c.l < agg.l) agg.l = c.l; agg.c = c.c; agg.v += c.v; }
    }
    out = Array.from(buckets.values()).sort((a, b) => a.t - b.t);
  }
  // Real trade candles only — NO gap-fill. Enforce continuity: each candle opens
  // where the previous closed (extend the wick to cover it) so bars connect with
  // no price gaps between them, like a proper continuous-price chart. This is not
  // fake filler — every candle is a real trade; we just fix the open so a bar
  // starts where the last one ended instead of after its own first trade.
  const win = out.slice(-limit);
  for (let i = 1; i < win.length; i++) {
    const prevClose = win[i - 1].c;
    const c = win[i];
    win[i] = { ...c, o: prevClose, h: Math.max(c.h, prevClose), l: Math.min(c.l, prevClose) };
  }
  return win.map((c) => ({
    timestamp: c.t,
    open: c.o * p,
    high: c.h * p,
    low: c.l * p,
    close: c.c * p,
    volume: c.v * p,
  }));
}

export function hasCandles(mint: string): boolean {
  const s = state.candles1s.get(mint);
  const m = state.candles1m.get(mint);
  return (!!s && s.size > 0) || (!!m && m.size > 0);
}
export function getSnapshot() {
  return { newPairs: getNewPairs(60), graduating: getGraduating(30), graduated: getGraduated(30), solPrice: state.solPrice };
}
