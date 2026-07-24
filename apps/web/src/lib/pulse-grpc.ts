/**
 * Shared Pump.fun gRPC Manager
 *
 * Detects new tokens, trades and graduations by decoding pump.fun's on-chain
 * Anchor events (self-CPI logs), NOT by matching log substrings. This is the
 * only reliable way: the old `logMessages.includes("Create")` check also matched
 * "CreateIdempotent" (an Associated Token Account op that fires on every *buy*),
 * so buys of existing tokens were shown as fake new pairs with no metadata.
 *
 * Every pump.fun instruction emits a self-CPI event prefixed with the Anchor
 * event discriminator (e445a52e51cb9a1d), followed by an 8-byte event id:
 *   CreateEvent   1b72a94ddeeb6376  -> name, symbol, uri, mint, ...
 *   TradeEvent    bddb7fd34ee661ee  -> mint, solAmount, isBuy, ..., virtual reserves
 *   CompleteEvent 5f72619cd42e9808  -> user, mint, bondingCurve (graduation)
 * Discriminators verified live against Corvus Tokyo gRPC.
 */

const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT || "";
const GRPC_TOKEN = process.env.GRPC_TOKEN || "";
const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// Anchor self-CPI event discriminators (hex, first 8 bytes)
const SELF_CPI_DISC = "e445a52e51cb9a1d";
const CREATE_EVENT_DISC = "1b72a94ddeeb6376";
const TRADE_EVENT_DISC = "bddb7fd34ee661ee";
const COMPLETE_EVENT_DISC = "5f72619cd42e9808";

// pump.fun bonding curve constants (verified live against on-chain reserves).
// A token mints 1B supply (6 decimals). The curve starts at 30 virtual SOL /
// 1.073B virtual tokens and graduates when its 793.1M real curve-tokens sell out.
const TOTAL_SUPPLY = 1_000_000_000;
const INITIAL_VIRTUAL_SOL = 30;
const INITIAL_VIRTUAL_TOKENS = 1_073_000_000;
const CURVE_REAL_TOKENS = 793_100_000; // real tokens available to sell on the curve
const INITIAL_REAL_TOKEN_RAW = CURVE_REAL_TOKENS * 1e6; // raw units as seen in TradeEvent

// At graduation realTokenReserves = 0, so virtual reserves are pinned:
//   vTok = 1.073B - 793.1M = 279.9M ; vSol = 30*1.073B / vTok ≈ 115 SOL
//   migration price = vSol/vTok ; migration market cap = price * 1B supply ≈ 410.9 SOL.
// This is a FIXED point on the curve — its USD value is 410.9 * live SOL price,
// which is why the "migration market cap" constantly moves with SOL.
const VTOK_AT_GRAD = INITIAL_VIRTUAL_TOKENS - CURVE_REAL_TOKENS; // 279,900,000
const VSOL_AT_GRAD = (INITIAL_VIRTUAL_SOL * INITIAL_VIRTUAL_TOKENS) / VTOK_AT_GRAD; // ≈115 SOL
export const MIGRATION_MC_SOL = (VSOL_AT_GRAD / VTOK_AT_GRAD) * TOTAL_SUPPLY; // ≈410.9 SOL

// Curve % sold (price-independent) at which a token enters the "final stretch" column
const FINAL_STRETCH_PROGRESS = 80;
// Initial bonding-curve market cap in SOL (30 vSOL / 1.073B vTokens ≈ 28 SOL)
const INITIAL_MC_SOL = (INITIAL_VIRTUAL_SOL / INITIAL_VIRTUAL_TOKENS) * TOTAL_SUPPLY; // ≈27.96

// Fetch SOL price - try multiple sources
async function fetchSolPrice(): Promise<number> {
  // Try Binance first (most reliable)
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT");
    const data = await res.json();
    if (data?.price) return parseFloat(data.price);
  } catch {}

  // Fallback to CoinGecko
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const data = await res.json();
    if (data?.solana?.usd) return data.solana.usd;
  } catch {}

  return 0;
}

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
  txCount: number;
  createdAt: number;
  source: string;
  complete: boolean;
  progress: number;
  destination?: string;
  // Live migration-target market cap in USD (MIGRATION_MC_SOL * SOL price)
  migrationMc: number;
  // internal: MC in SOL at first sighting, used for % change since launch
  launchMarketCapSol?: number;
  // internal: metadata json url, used to lazily resolve the image
  metadataUri?: string;
}

