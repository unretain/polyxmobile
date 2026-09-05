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
import { createHash } from "crypto";
// Dual-write persistence: this single decoder feeds ClickHouse too (no 2nd gRPC).
import { recordToken, recordTrade, recordGraduation, chDateTime } from "../clickhouse/writer";
import { getGraduatingPairs as chGraduatingPairs, getGraduatedPairs as chGraduatedPairs, getNewPairs as chNewPairs, getTokensMissingImages, getTokensMissingSocials, getSocialsForMints } from "../clickhouse/queries";
import { clickhouseEnabled } from "../clickhouse/client";
import { memo } from "../lib/memo";
import { proxyImg } from "../lib/imgurl";
import { prefetch } from "./imagecache";
import { fetchMetadata } from "./ipfs";

const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
// PumpSwap (pump.fun's AMM) — where tokens trade AFTER graduation. Verified live.
const PUMPSWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const WSOL = "So11111111111111111111111111111111111111112";
const SELF_CPI_DISC = "e445a52e51cb9a1d";
const CREATE_EVENT_DISC = "1b72a94ddeeb6376";
const TRADE_EVENT_DISC = "bddb7fd34ee661ee";
const COMPLETE_EVENT_DISC = "5f72619cd42e9808";

// Precomputed program-id bytes + a byte comparator so the HOT decode path compares
// pubkeys by raw bytes instead of base58-encoding every instruction key per tx.
// base58 (via new PublicKey().toBase58()) was the throughput bottleneck — this is
// what lets one thread keep up at high volume.
const PUMP_FUN_PROGRAM_BYTES = bs58.decode(PUMP_FUN_PROGRAM);
const PUMPSWAP_PROGRAM_BYTES = bs58.decode(PUMPSWAP_PROGRAM);
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const TOTAL_SUPPLY = 1_000_000_000;
const INITIAL_REAL_TOKEN_RAW = 793_100_000 * 1e6;
const MIGRATION_MC_SOL = 410.9;
const INITIAL_MC_SOL = 28;
// Final stretch = % of the CURVE'S TOKENS SOLD (1 - real_token_reserves / initial),
// not a share of the graduation market cap. 40% means "40% of the curve is gone".
// Was 80%, which only caught coins in the last moments before migration.
const FINAL_STRETCH_PROGRESS = Number(process.env.PULSE_FINAL_STRETCH_PCT || 40);
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
  buys?: number;
  sells?: number;
  // Fees ACTUALLY paid on this coin (protocol + creator), summed from the trade
  // events. Without it, memory-served rows had no value for the filter to test and
  // a min-fees bound let every one of them through — a coin with no fees showed up
  // under "min 0.5 SOL".
  feesPaidSol?: number;
  createdAt: number;
  source: string;
  complete: boolean;
  progress: number;
  destination?: string;
  graduatedAt?: number; // when it migrated (for recency filtering of the migrated list)
  graduatingSince?: number; // when it entered final stretch — used to prune stalled coins
  lastTradeAt?: number; // last time we saw a trade — prunes dead coins from final stretch
  // socials, pulled from the token metadata JSON alongside the image
  twitter?: string;
  telegram?: string;
  website?: string;
  // internal
  priceSol?: number;
  launchPriceSol?: number;
  uri?: string;
  peakMcapUsd?: number; // highest market cap seen — used to retain "notable" coins
}

export const feedEvents = new EventEmitter();

// OHLCV candles in SOL (converted to USD at read). Built from OUR gRPC stream.
// Two tiers so we get true 1-SECOND candles for the live view AND longer history:
//   - 1s candles: a new bar every second there's a trade (short window)
//   - 1m candles: 12h window; 5m/15m/1h/... roll up from here
interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
// Sub-minute candles are 250ms (4/sec) so a coin's trades spread into distinct
// thin candles like Axiom, instead of merging into chunky 1s blocks. Block time
// is only 1s-precise, so this fine tier is bucketed by RECEIVE time (the stream
// is smooth end-to-end, verified, so this no longer mangles wicks).
const FINE_MS = 250;
const MIN_MS = 60_000;
const MAX_1S = 1_200; // ~5 min of 250ms candles (matches the chart window; keeps
                      // per-coin candle memory bounded so GC doesn't stall the loop)
const MAX_1M = 720;   // 12h of 1-minute candles

// New-pairs retention. We keep MAX_NEW_TOKENS coins; when full we evict the OLDEST
// coin that never became "notable" (never crossed NOTABLE_MCAP_USD), so a coin that
// actually pumped stays tracked long after it cools off instead of getting dropped
// by age the moment a fresh coin appears. Only if every coin is notable do we drop
// the absolute oldest.
const MAX_NEW_TOKENS = 400;
const NOTABLE_MCAP_USD = 10_000;
// Cap the "final stretch" set. Coins enter it at final-stretch progress but many
// then dump and never graduate, so without a cap it grows unbounded — which made
// checkGraduations poll hundreds of RPC accounts per tick and stall. Evict oldest.
const MAX_GRADUATING = 150;
// How long a migrated coin stays in the list. Filters are the way to narrow it now,
// not a fixed window that silently drops coins mid-session.
const MIGRATED_HOURS = Number(process.env.PULSE_MIGRATED_HOURS || 24);
// How long after migrating we keep a coin in the PumpSwap subscription. This is the
// window where its trading is heaviest; MAX_SUB_MINTS still caps the total.
// Every coin still shown in the migrated column stays subscribed. Anything narrower
// leaves those coins frozen at their last bonding-curve trade: GOAF sat at $33.81K
// market cap and $0 liquidity for hours while it actually traded at $14M on the AMM.
const MIGRATED_WATCH_MINUTES = Number(process.env.PULSE_MIGRATED_WATCH_MINUTES || 360);

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
// Newest trade timestamp per mint (ms). Tells the gap-backfill where our data ends
// so it only fetches the trades we missed while the coin wasn't subscribed.
const lastTradeAt = new Map<string, number>();