declare global {
  var __pulseGrpcState: {
    connected: boolean;
    stream: any;
    connecting: boolean;
    solPrice: number;
    solPriceLastFetch: number;
    newTokens: Map<string, PulseToken>;
    graduatingTokens: Map<string, PulseToken>;
    graduatedTokens: Map<string, PulseToken>;
    imageCache: Map<string, string | null>;
  } | undefined;
  // eslint-disable-next-line no-var
  var __pulseGrpcRestored: boolean | undefined;
}

if (!global.__pulseGrpcState) {
  global.__pulseGrpcState = {
    connected: false,
    stream: null,
    connecting: false,
    solPrice: 0,
    solPriceLastFetch: 0,
    newTokens: new Map(),
    graduatingTokens: new Map(),
    graduatedTokens: new Map(),
    imageCache: new Map(),
  };
}

export const pulseState = global.__pulseGrpcState;

// ---------------------------------------------------------------------------
// Lightweight file persistence (no DB) so the live feed survives server
// restarts/redeploys instead of resetting to empty. Only tokens seen within
// PERSIST_MAX_AGE are restored, since "new pairs" are only relevant briefly.
// ---------------------------------------------------------------------------
const PERSIST_MAX_AGE = 30 * 60 * 1000; // 30 min
let _lastPersist = 0;

function persistFilePath(): string {
  // Lazily required so this module stays importable in non-Node contexts.
  const os = require("os");
  const path = require("path");
  return path.join(os.tmpdir(), "polyx-pulse-state.json");
}

function loadPersistedState(): void {
  try {
    const fs = require("fs");
    const raw = fs.readFileSync(persistFilePath(), "utf8");
    const data = JSON.parse(raw);
    const cutoff = Date.now() - PERSIST_MAX_AGE;
    const restore = (arr: [string, PulseToken][], map: Map<string, PulseToken>) => {
      for (const [k, v] of arr || []) {
        if (v && typeof v.createdAt === "number" && v.createdAt > cutoff) map.set(k, v);
      }
    };
    restore(data.newTokens, pulseState.newTokens);
    restore(data.graduatingTokens, pulseState.graduatingTokens);
    restore(data.graduatedTokens, pulseState.graduatedTokens);
    console.log(`[pulse] restored ${pulseState.newTokens.size} new / ${pulseState.graduatingTokens.size} grad-ing / ${pulseState.graduatedTokens.size} grad tokens from disk`);
  } catch {
    // no snapshot yet, or unreadable — start empty
  }
}

function persistState(force = false): void {
  const now = Date.now();
  if (!force && now - _lastPersist < 5000) return; // throttle to <=1 write / 5s
  _lastPersist = now;
  try {
    const fs = require("fs");
    const data = {
      newTokens: Array.from(pulseState.newTokens.entries()),
      graduatingTokens: Array.from(pulseState.graduatingTokens.entries()),
      graduatedTokens: Array.from(pulseState.graduatedTokens.entries()),
      savedAt: now,
    };
    const file = persistFilePath();
    fs.writeFileSync(file + ".tmp", JSON.stringify(data));
    fs.renameSync(file + ".tmp", file); // atomic-ish swap
  } catch {
    // best-effort; never let persistence break the stream
  }
}

// Restore once when the singleton state is first created.
if (!global.__pulseGrpcRestored) {
  global.__pulseGrpcRestored = true;
  loadPersistedState();
}

async function ensureSolPrice(): Promise<void> {
  const now = Date.now();
  if (now - pulseState.solPriceLastFetch > 30000 || pulseState.solPrice === 0) {
    const price = await fetchSolPrice();
    if (price > 0) {
      pulseState.solPrice = price;
      pulseState.solPriceLastFetch = now;
    }
  }
}

// ---------------------------------------------------------------------------
// Event decoding
// ---------------------------------------------------------------------------

function readString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  offset += 4;
  const s = buf.slice(offset, offset + len).toString("utf8");
  return [s, offset + len];
}

type CreateEvt = { kind: "create"; mint: string; name: string; symbol: string; uri: string };
type TradeEvt = { kind: "trade"; mint: string; solAmount: number; isBuy: boolean; mcSol: number; priceSol: number; realTokenReserves: number };
type CompleteEvt = { kind: "complete"; mint: string };
type PumpEvent = CreateEvt | TradeEvt | CompleteEvt;

// Decode a single pump.fun self-CPI event instruction. `toB58` converts a
// 32-byte pubkey slice to a base58 string (injected to avoid a top-level
// @solana/web3.js import in this Node route).
function decodeEvent(data: Buffer, toB58: (b: Buffer) => string): PumpEvent | null {
  try {
    if (data.length < 16) return null;
    if (data.slice(0, 8).toString("hex") !== SELF_CPI_DISC) return null;
    const disc = data.slice(8, 16).toString("hex");

    if (disc === CREATE_EVENT_DISC) {
      let o = 16;
      let name: string, symbol: string, uri: string;
      [name, o] = readString(data, o);
      [symbol, o] = readString(data, o);
      [uri, o] = readString(data, o);
      const mint = toB58(data.slice(o, o + 32));
      return { kind: "create", mint, name: name.trim(), symbol: symbol.trim(), uri: uri.trim() };
    }

    if (disc === TRADE_EVENT_DISC) {
      let o = 16;
      const mint = toB58(data.slice(o, o + 32)); o += 32;
      const solAmount = Number(data.readBigUInt64LE(o)); o += 8;
      o += 8; // tokenAmount
      const isBuy = data.readUInt8(o) === 1; o += 1;
      o += 32; // user
      o += 8;  // timestamp (i64)
      const vSol = Number(data.readBigUInt64LE(o)); o += 8;
      const vTok = Number(data.readBigUInt64LE(o)); o += 8;
      o += 8; // realSolReserves (unused)
      const realTokenReserves = Number(data.readBigUInt64LE(o)); o += 8;
      if (vTok <= 0) return null;
      const priceSol = (vSol / 1e9) / (vTok / 1e6); // SOL per whole token
      const mcSol = priceSol * TOTAL_SUPPLY;
      return { kind: "trade", mint, solAmount, isBuy, mcSol, priceSol, realTokenReserves };
    }

    if (disc === COMPLETE_EVENT_DISC) {
      // CompleteEvent { user: pubkey, mint: pubkey, bondingCurve: pubkey, ts }
      const mint = toB58(data.slice(16 + 32, 16 + 64));
      return { kind: "complete", mint };
    }

    return null;
  } catch {
    return null;
  }
}

// Resolve the actual image URL. pump.fun's `uri` points at a metadata JSON
// file (ipfs/arweave/cdn), whose `image` field is the real logo. The old code
// set logoUri = uri (the JSON), which is why images never rendered.
async function resolveImage(uri: string): Promise<string | null> {
  if (!uri) return null;
  if (pulseState.imageCache.has(uri)) return pulseState.imageCache.get(uri) ?? null;
  try {
    const res = await fetch(uri, { signal: AbortSignal.timeout(6000) });
    const json = await res.json();
    const img = typeof json?.image === "string" ? json.image : null;
    pulseState.imageCache.set(uri, img);
    return img;
  } catch {
    pulseState.imageCache.set(uri, null);
    return null;
  }
}

function applyMarketCap(token: PulseToken, mcSol: number, priceSol: number, realTokenReserves: number) {
  token.marketCapSol = mcSol;
  token.marketCap = mcSol * pulseState.solPrice;
  token.price = priceSol * pulseState.solPrice;
  token.migrationMc = MIGRATION_MC_SOL * pulseState.solPrice;
  // Progress = % of the curve's real tokens that have sold. This is the true
  // graduation measure and is INDEPENDENT of SOL price (unlike marketCap/USD).
  token.progress = Math.min(100, Math.max(0, (1 - realTokenReserves / INITIAL_REAL_TOKEN_RAW) * 100));
  const base = token.launchMarketCapSol || INITIAL_MC_SOL;
  token.priceChange24h = base > 0 ? ((mcSol - base) / base) * 100 : 0;
}