// DIAGNOSTIC: rolling samples of (now - on-chain block time) for processed trades,
// i.e. how far behind chain THIS feed actually is. Median logged in the stats line.
const feedLagSamples: number[] = [];
function sampleFeedLag(tsSec: number) {
  if (tsSec > 1_600_000_000) {
    feedLagSamples.push(Date.now() / 1000 - tsSec);
    if (feedLagSamples.length > 800) feedLagSamples.shift();
  }
}
function medianFeedLag(): number {
  if (!feedLagSamples.length) return -1;
  const a = [...feedLagSamples].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

// Record a trade into BOTH the 1s and 1m candle series (price in SOL).
function recordCandle(mint: string, priceSol: number, solAmount: number) {
  if (priceSol <= 0) return;
  lastPrice.set(mint, priceSol);
  lastTradeAt.set(mint, Date.now());
  let s = state.candles1s.get(mint);
  if (!s) { s = new Map(); state.candles1s.set(mint, s); }
  let m = state.candles1m.get(mint);
  if (!m) { m = new Map(); state.candles1m.set(mint, m); }
  const now = Date.now();
  upsertCandle(s, Math.floor(now / FINE_MS) * FINE_MS, priceSol, solAmount, MAX_1S);
  upsertCandle(m, Math.floor(now / MIN_MS) * MIN_MS, priceSol, solAmount, MAX_1M);
}

function dropCandles(mint: string) {
  state.candles1s.delete(mint);
  state.candles1m.delete(mint);
}

// Record a trade at an EXPLICIT timestamp (used by backfill for historical trades).
function recordCandleAt(mint: string, priceSol: number, solAmount: number, tsMs: number) {
  if (priceSol <= 0) return;
  if (tsMs > (lastTradeAt.get(mint) || 0)) lastTradeAt.set(mint, tsMs);
  let s = state.candles1s.get(mint);
  if (!s) { s = new Map(); state.candles1s.set(mint, s); }
  let m = state.candles1m.get(mint);
  if (!m) { m = new Map(); state.candles1m.set(mint, m); }
  upsertCandle(s, Math.floor(tsMs / FINE_MS) * FINE_MS, priceSol, solAmount, MAX_1S);
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

const NO_IMAGE = "\x00none"; // sentinel: metadata fetched OK but has no image (stop retrying)

// Superseded by the hedged multi-gateway fetch in ./ipfs. That used to rewrite every
// CID onto dweb.link because a datacenter box couldn't reach ipfs.io — which made ONE
// gateway a single point of failure for every logo and social link on the site.
// hedgedFetch tries gateways in order and falls through on slowness, so an unreachable
// or throttling gateway costs a second instead of the whole metadata pipeline.

export type Socials = { twitter?: string; telegram?: string; website?: string };

/** Socials keyed by metadata uri, so a cache HIT can restore them like the image.
 *  Without this, the FIRST resolve of a uri set the socials and every later attach
 *  set only the logo — leaving the coin with a Twitter in ClickHouse and none in
 *  memory. Memory is what /api/feed/token and the live lists serve, so the bird
 *  vanished for exactly the coins that were still on screen. */
const socialsCache = new Map<string, Socials>();

/** The in-memory token, whichever list it currently lives in. */
export function anyToken(mint: string): PulseToken | undefined {
  return state.newTokens.get(mint) || state.graduatingTokens.get(mint) || state.graduatedTokens.get(mint);
}

/** Fill in blanks only — never overwrite a link we already have. */
function applySocials(t: PulseToken, s: Socials | undefined) {
  if (!s) return;
  if (!t.twitter && s.twitter) t.twitter = s.twitter;
  if (!t.telegram && s.telegram) t.telegram = s.telegram;
  if (!t.website && s.website) t.website = s.website;
}

/** Socials out of a metadata JSON (top level or under `extensions`). */
export function readSocials(j: any): Socials {
  const ext = j?.extensions || {};
  const pick = (a: unknown, b: unknown) =>
    (typeof a === "string" && a ? a : typeof b === "string" && b ? b : undefined);
  return {
    twitter: pick(j?.twitter, ext.twitter) || pick(j?.twitter_url, ext.twitter_url),
    telegram: pick(j?.telegram, ext.telegram),
    website: pick(j?.website, ext.website),
  };
}

async function resolveImage(mint: string, uri: string) {
  if (!uri) return;
  const attach = (img: string) => {
    const t = anyToken(mint);
    if (!t) return;
    if (img && !t.logoUri) t.logoUri = img;
    // Socials ride along on EVERY attach, not just the cold fetch.
    applySocials(t, socialsCache.get(uri));
  };
  const cached = state.imageCache.get(uri);
  if (cached === "") return;                        // in-flight — don't duplicate the fetch
  // Metadata fetched fine but carries no image. It can still carry a Twitter, so
  // attach what we know instead of returning empty-handed.
  if (cached === NO_IMAGE) { attach(""); return; }
  if (cached) { attach(cached); return; }           // already resolved — (re)attach
  state.imageCache.set(uri, "");                     // mark in-flight
  try {
    const j = await fetchMetadata(uri);
    if (!j) throw new Error("metadata unavailable");
    const img = typeof j?.image === "string" ? j.image : "";
    // Socials live in the same metadata JSON. Cache them by uri BEFORE the early
    // return below, so a coin whose metadata has no image still gets its links.
    const socials = readSocials(j);
    socialsCache.set(uri, socials);
    const t = anyToken(mint);
    if (t) applySocials(t, socials);
    // Successful fetch but the metadata genuinely has no image -> cache a sentinel
    // so we STOP retrying it. A network/fetch error (catch) DELETES the marker so
    // the list-getter retry re-attempts it (transient blips like slow IPFS recover).
    if (!img) { state.imageCache.set(uri, NO_IMAGE); return; }
    state.imageCache.set(uri, img);
    attach(img);
    // Pull the bytes to our own disk NOW, while the coin is seconds old. By the
    // time it reaches a user's screen /img serves it from local NVMe instead of
    // paying an IPFS gateway round trip in front of the user.
    prefetch(img);
    // Persist the resolved logo to ClickHouse so CH-served lists (new-pairs,
    // graduated) show it too — not just the in-memory (final-stretch) list. The
    // tokens table is a ReplacingMergeTree, so re-inserting the same mint with the
    // image replaces the empty-image row on read.
    if (t) recordToken({
      mint, name: t.name, symbol: t.symbol, uri, image: img, creator: "",
      // Socials ride along on the same write — otherwise the CH-served lists (which
      // is most rows) would never learn a coin has a Twitter, even though we just
      // read it out of the metadata two lines above.
      twitter: t.twitter || "", telegram: t.telegram || "", website: t.website || "",
      created_at: chDateTime(t.createdAt), created_slot: 0,
    });
  } catch {
    state.imageCache.delete(uri);
  }
}

// Re-route logos through our own /img proxy so browsers don't block the IPFS gateways
// cross-origin (see the proxy route in index.ts). Applied at output time only.
const PUBLIC_API_URL = process.env.PUBLIC_API_URL || "https://api.polyx.trade";
// proxyImg is shared with the ClickHouse query layer — see ../lib/imgurl.


function usd(token: PulseToken): PulseToken {
  const p = state.solPrice;
  return {
    ...token,
    marketCap: token.marketCapSol * p,
    price: (token.priceSol || 0) * p,
    migrationMc: MIGRATION_MC_SOL * p,
    logoUri: proxyImg(token.logoUri),
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
    buys: 0,
    sells: 0,
    feesPaidSol: 0,
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
  // Real slot, not 0. Every trade row was landing with slot=0, which threw away the
  // only on-chain ordering signal we had inside a second.
  const slot = Number(update.transaction?.slot ?? 0) || 0;
  // FULL account list, in runtime order: static keys, then the addresses resolved
  // from Address Lookup Tables (writable, then readonly). PumpSwap swaps put the
  // program + pool accounts in an ALT, so a static-only key list makes us miss every
  // migrated-coin trade — the tx is delivered by the mint filter but our own router
  // (and any programIdIndex lookup) can't see the PumpSwap program. This is why
  // charts froze the instant a coin migrated.
  const keys: Uint8Array[] = [
    ...(tx.transaction?.message?.accountKeys || []),
    ...(tx.meta?.loadedWritableAddresses || []),
    ...(tx.meta?.loadedReadonlyAddresses || []),
  ];
  const signature = tx.signature ? bs58.encode(Buffer.from(tx.signature)) : "";
  const outer = tx.transaction?.message?.instructions || [];
  const inner: any[] = [];
  for (const g of tx.meta.innerInstructions || []) for (const ix of g.instructions || []) inner.push(ix);

  for (const ix of [...outer, ...inner]) {
    const progIdx = ix.programIdIndex;
    if (progIdx === undefined || !ix.data) continue;
    const pk = keys[progIdx];
    if (!pk || !bytesEqual(pk, PUMP_FUN_PROGRAM_BYTES)) continue;
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
        recordToken({ mint, name: name.trim(), symbol: symbol.trim(), uri: uri.trim(), image: "", creator: "", created_at: chDateTime(Date.now()), created_slot: 0 });
        if (uri.trim()) resolveImage(mint, uri.trim());
        if (state.newTokens.size > MAX_NEW_TOKENS) {
          // Evict the oldest coin that never got notable; keep the pumpers around.
          let victim: string | undefined;
          for (const [m, t] of state.newTokens) {
            if ((t.peakMcapUsd || 0) < NOTABLE_MCAP_USD) { victim = m; break; }
          }
          if (!victim) victim = state.newTokens.keys().next().value;
          if (victim) { state.newTokens.delete(victim); dropCandles(victim); }
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
        sampleFeedLag(tsSec);
        const vSol = Number(data.readBigUInt64LE(o)); o += 8;
        const vTok = Number(data.readBigUInt64LE(o)); o += 8;
        const realSol = Number(data.readBigUInt64LE(o)); o += 8; // real sol reserves
        const realTok = Number(data.readBigUInt64LE(o)); o += 8;
        // ACTUAL fees, straight off the event. Fees are NOT a fixed cut of volume:
        // pump.fun picks protocol bps from an on-chain market-cap tier table and adds a
        // separate creator fee, and some routes pay literally ZERO (verified live: one
        // trade came through with fee_bps=95/fee=1876032, the next with fee=0 on real
        // volume). Deriving fees from volume would invent fees those trades never paid.
        //   fee_recipient: Pubkey(32) | fee_bps: u64 | fee: u64
        //   creator: Pubkey(32)       | creator_fee_bps: u64 | creator_fee: u64
        let feeSol = 0, creatorFeeSol = 0;
        if (data.length >= o + 96) {
          o += 32;                                                  // fee_recipient
          o += 8;                                                   // fee_basis_points
          feeSol = Number(data.readBigUInt64LE(o)) / 1e9; o += 8;    // fee (lamports)
          o += 32;                                                  // creator
          o += 8;                                                   // creator_fee_basis_points
          creatorFeeSol = Number(data.readBigUInt64LE(o)) / 1e9; o += 8;
        }
        if (vTok <= 0) continue;
        // Include graduatedTokens: a coin can get a (sometimes premature) complete
        // event yet keep trading on the bonding curve. Without this lookup its price
        // froze the moment it was marked complete (the "nukes/stops working" bug).
        const token = state.newTokens.get(mint) || state.graduatingTokens.get(mint) || state.graduatedTokens.get(mint);
        const priceSol = (vSol / 1e9) / (vTok / 1e6);
        if (!token) {
          // NOT tracked in memory — evicted by the MAX_NEW_TOKENS cap (~15 min of
          // coins at current launch rate), or created before this process started.
          // We still RECEIVED the trade, so throwing it away was manufacturing holes
          // in the chart out of data we already had. The in-memory state needs a
          // token object; ClickHouse does not. Persist it and move on.
          if (priceSol > 0) {
            recordTrade({
              mint, signature, slot,
              ts: chDateTime(tsSec > 0 ? tsSec * 1000 : Date.now()),
              is_buy: isBuy ? 1 : 0,
              sol_amount: solLamports / 1e9,
              token_amount: tokenRaw / 1e6,
              price_sol: priceSol,
              mcap_sol: priceSol * TOTAL_SUPPLY,
              real_token_reserves: realTok,
              real_sol: realSol / 1e9,
              fee_sol: feeSol,
              creator_fee_sol: creatorFeeSol,
              trader,
            });
            state.stats.trades++;
          }
          continue;
        }
        token.priceSol = priceSol;
        token.marketCapSol = priceSol * TOTAL_SUPPLY;
        const mcapUsd = token.marketCapSol * state.solPrice;
        if (mcapUsd > (token.peakMcapUsd || 0)) token.peakMcapUsd = mcapUsd; // mark notable coins for retention
        // Liquidity = real SOL locked in the curve, valued both sides (DexScreener convention).
        token.liquidity = (realSol / 1e9) * state.solPrice * 2;
        token.progress = Math.max(0, Math.min(100, (1 - realTok / INITIAL_REAL_TOKEN_RAW) * 100));
        token.lastTradeAt = Date.now();
        if (!token.launchPriceSol) token.launchPriceSol = priceSol;
        token.priceChange24h = token.launchPriceSol > 0 ? ((priceSol - token.launchPriceSol) / token.launchPriceSol) * 100 : 0;
        token.volume24h += (solLamports / 1e9) * state.solPrice;
        token.txCount++;
        if (isBuy) token.buys = (token.buys || 0) + 1; else token.sells = (token.sells || 0) + 1;
        // CREATOR fee only. The event carries a protocol fee (0.95% of volume) and a
        // creator fee (0.30%) — summing both reported a coin at ~1.25% of its volume,
        // roughly 3.4x what the trackers show for the same coin. Measured across every
        // active coin the creator share is exactly 0.30%, and it is the one that
        // matches: Vortex read 0.2921 here against 0.36 quoted, the gap being the
        // trades between the two readings.
        token.feesPaidSol = (token.feesPaidSol || 0) + creatorFeeSol;
        // Record at RECEIVE time so the 250ms fine candles get real sub-second
        // resolution (block time is only 1s-precise). The stream is smooth end-to-end
        // (verified), so this no longer piles a burst into one wrong bucket.
        recordCandle(mint, priceSol, solLamports / 1e9);
        recordTrade({ mint, signature, slot, ts: chDateTime(tsSec > 0 ? tsSec * 1000 : Date.now()), is_buy: isBuy ? 1 : 0, sol_amount: solLamports / 1e9, token_amount: tokenRaw / 1e6, price_sol: priceSol, mcap_sol: token.marketCapSol, real_token_reserves: realTok, real_sol: realSol / 1e9, fee_sol: feeSol, creator_fee_sol: creatorFeeSol, trader });
        // Per-trade event for the token page's live "recent trades" panel — built +
        // broadcast ONLY when someone actually has this coin's chart open (see hasViewer).
        // Every trade goes out; the client batches them per animation frame so the
        // firehose never blocks its main thread (that's what dropped the socket).
        if (hasViewer(mint)) {
          feedEvents.emit("trade", {
            mint, type: isBuy ? "buy" : "sell", tokenAmount: tokenRaw / 1e6,
            solAmount: solLamports / 1e9, marketCapSol: token.marketCapSol,
            marketCap: token.marketCapSol * state.solPrice,
            priceUsd: priceSol * state.solPrice, solPrice: state.solPrice,
            volume24h: token.volume24h, liquidity: token.liquidity,
            trader, signature,
            timestamp: (tsSec > 0 ? tsSec : Math.floor(Date.now() / 1000)) * 1000,
          });
        }
        state.stats.trades++;
        if (token.progress >= FINAL_STRETCH_PROGRESS && state.newTokens.has(mint)) {
          state.newTokens.delete(mint);
          token.graduatingSince = Date.now();
          state.graduatingTokens.set(mint, token);
          if (state.graduatingTokens.size > MAX_GRADUATING) {
            // Drop the oldest graduating coin (hit final stretch long ago, never
            // graduated — dumped/stalled) so checkGraduations' RPC load stays bounded.
            const oldest = state.graduatingTokens.keys().next().value;
            if (oldest && oldest !== mint) state.graduatingTokens.delete(oldest);
          }
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
    token.graduatedAt = Date.now();
        state.graduatedTokens.set(mint, token);
        recordGraduation({ mint, ts: chDateTime(Date.now()) });
        if (state.graduatedTokens.size > GRADUATED_MAX) {
          const oldest = state.graduatedTokens.keys().next().value;
          if (oldest) { state.graduatedTokens.delete(oldest); dropCandles(oldest); }
        }
        state.stats.graduations++;
        feedEvents.emit("graduated", usd(token));
      }
    } catch { /* skip malformed */ }
  }

  // PumpSwap (post-graduation AMM). A token we track trading here = it MIGRATED.
  if (keys.some((k) => bytesEqual(k, PUMPSWAP_PROGRAM_BYTES))) handlePumpSwap(tx, signature, keys, slot);
}

// Price from pool reserves (uiAmount handles decimals) — IDL-independent, robust
// to pump changing their event layout. quote=WSOL(9), base=token.
function handlePumpSwap(tx: any, signature = "", keys: Uint8Array[] = [], slot = 0) {
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

  /**
   * PumpSwap fees, read off the SOL that actually moved — not a rate we assumed.
   *
   * This handler decodes balance deltas rather than the program's event, so there was
   * no fee field and every AMM trade stored fee_sol = 0. Over 6h that summed to exactly
   * zero across every migrated coin — tens of thousands of trades, thousands of SOL of
   * volume — which left a graduated coin's headline "fees paid" being nothing but the
   * one bundle buy that completed its bonding curve. That is how a coin with no real
   * trading since migration cleared a 0.5 SOL fee filter.
   *
   * Both parties to a swap touch the COIN: the pool holds it, the trader receives or
   * sends it. Fee recipients only ever touch WSOL. So the fee is every WSOL gain whose
   * owner has no token account for this mint in the transaction.
   *
   * Verified against a live swap: 0.00952 + 0.000317 + 0.000317 = 0.010154 SOL against
   * a 1.2718 SOL pool leg (~0.8%), matching the 20/5/75 bps the fee program returns.
   * Taking "all gains but the largest" instead reported 12-14% of volume, because a
   * trader who wraps SOL owns a WSOL account too and their wrap dwarfs the pool leg.
   */
  const coinOwners = new Set<string>();
  for (const b of post) if (b.mint === mint && b.owner) coinOwners.add(b.owner);
  for (const b of (tx.meta.preTokenBalances || [])) if (b.mint === mint && b.owner) coinOwners.add(b.owner);
  let feeSol = 0;
  for (const b of post) {
    if (b.mint !== WSOL || !b.owner || coinOwners.has(b.owner)) continue;
    const pb = preByIdx.get(b.accountIndex);
    const d = Number(b.uiTokenAmount?.uiAmount || 0) - Number(pb?.uiTokenAmount?.uiAmount || 0);
    if (d > 0) feeSol += d;
  }
  // A fee is a fraction of the trade. Anything near the trade size is a misread of a
  // routing hop, and storing it would poison the column all over again.
  if (!(feeSol > 0) || feeSol > volSol * 0.05) feeSol = 0;

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
      // Fees restart at migration. What a coin charged on its bonding curve is not
      // what it charges on the AMM, and carrying it over means one curve-completing
      // bundle buy (~1.06 SOL, and it recurs verbatim across coins) sits in the
      // headline forever on a coin that has traded almost nothing since.
      token.feesPaidSol = 0;
    token.graduatedAt = Date.now();
      state.graduatedTokens.set(mint, token);
      feedEvents.emit("graduated", usd(token));
    }
    token.priceSol = priceSol;
    token.marketCapSol = priceSol * TOTAL_SUPPLY;
    if (!token.launchPriceSol) token.launchPriceSol = priceSol;
    token.priceChange24h = token.launchPriceSol > 0 ? ((priceSol - token.launchPriceSol) / token.launchPriceSol) * 100 : 0;
    token.volume24h += volSol * state.solPrice;
    token.feesPaidSol = (token.feesPaidSol || 0) + feeSol;
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
  const isBuy = poolPost < poolPre;
  const trader = keys[0] ? b58(Buffer.from(keys[0])) : "";
  // Persist post-migration trades too, so ClickHouse holds a graduated coin's full
  // history (not just its bonding-curve life) and the chart's durable fallback works
  // after migration. real_token_reserves isn't tracked on PumpSwap (pool AMM) -> 0.
  recordTrade({
    mint, signature, slot, ts: chDateTime(Date.now()), is_buy: isBuy ? 1 : 0,
    sol_amount: volSol, token_amount: absTok, price_sol: priceSol,
    mcap_sol: priceSol * TOTAL_SUPPLY, real_token_reserves: 0, trader,
    fee_sol: feeSol,
  });
  if (hasViewer(mint)) {
    feedEvents.emit("trade", {
      mint, type: isBuy ? "buy" : "sell", tokenAmount: absTok,
      solAmount: volSol, marketCapSol: priceSol * TOTAL_SUPPLY,
      marketCap: priceSol * TOTAL_SUPPLY * state.solPrice,
      priceUsd: priceSol * state.solPrice, solPrice: state.solPrice,
      volume24h: token?.volume24h ?? 0, liquidity: token?.liquidity ?? 0,
      trader, signature, timestamp: Date.now(),
    });
  }
  state.stats.pumpswap++;
}

// ---- gRPC subscription (bonding-curve firehose + scoped PumpSwap) ----------
// CommitmentLevel loads lazily with the client; stash it so we can re-write the
// subscription when the set of migrated tokens changes.
let commitmentLevel: any = null;
let lastSubSig = "";
// Keep tracking this many most-recent migrated coins CONTINUOUSLY (hours of
// retention at real graduation rates), so a chart doesn't freeze after migration.
// Bounded, not infinite, on purpose: subscribing to ALL PumpSwap trades (every
// migrated coin ever) is the firehose that overloaded the single decoder and lagged
// new pairs by minutes. A few hundred recent, mostly-quiet mints is cheap; the whole
// program is not. The gap-backfill only covers coins older than this window.
const GRADUATED_MAX = 120;
// Was a hard 180 to stay inside the trial provider's ~50 TPS ceiling. On our own
// node the provider ceiling is gone (the geyser filter limits are ours to set), so
// this is env-tunable — but raise it deliberately: the remaining constraint is the
// single Node decoder in this process, not the node. See the note in pumpswapWatchMints.
// 180 was sized for the rented trial node (~50 TPS) whose geyser capped a filter at
// 10 accounts. We own the node now and set its filter limits ourselves (1000), so the
// only real constraint is this process keeping up — watch feedLag after changing it.
const MAX_SUB_MINTS = Number(process.env.PULSE_MAX_SUB_MINTS || 500);

// Mints trading on PumpSwap (post-migration). We watch ONLY these, never the full
// PumpSwap firehose — that's what blows the rate limit. Scoped like this it's tiny.
//
// Priority matters: `watched` (a user is looking at the chart) and `graduating`
// (about to migrate) are EXPLICIT intent and must never be evicted by capacity —
// otherwise an open chart silently stops updating. We keep all of those, then fill
// the remaining slots with the MOST-RECENT graduated coins. (The old version built
// one graduated-first Set and sliced the tail, which dropped viewed/just-migrated
// coins once the union passed the cap — that was the "stops tracking after
// migration" bug.)
function pumpswapWatchMints(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (m: string) => { if (!seen.has(m)) { seen.add(m); out.push(m); } };
  // ONLY coins someone is actively viewing + coins about to migrate. On the trial gRPC
  // (~50 TPS) the pump.fun firehose plus a WIDE PumpSwap subscription leaves no headroom,
  // so one high-volume coin tips the whole stream over and the relay RST_STREAMs it —
  // wiping EVERY coin for that window. Keeping PumpSwap scoped to just viewed+graduating
  // keeps baseline load low so a spike doesn't kill the stream. A migrated coin is added
  // live the instant someone opens it (watchMint -> immediate resubscribe).
  for (const m of state.watched) add(m);              // explicit view — always keep
  for (const m of state.graduatingTokens.keys()) add(m); // about to migrate — always keep
  // Coins that JUST migrated. Their trading moves to PumpSwap the moment they
  // graduate, and without this we saw almost none of it — one coin had 100+ on-chain
  // transactions in two minutes while we captured 2. That is why migrated coins showed
  // near-zero fees, volume and txns: we were only watching coins someone had open.
  // Newest-first and capped, so this stays bounded no matter how many migrate.
  const recent = Array.from(state.graduatedTokens.values())
    .filter((t) => (t.graduatedAt ?? 0) > Date.now() - MIGRATED_WATCH_MINUTES * 60_000)
    .sort((a, b) => (b.graduatedAt ?? 0) - (a.graduatedAt ?? 0));
  for (const t of recent) add(t.address);
  return out.slice(0, MAX_SUB_MINTS);
}

// Explicitly watch a mint's PumpSwap trades on-demand (e.g. a user opened an
// already-migrated coin we didn't see graduate). Picked up by maybeResubscribe().
const MAX_WATCHED = Number(process.env.PULSE_MAX_WATCHED || 120);
export function watchMint(mint: string) {
  const isNew = !state.watched.has(mint);
  // Refresh recency (delete + re-add moves it to the end) so a chart that's polling
  // getCandles every second stays newest and is never evicted while it's open.
  state.watched.delete(mint);
  state.watched.add(mint);
  if (state.watched.size > MAX_WATCHED) {
    const oldest = state.watched.values().next().value;
    if (oldest) state.watched.delete(oldest);
  }
  // A brand-new watched mint isn't in the live gRPC subscription yet — rewrite it NOW
  // instead of waiting up to 3s for the next resubscribe tick. That tick delay (plus
  // propagation) is why opening an already-migrated coin took ~10s to start charting;
  // new pairs are instant only because the whole pump.fun program is always subscribed.
  if (isNew) maybeResubscribe().catch(() => {});
}

// Mints with a live chart open right now — maintained by the websocket layer via
// subscribe:token / unsubscribe:token (ref-counted so multiple viewers of the same
// coin count correctly). The decoder builds + broadcasts a per-trade event ONLY for
// these. Under a volume storm it was doing that allocation + socket.io broadcast for
// ALL ~400+ tracked coins on every single trade — almost all with nobody watching —
// which is what pushed the single decode thread behind (feedLag). Candle building and
// ClickHouse persistence still run for every coin, so history is never lost.
const viewerCounts = new Map<string, number>();
export function addViewer(mint: string) {
  viewerCounts.set(mint, (viewerCounts.get(mint) || 0) + 1);
}
export function removeViewer(mint: string) {
  const n = (viewerCounts.get(mint) || 0) - 1;
  if (n <= 0) viewerCounts.delete(mint);
  else viewerCounts.set(mint, n);
}
export function hasViewer(mint: string): boolean {
  return viewerCounts.has(mint);
}

function buildSubscribeRequest() {
  const transactions: any = {
    // Bonding-curve activity: creates / trades / graduations.
    pump: { vote: false, failed: false, accountInclude: [PUMP_FUN_PROGRAM], accountExclude: [], accountRequired: [] },
  };
  const mints = pumpswapWatchMints();
  if (mints.length > 0) {
    // Post-migration trades for tokens we track/view. Per-mint (NOT the whole
    // PumpSwap program) — subscribing to the entire AMM firehose overloads the
    // single decoder and backs up the pump.fun (new-pairs) stream.
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

// When a token is watched/migrates, re-write the subscription so its PumpSwap trades
// start streaming. Only re-writes when the watched-mint set actually changes.
async function maybeResubscribe() {
  if (!state.connected || !state.stream) return;
  // Sort so a pure reordering (same membership) doesn't churn the subscription;
  // we only re-write when the SET of watched mints actually changes.
  const sig = [...pumpswapWatchMints()].sort().join(",");
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
    // PROCESSED for lowest latency. The stream itself is real-time (verified 0-lag
    // through the relay); keeping the API able to keep up is about NOT choking the
    // event loop — see the bounded candle memory (MAX_1S) and cheap decode hot path.
    commitmentLevel = CommitmentLevel.PROCESSED;
    const client = new Client(endpoint, token || undefined, { "grpc.max_receive_message_length": 64 * 1024 * 1024 });
    state.stream = await client.subscribe();
    state.stream.on("data", (u: any) => { try { handleTransaction(u); } catch {} });
    state.stream.on("error", (e: Error) => { console.error("[pulse] stream error:", e.message); teardown(endpoint, token); });
    state.stream.on("end", () => { console.warn("[pulse] stream ended"); teardown(endpoint, token); });
    // Bonding-curve firehose + PumpSwap trades scoped to tokens we already track
    // (post-migration). maybeResubscribe() re-writes this as new tokens migrate.
    await writeSubscription();
    lastSubSig = [...pumpswapWatchMints()].sort().join(",");
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

let checkingGrads = false;
async function checkGraduations() {
  // Guard: never let two passes overlap — with a large graduating set the RPC calls
  // pile up faster than 15s and the passes stack, hammering the RPC until detection
  // stalls entirely (that's what made the migrated list go empty).
  if (checkingGrads || state.graduatingTokens.size === 0) return;
  checkingGrads = true;
  try {
    // Prune stalled coins FIRST. A coin stuck in "final stretch" for over 40 min without
    // graduating has dumped or died — there's otherwise no exit from graduatingTokens
    // except graduating, so the list rotted with hours-old corpses. Evicting them keeps
    // the list fresh and shrinks the RPC check below.
    const nowMs = Date.now();
    const MAX_FINAL_STRETCH_MS = 90 * 60 * 1000; // 1h30m hard cap
    const INACTIVE_MS = 20 * 60 * 1000; // no trade in 20m => dead, drop it
    for (const [m, t] of state.graduatingTokens) {
      if (t.graduatingSince == null) t.graduatingSince = nowMs; // backfill pre-restart
      const tooOld = nowMs - t.graduatingSince > MAX_FINAL_STRETCH_MS;
      const dead = nowMs - (t.lastTradeAt ?? t.graduatingSince) > INACTIVE_MS;
      if (tooOld || dead) {
        state.graduatingTokens.delete(m);
        dropCandles(m);
      }
    }
    if (state.graduatingTokens.size === 0) return;
    const rpc = process.env.SOLANA_RPC_URL || "http://tyo.corvus-labs.io:8899";
    const conn = new Connection(rpc, "confirmed");
    const entries = [...state.graduatingTokens];
    const CONC = 12; // bounded concurrency instead of one-at-a-time
    for (let i = 0; i < entries.length; i += CONC) {
      await Promise.all(entries.slice(i, i + CONC).map(async ([mint, token]) => {
        try {
          // Per-call timeout: a single hung RPC call must NOT hang the whole pass
          // (that would leave checkingGrads=true forever and kill graduation detection).
          const info = await Promise.race([
            conn.getAccountInfo(bondingCurvePda(mint)),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("rpc-timeout")), 8000)),
          ]);
          // Account gone (migrated) OR complete flag set → graduated.
          const complete = !info || info.data.length <= 48 || info.data[48] === 1;
          if (!complete) return;
          state.graduatingTokens.delete(mint);
          token.complete = true;
          token.progress = 100;
          token.destination = "pumpswap";
          token.graduatedAt = Date.now();
          state.graduatedTokens.set(mint, token);
          recordGraduation({ mint, ts: chDateTime(Date.now()) }); // persist to ClickHouse (was missing!)
          state.stats.graduations++;
          feedEvents.emit("graduated", usd(token));
          if (state.graduatedTokens.size > GRADUATED_MAX) {
            const oldest = state.graduatedTokens.keys().next().value;
            if (oldest) { state.graduatedTokens.delete(oldest); dropCandles(oldest); }
          }
        } catch { /* try next tick */ }
      }));
    }
  } finally {
    checkingGrads = false;
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

// ---- PumpSwap gap backfill (post-migration holes) --------------------------
// A migrated coin that nobody viewed for a while ages out of the PumpSwap filter,
// so we capture NONE of its trades in that window — not in memory, not in
// ClickHouse (CH only holds what the feed saw). Resuming the live subscription
// doesn't fill that hole. When a chart is opened and its newest candle is stale,
// pull the missed PumpSwap trades straight from RPC and fill the gap.
const pumpBackfilling = new Set<string>();
const gapCooldown = new Map<string, number>();
const GAP_STALE_MS = 8000;    // candle older than this => a gap to fill
const GAP_COOLDOWN_MS = 12000; // don't re-scan the same mint more than this often

// Decode a PumpSwap swap from an RPC transaction (same delta math as the live
// handler): the largest token delta vs the largest WSOL delta = the swap price.
function decodePumpSwapTradeRpc(tx: any, mint: string): { priceSol: number; solAmount: number } | null {
  const post = tx?.meta?.postTokenBalances || [];
  if (!post.length) return null;
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
  if (absTok <= 0 || absSol <= 0) return null;
  return { priceSol: absSol / absTok, solAmount: absSol };
}

async function backfillPumpSwapGap(mint: string, sinceMs: number): Promise<void> {
  if (pumpBackfilling.has(mint)) return;
  pumpBackfilling.add(mint);
  try {
    const rpc = process.env.SOLANA_RPC_URL || "http://tyo.corvus-labs.io:8899";
    const conn = new Connection(rpc, "confirmed");
    // Most-recent trades touching the mint; keep only those newer than our data
    // (the gap) and replay oldest-first so candle eviction keeps the newest.
    const sigs = (await conn.getSignaturesForAddress(new PublicKey(mint), { limit: 150 }))
      .filter((s) => !s.err && (s.blockTime || 0) * 1000 > sinceMs)
      .reverse();
    let n = 0, i = 0;
    for (const s of sigs) {
      try {
        const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
        const t = decodePumpSwapTradeRpc(tx, mint);
        if (t) { recordCandleAt(mint, t.priceSol, t.solAmount * state.solPrice, (s.blockTime || 0) * 1000); n++; }
      } catch { /* skip tx */ }
      if (++i % 8 === 0) await new Promise((r) => setTimeout(r, 1000)); // ~8 req/s
    }
    if (n) console.log(`[pulse] pumpswap-gap ${mint.slice(0, 8)} filled ${n} trades`);
  } catch (e) {
    console.error("[pulse] pumpswap-gap failed:", (e as Error).message);
  } finally {
    pumpBackfilling.delete(mint);
  }
}

// Called when a chart is opened. If this is a migrated coin whose newest candle is
// stale, fill the missed PumpSwap trades from RPC. Cheap-gated: skips coins still on
// the bonding curve (their gaps are handled by backfillToken) and rate-limited per mint.
function maybeFillPumpSwapGap(mint: string) {
  if (state.newTokens.has(mint) || state.graduatingTokens.has(mint)) return; // still on curve
  const now = Date.now();
  if (now - (gapCooldown.get(mint) || 0) < GAP_COOLDOWN_MS) return;
  const newest = lastTradeAt.get(mint) || 0;
  if (newest && now - newest < GAP_STALE_MS) return; // data is fresh, no gap
  gapCooldown.set(mint, now);
  const since = newest || now - 30 * 60 * 1000; // no data at all => last 30 min
  backfillPumpSwapGap(mint, since).catch(() => {});
}

// ---- public API ------------------------------------------------------------

/**
 * Resolve logos for coins that never got one.
 *
 * recordToken only writes an image when the coin is STILL in memory at the moment its
 * metadata resolves — so anything evicted first (newTokens caps at 400, ~15 min of
 * launches) keeps image='' forever, and the lists are served from ClickHouse. That is
 * why ~25-47% of coins had no logo regardless of age. This sweeps them up.
 */
let imageSweepBusy = false;
async function backfillMissingImages() {
  if (!clickhouseEnabled() || imageSweepBusy) return;
  imageSweepBusy = true;
  try {
    const rows: any[] = await getTokensMissingImages(200);
    let fixed = 0;
    // The resolver is on loopback, so the old batch of 10 every 30s was leaving
    // coins logo-less for minutes when more than half of them were resolvable the
    // whole time — a brand-new coin would sit blank while the sweep worked through
    // the queue. 24 at a time closes that window without stampeding anything.
    for (let i = 0; i < rows.length; i += 24) {
      const batch = rows.slice(i, i + 24);
      await Promise.all(batch.map(async (r) => {
        try {
          const j = await fetchMetadata(String(r.uri));
          const img = typeof j?.image === "string" ? j.image.trim() : "";
          if (!img) return;
          // We already paid for the metadata fetch — take the socials too, and put
          // them in memory as well as ClickHouse (see backfillMissingSocials).
          const s = readSocials(j);
          socialsCache.set(String(r.uri), s);
          const t = anyToken(r.mint);
          if (t) { if (!t.logoUri) t.logoUri = img; applySocials(t, s); }
          recordToken({
            mint: r.mint, name: r.name || "", symbol: r.symbol || "",
            uri: String(r.uri), image: img, creator: "",
            twitter: s.twitter || "", telegram: s.telegram || "", website: s.website || "",
            created_at: chDateTime(Number(r.created_ms) || Date.now()), created_slot: 0,
          });
          prefetch(img);
          fixed++;
        } catch { /* try again next sweep */ }
      }));
    }
    if (fixed) console.log(`[pulse] image backfill: resolved ${fixed}/${rows.length} missing logos`);
  } catch (e) {
    console.error("[pulse] image backfill failed:", (e as Error).message);
  } finally {
    imageSweepBusy = false;
  }
}

/**
 * Backfill socials for coins that resolved a logo before we stored them.
 *
 * The retry rule is the opposite of the image sweep's. A coin with no logo is
 * broken and worth re-attempting; a coin with no Twitter is just a coin with no
 * Twitter, and most of them are — so re-querying them forever would be a permanent
 * pointless load on the IPFS gateways. `socialsChecked` holds every uri we've
 * fetched, so each coin costs exactly one metadata read for the life of the process.
 */
const socialsChecked = new Set<string>();
let socialSweepBusy = false;

/**
 * Copy socials we already hold in ClickHouse onto the in-memory tokens.
 *
 * The durable row is routinely AHEAD of memory — a backfill in an earlier process
 * wrote it, or the coin was re-added to a list after a restart — and no sweep will
 * repair that, because the sweeps look for rows MISSING socials and this row isn't
 * one. Meanwhile /api/feed/token and the live lists answer from memory whenever the
 * coin is still tracked, so the coin has a Twitter in the database and no bird on
 * screen. One small query per tick, bounded by what is actually in memory.
 */
async function hydrateSocialsFromCH() {
  if (!clickhouseEnabled()) return;
  const need: string[] = [];
  for (const m of [state.newTokens, state.graduatingTokens, state.graduatedTokens]) {
    for (const [mint, t] of m) {
      if (!t.twitter && !t.telegram && !t.website) need.push(mint);
    }
  }
  if (!need.length) return;
  try {
    const rows = await getSocialsForMints([...new Set(need)].slice(0, 800));
    let n = 0;
    for (const r of rows) {
      const t = anyToken(String(r.mint));
      if (!t) continue;
      applySocials(t, {
        twitter: r.twitter || undefined,
        telegram: r.telegram || undefined,
        website: r.website || undefined,
      });
      n++;
    }
    if (n) console.log(`[pulse] socials hydrate: ${n} in-memory coins picked up links from CH`);
  } catch (e) {
    console.error("[pulse] socials hydrate failed:", (e as Error).message);
  }
}
async function backfillMissingSocials() {
  if (!clickhouseEnabled() || socialSweepBusy) return;
  socialSweepBusy = true;
  try {
    const rows: any[] = await getTokensMissingSocials(150);
    const todo = rows.filter((r) => r.uri && !socialsChecked.has(String(r.uri)));
    let fixed = 0;
    for (let i = 0; i < todo.length; i += 16) {
      await Promise.all(todo.slice(i, i + 16).map(async (r) => {
        const uri = String(r.uri);
        socialsChecked.add(uri); // mark before the await: one attempt, win or lose
        try {
          const j = await fetchMetadata(uri);
          if (!j) return;
          const s = readSocials(j);
          if (!s.twitter && !s.telegram && !s.website) return; // genuinely has none
          // Patch MEMORY as well as ClickHouse. Writing only the durable row is how a
          // coin ended up with a Twitter in CH and none on screen: /api/feed/token and
          // the live lists answer from memory whenever the coin is still tracked, so a
          // CH-only write is invisible for exactly the coins a user is looking at.
          socialsCache.set(uri, s);
          const t = anyToken(r.mint);
          if (t) applySocials(t, s);
          recordToken({
            mint: r.mint, name: r.name || "", symbol: r.symbol || "",
            uri, image: String(r.image || ""), creator: "",
            twitter: s.twitter || "", telegram: s.telegram || "", website: s.website || "",
            created_at: chDateTime(Number(r.created_ms) || Date.now()), created_slot: 0,
          });
          fixed++;
        } catch { /* one shot; the uri is already marked */ }
      }));
    }
    if (fixed) console.log(`[pulse] socials backfill: ${fixed}/${todo.length} coins got links`);
  } catch (e) {
    console.error("[pulse] socials backfill failed:", (e as Error).message);
  } finally {
    socialSweepBusy = false;
  }
}

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
  setInterval(() => sweepImages(), 5000); // retry missing logos off the hot path
  // ...and sweep the durable store for coins whose logo never landed at all.
  setInterval(() => { backfillMissingImages().catch(() => {}); }, 10000);
  // Slower than the image sweep: nothing is visibly broken while it runs, and the
  // checked-set means it goes quiet on its own once it has seen everything.
  setInterval(() => { backfillMissingSocials().catch(() => {}); }, 20000);
  setTimeout(() => { backfillMissingSocials().catch(() => {}); }, 25000);
  // Cheap and idempotent, so it runs more often than the metadata sweep.
  setInterval(() => { hydrateSocialsFromCH().catch(() => {}); }, 8000);
  setTimeout(() => { hydrateSocialsFromCH().catch(() => {}); }, 6000);
  setTimeout(() => { backfillMissingImages().catch(() => {}); }, 15000);
  // Keep the PumpSwap filter in sync with the set of migrated tokens.
  setInterval(() => { maybeResubscribe().catch(() => {}); }, 3000);
  setInterval(() => {
    const s = state.stats;
    console.log(`[pulse] creates=${s.creates} trades=${s.trades} ps=${s.pumpswap} grads=${s.graduations} new=${state.newTokens.size} grad-ing=${state.graduatingTokens.size} watch=${pumpswapWatchMints().length} conn=${state.connected} feedLag=${medianFeedLag().toFixed(1)}s`);
  }, 60000);
  connect(endpoint, process.env.GRPC_TOKEN);
  // Seed final stretch from ClickHouse ~20s after boot (once CH + SOL price are ready),
  // then keep it topped up every 3 min so it survives restarts and storm gaps.
  setTimeout(() => { backfillGraduatingFromCH().catch(() => {}); }, 20000);
  setInterval(() => { backfillGraduatingFromCH().catch(() => {}); }, 180000);
}

export function isPulseConnected() { return state.connected; }
export function getSolPrice() { return state.solPrice; }

export function getNewPairs(limit = 50): PulseToken[] {
  return Array.from(state.newTokens.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map(usd);
}
export function getGraduating(limit = 20): PulseToken[] {
  return Array.from(state.graduatingTokens.values()).sort((a, b) => b.marketCapSol - a.marketCapSol).slice(0, limit).map(usd);
}

// After a restart the feed only knows coins CREATED since it started, so the live
// final-stretch list (which the WebSocket snapshot reads from memory) is empty and
// refills at ~1 coin / few min. Seed graduatingTokens from ClickHouse's durable
// history so final stretch is populated immediately — these coins are then tracked
// normally (their trades resolve against graduatingTokens; checkGraduations promotes
// or the stall-prune evicts). Idempotent: skips anything already tracked.
async function backfillGraduatingFromCH() {
  if (!clickhouseEnabled()) return;
  try {
    const list: any[] = await chGraduatingPairs(100, state.solPrice);
    let n = 0;
    for (const p of list) {
      const mint = p.address;
      if (!mint || state.graduatingTokens.has(mint) || state.graduatedTokens.has(mint) || state.newTokens.has(mint)) continue;
      const t = newToken(mint, p.name, p.symbol, "");
      t.logoUri = p.logoUri ?? null;
      t.marketCapSol = p.marketCapSol ?? 0;
      t.priceSol = state.solPrice > 0 ? (p.price || 0) / state.solPrice : 0;
      t.progress = p.progress ?? 0;
      t.volume24h = p.volume24h ?? 0;
      t.liquidity = p.liquidity ?? 0;
      t.txCount = p.txCount ?? 0;
      // Carry the metrics the filters bound on. Rebuilding a token without them left
      // the socket's copy at 0/undefined while the HTTP copy had real values, so the
      // same coin passed or failed a bound depending on which one the client happened
      // to be holding.
      t.feesPaidSol = p.feesPaidSol ?? 0;
      t.buys = p.buys ?? 0;
      t.sells = p.sells ?? 0;
      t.twitter = p.twitter ?? undefined;
      t.telegram = p.telegram ?? undefined;
      t.website = p.website ?? undefined;
      t.createdAt = p.createdAt ?? Date.now();
      t.graduatingSince = Date.now();
      t.lastTradeAt = Date.now(); // passed the 20m recency filter; drop if it goes quiet
      state.graduatingTokens.set(mint, t);
      n++;
    }
    if (n) console.log(`[pulse] backfilled ${n} final-stretch coins from ClickHouse`);
  } catch (e) {
    console.error("[pulse] graduating backfill failed:", (e as Error).message);
  }
}
// Retry missing logos on a slow timer — OFF the hot snapshot/decode path so it never
// competes with stream processing (that's what was choking the loop under PROCESSED).
export function sweepImages() {
  for (const [mint, t] of state.newTokens) if (!t.logoUri && t.uri) resolveImage(mint, t.uri).catch(() => {});
  for (const [mint, t] of state.graduatingTokens) if (!t.logoUri && t.uri) resolveImage(mint, t.uri).catch(() => {});
}
export function getGraduated(limit = 20): PulseToken[] {
  // Migrated coins stay for MIGRATED_HOURS (24h by default), newest-first. A hard
  // 30-minute cutoff meant a coin vanished from the column ~40 minutes after it
  // migrated, even though ClickHouse still had it and the HTTP list still served it.
  const cutoff = Date.now() - MIGRATED_HOURS * 3600 * 1000;
  return Array.from(state.graduatedTokens.values())
    .filter((t) => (t.graduatedAt ?? t.createdAt) > cutoff)
    .sort((a, b) => (b.graduatedAt ?? b.createdAt) - (a.graduatedAt ?? a.createdAt))
    .slice(0, limit)
    .map(usd);
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
  // migrated coin keeps updating live (picked up on the next resubscribe tick)...
  watchMint(mint);
  // ...and if it went untracked for a while, fill the missed trades from RPC so the
  // chart has no hole between the old candles and where the live feed resumes.
  maybeFillPumpSwapGap(mint);
  const useSecond = intervalSec < 60;
  const src = useSecond ? state.candles1s.get(mint) : state.candles1m.get(mint);
  if (!src || src.size === 0) return [];
  const p = state.solPrice || 0;
  const base = Array.from(src.values()).sort((a, b) => a.t - b.t);
  const baseSec = useSecond ? FINE_MS / 1000 : 60; // 0.25 for the fine tier

  let out: Candle[];
  // Serve the raw 250ms candles for the finest ("1s") view; roll up only for
  // coarser intervals (5s/15s/... or 1m->5m).
  if ((useSecond && intervalSec <= 1) || intervalSec <= baseSec) {
    out = base; // no roll-up (fine 250ms, or exact tier match)
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

/**
 * Snapshot for the websocket, backed by ClickHouse exactly like the HTTP routes.
 *
 * The memory-only snapshot lies after a restart: graduatedTokens is empty for up to
 * 30 minutes (nothing has migrated since boot), so we pushed `graduated: []` every
 * second. The client can't tell "feed not ready" from "genuinely nothing migrated",
 * so it keeps whatever it had — which is why the migrated list never cleared until a
 * hard reload. Filling from CH makes an empty list mean empty, and lets the client
 * replace unconditionally.
 *
 * `authoritative` says the lists can be trusted to be complete (CH answered, or we
 * have live in-memory data) — the client only replaces on a snapshot that says so.
 */
export async function getSnapshotDurable() {
  const sol = state.solPrice;
  let newPairs = getNewPairs(60);
  let graduating = getGraduating(30);
  let graduated = getGraduated(30);
  let authoritative = state.connected;
  if (clickhouseEnabled()) {
    try {
      // Memoised at 1s: this runs on the broadcast tick, so it is one query per
      // second for every connected client, not one per client.
      if (!newPairs.length) newPairs = (await memo("ws:np", 1000, () => chNewPairs(60, sol))) as any;
      // ALWAYS take migrated from ClickHouse, not just when memory is empty. Memory
      // only holds what has migrated since this process started, so the socket was
      // overwriting the client's fuller HTTP list with a short one every second —
      // which is what made coins disappear from the column after ~40 minutes.
      const chGrad = (await memo("ws:ge", 1000, () => chGraduatedPairs(60, sol))) as any[];
      if (chGrad?.length) graduated = chGrad;
      authoritative = true;
    } catch { /* CH blip — fall back to whatever memory has */ }
  }
  return { newPairs, graduating, graduated, solPrice: sol, authoritative };
}