// ---------------------------------------------------------------------------
// Stream processing
// ---------------------------------------------------------------------------

function handleTransaction(update: any, toB58: (b: Buffer) => string) {
  const tx = update.transaction?.transaction;
  if (!tx?.meta) return;

  const outer = tx.transaction?.message?.instructions || [];
  const inner: any[] = [];
  for (const grp of tx.meta.innerInstructions || []) {
    for (const ix of grp.instructions || []) inner.push(ix);
  }
  const accountKeys: Uint8Array[] = tx.transaction?.message?.accountKeys || [];

  // Collect pump.fun events in execution order (create precedes its dev-buy)
  const events: PumpEvent[] = [];
  for (const ix of [...outer, ...inner]) {
    const progIdx = ix.programIdIndex;
    if (progIdx === undefined || !ix.data) continue;
    const progKey = accountKeys[progIdx];
    if (!progKey || toB58(Buffer.from(progKey)) !== PUMP_FUN_PROGRAM) continue;
    const data = typeof ix.data === "string" ? Buffer.from(ix.data, "base64") : Buffer.from(ix.data);
    const evt = decodeEvent(data, toB58);
    if (evt) events.push(evt);
  }
  if (events.length === 0) return;

  for (const evt of events) {
    if (evt.kind === "create") {
      if (pulseState.newTokens.has(evt.mint) || pulseState.graduatingTokens.has(evt.mint) || pulseState.graduatedTokens.has(evt.mint)) continue;
      const token: PulseToken = {
        address: evt.mint,
        symbol: evt.symbol || evt.mint.slice(0, 6),
        name: evt.name || evt.symbol || evt.mint.slice(0, 8),
        logoUri: null,
        price: 0,
        priceChange24h: 0,
        volume24h: 0,
        liquidity: 0,
        marketCap: INITIAL_MC_SOL * pulseState.solPrice,
        marketCapSol: INITIAL_MC_SOL,
        txCount: 0,
        createdAt: Date.now(),
        source: "pump.fun",
        complete: false,
        progress: 0, // fresh curve; updated from real reserves on the first trade
        migrationMc: MIGRATION_MC_SOL * pulseState.solPrice,
        launchMarketCapSol: INITIAL_MC_SOL,
        metadataUri: evt.uri,
      };
      pulseState.newTokens.set(evt.mint, token);
      console.log(`[NEW] ${token.symbol} - "${token.name}" ${evt.mint.slice(0, 8)}`);

      // Resolve the real image in the background, don't block the stream.
      if (evt.uri) {
        resolveImage(evt.uri).then((img) => {
          const t = pulseState.newTokens.get(evt.mint) || pulseState.graduatingTokens.get(evt.mint) || pulseState.graduatedTokens.get(evt.mint);
          if (t && img) t.logoUri = img;
        }).catch(() => {});
      }

      if (pulseState.newTokens.size > 100) {
        const oldest = pulseState.newTokens.keys().next().value;
        if (oldest) pulseState.newTokens.delete(oldest);
      }
    } else if (evt.kind === "trade") {
      // Only track trades for tokens whose launch we actually witnessed —
      // never manufacture an entry from a trade (that was the fake-token bug).
      const token = pulseState.newTokens.get(evt.mint) || pulseState.graduatingTokens.get(evt.mint);
      if (!token) continue;
      applyMarketCap(token, evt.mcSol, evt.priceSol, evt.realTokenReserves);
      token.txCount++;
      token.volume24h += (evt.solAmount / 1e9) * pulseState.solPrice;

      if (token.progress >= FINAL_STRETCH_PROGRESS && pulseState.newTokens.has(evt.mint)) {
        pulseState.newTokens.delete(evt.mint);
        pulseState.graduatingTokens.set(evt.mint, token);
        console.log(`[FINAL STRETCH] ${token.symbol} ${token.progress.toFixed(0)}%`);
      }
    } else if (evt.kind === "complete") {
      const token = pulseState.newTokens.get(evt.mint) || pulseState.graduatingTokens.get(evt.mint);
      if (!token || pulseState.graduatedTokens.has(evt.mint)) continue;
      pulseState.newTokens.delete(evt.mint);
      pulseState.graduatingTokens.delete(evt.mint);
      token.complete = true;
      token.progress = 100;
      token.destination = "pumpswap";
      pulseState.graduatedTokens.set(evt.mint, token);
      console.log(`[GRADUATED] ${token.symbol} ${evt.mint.slice(0, 8)}`);

      if (pulseState.graduatedTokens.size > 50) {
        const oldest = pulseState.graduatedTokens.keys().next().value;
        if (oldest) pulseState.graduatedTokens.delete(oldest);
      }
    }
  }

  // Snapshot to disk (throttled) so a restart doesn't wipe the feed.
  persistState();
}

export async function initPulseGrpc(): Promise<void> {
  // Corvus trial is IP-whitelisted, so an empty GRPC_TOKEN is valid; only the endpoint is required.
  if (pulseState.connected || pulseState.connecting || !GRPC_ENDPOINT) return;

  pulseState.connecting = true;

  try {
    await ensureSolPrice();

    const { default: Client, CommitmentLevel } = await import("@triton-one/yellowstone-grpc");
    const { PublicKey } = await import("@solana/web3.js");
    const toB58 = (b: Buffer) => new PublicKey(b).toBase58();

    const client = new Client(GRPC_ENDPOINT, GRPC_TOKEN || undefined, {
      "grpc.max_receive_message_length": 64 * 1024 * 1024, // 64MB
    });
    pulseState.stream = await client.subscribe();

    pulseState.stream.on("data", (update: any) => {
      try {
        if (update.transaction) handleTransaction(update, toB58);
      } catch (e) {
        // never let one bad tx kill the stream
      }
    });

    pulseState.stream.on("error", (err: Error) => {
      console.error("[gRPC] Error:", err.message);
      pulseState.connected = false;
      pulseState.stream = null;
      pulseState.connecting = false;
    });

    pulseState.stream.on("end", () => {
      pulseState.connected = false;
      pulseState.stream = null;
      pulseState.connecting = false;
    });

    await new Promise<void>((resolve, reject) => {
      pulseState.stream.write({
        slots: {},
        accounts: {},
        transactions: {
          pumpfun: {
            vote: false,
            failed: false,
            accountInclude: [PUMP_FUN_PROGRAM],
            accountExclude: [],
            accountRequired: [],
          },
        },
        transactionsStatus: {},
        blocks: {},
        blocksMeta: {},
        entry: {},
        commitment: CommitmentLevel.CONFIRMED,
        accountsDataSlice: [],
      }, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    pulseState.connected = true;
    pulseState.connecting = false;
    console.log("[gRPC] Connected to", GRPC_ENDPOINT);
  } catch (err) {
    console.error("[gRPC] Init failed:", err);
    pulseState.connecting = false;
  }
}

// Re-derive USD fields from the stored SOL values against the current SOL price,
// so marketCap and the migration target stay live even when a token isn't trading.
// Progress is curve-based (price-independent) and left untouched.
function withLiveUsd(token: PulseToken): PulseToken {
  const p = pulseState.solPrice;
  if (p > 0) {
    token.marketCap = token.marketCapSol * p;
    token.migrationMc = MIGRATION_MC_SOL * p;
  }
  return token;
}

export async function getNewTokens(limit: number = 50): Promise<PulseToken[]> {
  await ensureSolPrice();
  return Array.from(pulseState.newTokens.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(withLiveUsd);
}

export async function getGraduatingTokens(limit: number = 20): Promise<PulseToken[]> {
  await ensureSolPrice();
  return Array.from(pulseState.graduatingTokens.values())
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, limit)
    .map(withLiveUsd);
}

export async function getGraduatedTokens(limit: number = 20): Promise<PulseToken[]> {
  await ensureSolPrice();
  return Array.from(pulseState.graduatedTokens.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(withLiveUsd);
}

export function getSolPrice(): number {
  return pulseState.solPrice;
}

export function isConnected(): boolean {
  return pulseState.connected;
}
