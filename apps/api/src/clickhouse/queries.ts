/**
 * Read queries over the ClickHouse feed. Trades are stored SOL-denominated
 * (price_sol / mcap_sol from on-chain reserves); USD is computed here by
 * multiplying by the live SOL price. priceChange is a pure ratio (SOL price
 * cancels), so it's always correct even if the price feed hiccups.
 */
import { getClickHouse } from "./client";
import { proxyImg } from "../lib/imgurl";

const INITIAL_REAL_TOKEN_RAW = 793_100_000 * 1e6;
const MIGRATION_MC_SOL = 410.9;
const INITIAL_MC_SOL = 28;
const FINAL_STRETCH_PROGRESS = 80;
// Pulse only shows recent coins: anything older than this drops off automatically,
// so stale/dead tokens never linger in the lists.
const MAX_AGE_DAYS = 5;

async function q<T>(sql: string, params: Record<string, unknown>): Promise<T[]> {
  const ch = getClickHouse();
  if (!ch) return [];
  const rs = await ch.query({ query: sql, query_params: params, format: "JSONEachRow" });
  return (await rs.json()) as T[];
}

// Logo URLs are built by the SHARED proxyImg in ../lib/imgurl. This file used to
// carry its own copy, which drifted out of sync with feed.ts — it still dropped
// ipfs:// URLs and still pointed at the API host. Most list rows come from here, so
// that stale copy silently undid the fixes made in feed.ts.

// USD fields are already computed in SQL; this just normalizes/labels the row.
function shapePair(r: any, solPrice: number) {
  return {
    address: r.address,
    symbol: r.symbol || r.address.slice(0, 6),
    name: r.name || r.symbol || r.address.slice(0, 8),
    logoUri: proxyImg(r.logoUri || null),
    price: Number(r.price) || 0,
    priceChange24h: Number(r.priceChange24h) || 0,
    volume24h: Number(r.volume24h) || 0,
    liquidity: 0,
    marketCap: Number(r.marketCap) || 0,
    marketCapSol: Number(r.marketCapSol) || 0,
    migrationMc: MIGRATION_MC_SOL * solPrice,
    txCount: Number(r.txCount) || 0,
    createdAt: Number(r.createdAt) || Date.now(),
    source: "clickhouse",
    complete: !!r.complete,
    progress: Math.max(0, Math.min(100, Number(r.progress) || 0)),
  };
}

// join_use_nulls=1 so unmatched (no-trade) tokens are NULL → coalesce applies,
// instead of ClickHouse's default 0-fill (which made no-trade tokens 100% progress).
const TRADE_AGG = `
  SELECT mint,
    argMax(price_sol, ts) AS last_price_sol,
    argMin(price_sol, ts) AS first_price_sol,
    argMax(mcap_sol, ts)  AS mcap_sol,
    argMax(real_token_reserves, ts) AS real_tok,
    sumIf(sol_amount, ts > now() - INTERVAL 24 HOUR) AS vol_sol,
    sumIf(sol_amount, ts > now() - INTERVAL 1 HOUR)  AS vol_1h,
    sum(sol_amount)                                  AS total_sol,
    argMax(real_sol, ts)                             AS real_sol,
    sum(fee_sol) + sum(creator_fee_sol)              AS fees_sol,
    countIf(is_buy = 1)                              AS buys,
    countIf(is_buy = 0)                              AS sells,
    max(ts) AS last_ts,
    count() AS tx
  FROM trades GROUP BY mint`;

async function activePairs(limit: number, solPrice: number, f: PairFilters = {}) {
  const { where, params } = filterSql(f, solPrice);
  const rows = await q<any>(
    `SELECT
       t.mint AS address, t.name AS name, t.symbol AS symbol, t.image AS logoUri,
       toUnixTimestamp64Milli(t.created_at) AS createdAt,
       coalesce(lt.last_price_sol, 0) * {sol:Float64} AS price,
       coalesce(lt.mcap_sol, {initMcSol:Float64}) AS marketCapSol,
       coalesce(lt.mcap_sol, {initMcSol:Float64}) * {sol:Float64} AS marketCap,
       coalesce(lt.vol_sol, 0) * {sol:Float64} AS volume24h,
       coalesce(lt.tx, 0) AS txCount,
       if(lt.first_price_sol > 0, (lt.last_price_sol - lt.first_price_sol) / lt.first_price_sol * 100, 0) AS priceChange24h,
       greatest(0, least(100, (1 - coalesce(lt.real_tok, {init:Float64}) / {init:Float64}) * 100)) AS progress
     FROM (SELECT * FROM tokens FINAL WHERE created_at > now() - INTERVAL {maxAge:UInt16} DAY ORDER BY created_at DESC LIMIT {scan:UInt32}) t
     LEFT JOIN (${TRADE_AGG}) lt ON t.mint = lt.mint
     WHERE t.mint NOT IN (SELECT mint FROM graduations) ${where}
     ORDER BY t.created_at DESC
     LIMIT {scan:UInt32}
     SETTINGS join_use_nulls = 1`,
    { scan: Math.max(limit * 3, 150), init: INITIAL_REAL_TOKEN_RAW, initMcSol: INITIAL_MC_SOL, sol: solPrice, maxAge: MAX_AGE_DAYS, ...params }
  );
  return rows.map((r) => shapePair(r, solPrice));
}

export async function getNewPairs(limit: number, solPrice: number, f: PairFilters = {}) {
  const all = await activePairs(limit, solPrice, f);
  return all.filter((p) => p.progress < FINAL_STRETCH_PROGRESS).slice(0, limit);
}

export async function getGraduatingPairs(limit: number, solPrice: number, f: PairFilters = {}) {
  const { where, params } = filterSql(f, solPrice);
  // Find coins CURRENTLY in final stretch BY PROGRESS, not by creation recency. A coin
  // that pumped near graduation is usually not among the newest tokens, so the old
  // activePairs(newest-300) scan missed them and returned ~1. On-chain "80%+ sold" is
  // real_tok <= INIT*(1-0.8); real_tok=0 rows are migrated (PumpSwap) coins, excluded
  // via >0 + NOT IN graduations.
  const rows = await q<any>(
    `SELECT
       t.mint AS address, t.name AS name, t.symbol AS symbol, t.image AS logoUri,
       toUnixTimestamp64Milli(t.created_at) AS createdAt,
       lt.last_price_sol * {sol:Float64} AS price,
       lt.mcap_sol AS marketCapSol,
       lt.mcap_sol * {sol:Float64} AS marketCap,
       lt.vol_sol * {sol:Float64} AS volume24h,
       lt.tx AS txCount,
       if(lt.first_price_sol > 0, (lt.last_price_sol - lt.first_price_sol) / lt.first_price_sol * 100, 0) AS priceChange24h,
       greatest(0, least(100, (1 - lt.real_tok / {init:Float64}) * 100)) AS progress
     FROM (${TRADE_AGG}) lt
     INNER JOIN (SELECT * FROM tokens FINAL WHERE created_at > now() - INTERVAL {maxAge:UInt16} DAY) t ON lt.mint = t.mint
     WHERE lt.real_tok > 0 AND lt.real_tok <= {maxTok:Float64}
       AND lt.last_ts > now() - INTERVAL 20 MINUTE
       AND lt.mint NOT IN (SELECT mint FROM graduations) ${where}
     ORDER BY lt.mcap_sol DESC
     LIMIT {limit:UInt32}
     SETTINGS join_use_nulls = 1`,
    { limit, sol: solPrice, init: INITIAL_REAL_TOKEN_RAW, maxAge: MAX_AGE_DAYS, maxTok: INITIAL_REAL_TOKEN_RAW * (1 - FINAL_STRETCH_PROGRESS / 100), ...params }
  );
  return rows.map((r) => shapePair(r, solPrice));
}

// pump.fun takes 1% of the SOL side of every trade. We don't store a fee column, so
// fees are DERIVED from volume — exact for bonding-curve trades, approximate once a
// coin is on PumpSwap (different fee split). Good enough to filter "has this earned
// real fees", not an accounting figure.
const FEE_RATE = Number(process.env.PUMP_FEE_RATE || 0.01);


/**
 * Filters for the pulse lists — the same set the UI exposes per tab (New Pairs /
 * Final Stretch / Migrated). Everything is optional; an omitted bound is not applied.
 * Money bounds are USD (what the UI shows); fees are SOL, matching "Global Fees Paid".
 */
export interface PairFilters {
  search?: string;        // comma-separated keywords, matched on name+symbol
  exclude?: string;       // comma-separated keywords to reject
  minLiq?: number;   maxLiq?: number;    // USD
  minVol?: number;   maxVol?: number;    // USD, 24h
  minMcap?: number;  maxMcap?: number;   // USD
  minCurve?: number; maxCurve?: number;  // bonding-curve %
  minFees?: number;  maxFees?: number;   // SOL, lifetime
  minTx?: number;    maxTx?: number;
  minBuys?: number;  maxBuys?: number;
  minSells?: number; maxSells?: number;
  maxAgeHours?: number;   // migrated: how far back to keep
  activeMins?: number;    // must have traded within N minutes
}

const kw = (v?: string) =>
  (v || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

/** SQL predicate + params for a filter set. Bounds are only emitted when present, so
 *  an empty filter object costs nothing. */
export function filterSql(f: PairFilters, sol: number) {
  const parts: string[] = [];
  const p: Record<string, any> = {};
  const num = (key: string, expr: string, val: number | undefined, op: string) => {
    if (val === undefined || val === null || Number.isNaN(val)) return;
    parts.push(`${expr} ${op} {${key}:Float64}`);
    p[key] = val;
  };
  const liq = `coalesce(lt.real_sol, 0) * 2 * ${sol || 0}`;
  const vol = `coalesce(lt.vol_sol, 0) * ${sol || 0}`;
  const mc  = `coalesce(lt.mcap_sol, 0) * ${sol || 0}`;
  const curve = `greatest(0, least(100, (1 - coalesce(lt.real_tok, 0) / ${INITIAL_REAL_TOKEN_RAW}) * 100))`;
  const fees = `coalesce(lt.fees_sol, 0)`; // measured, not derived
  num("minLiq", liq, f.minLiq, ">="); num("maxLiq", liq, f.maxLiq, "<=");
  num("minVol", vol, f.minVol, ">="); num("maxVol", vol, f.maxVol, "<=");
  num("minMcap", mc, f.minMcap, ">="); num("maxMcap", mc, f.maxMcap, "<=");
  num("minCurve", curve, f.minCurve, ">="); num("maxCurve", curve, f.maxCurve, "<=");
  num("minFees", fees, f.minFees, ">="); num("maxFees", fees, f.maxFees, "<=");
  num("minTx", "coalesce(lt.tx, 0)", f.minTx, ">="); num("maxTx", "coalesce(lt.tx, 0)", f.maxTx, "<=");
  num("minBuys", "coalesce(lt.buys, 0)", f.minBuys, ">="); num("maxBuys", "coalesce(lt.buys, 0)", f.maxBuys, "<=");
  num("minSells", "coalesce(lt.sells, 0)", f.minSells, ">="); num("maxSells", "coalesce(lt.sells, 0)", f.maxSells, "<=");
  if (f.activeMins) parts.push(`lt.last_ts > now() - INTERVAL ${Math.floor(f.activeMins)} MINUTE`);
  const inc = kw(f.search);
  if (inc.length) {
    parts.push("(" + inc.map((_, i) => `positionCaseInsensitive(concat(t.name, ' ', t.symbol), {kw${i}:String}) > 0`).join(" OR ") + ")");
    inc.forEach((k, i) => { p[`kw${i}`] = k; });
  }
  const exc = kw(f.exclude);
  if (exc.length) {
    parts.push("(" + exc.map((_, i) => `positionCaseInsensitive(concat(t.name, ' ', t.symbol), {xkw${i}:String}) = 0`).join(" AND ") + ")");
    exc.forEach((k, i) => { p[`xkw${i}`] = k; });
  }
  return { where: parts.length ? " AND " + parts.join(" AND ") : "", params: p };
}

export interface GraduatedFilters {
  maxAgeHours?: number;   // how far back to keep migrated coins at all
  minVolSol?: number;     // 1h volume floor — "is it still catching volume"
  minMcapSol?: number;    // market cap floor
  minFeesSol?: number;    // lifetime fees paid floor
  activeMins?: number;    // must have traded within this many minutes
}

/**
 * Migrated coins. This used to be a hard 30-minute window, so a coin that migrated an
 * hour ago and was still doing real volume just disappeared off the list. The window
 * is now wide (24h by default) and callers narrow it with filters instead.
 */
export async function getGraduatedPairs(limit: number, solPrice: number, f: PairFilters = {}) {
  const { where, params } = filterSql(f, solPrice);
  const rows = await q<any>(
    `SELECT
       g.mint AS address, t.name AS name, t.symbol AS symbol, t.image AS logoUri,
       toUnixTimestamp64Milli(g.ts) AS createdAt,
       toUnixTimestamp64Milli(g.ts) AS graduatedAt,
       coalesce(lt.last_price_sol, 0) * {sol:Float64} AS price,
       coalesce(lt.mcap_sol, 0) AS marketCapSol,
       coalesce(lt.mcap_sol, 0) * {sol:Float64} AS marketCap,
       coalesce(lt.real_sol, 0) * 2 * {sol:Float64} AS liquidity,
       coalesce(lt.vol_sol, 0) * {sol:Float64} AS volume24h,
       coalesce(lt.vol_1h, 0) * {sol:Float64} AS volume1h,
       coalesce(lt.fees_sol, 0) AS feesPaidSol,
       coalesce(lt.tx, 0) AS txCount,
       coalesce(lt.buys, 0) AS buys,
       coalesce(lt.sells, 0) AS sells,
       toUnixTimestamp64Milli(lt.last_ts) AS lastTradeAt,
       if(lt.first_price_sol > 0, (lt.last_price_sol - lt.first_price_sol) / lt.first_price_sol * 100, 0) AS priceChange24h
     FROM (
       SELECT mint, max(ts) AS ts FROM graduations
       GROUP BY mint
       HAVING ts > now() - INTERVAL {maxAge:UInt32} HOUR
     ) g
     LEFT JOIN tokens t FINAL ON g.mint = t.mint
     LEFT JOIN (${TRADE_AGG}) lt ON g.mint = lt.mint
     WHERE 1 ${where}
     ORDER BY g.ts DESC
     LIMIT {limit:UInt32}
     SETTINGS join_use_nulls = 1`,
    { limit, sol: solPrice, fee: FEE_RATE, maxAge: f.maxAgeHours ?? 24, ...params }
  );
  return rows.map((r) => ({
    ...shapePair(r, solPrice),
    complete: true, progress: 100, destination: "pumpswap",
    liquidity: Number(r.liquidity) || 0,
    volume1h: Number(r.volume1h) || 0,
    feesPaidSol: Number(r.feesPaidSol) || 0,
    buys: Number(r.buys) || 0,
    sells: Number(r.sells) || 0,
    graduatedAt: Number(r.graduatedAt) || 0,
    lastTradeAt: Number(r.lastTradeAt) || 0,
  }));
}



export async function getTokenData(mint: string, solPrice: number) {
  const rows = await q<any>(
    `SELECT
       t.mint AS address, t.name AS name, t.symbol AS symbol, t.image AS logoUri,
       toUnixTimestamp64Milli(t.created_at) AS createdAt,
       coalesce(lt.last_price_sol, 0) * {sol:Float64} AS price,
       coalesce(lt.mcap_sol, {initMcSol:Float64}) AS marketCapSol,
       coalesce(lt.mcap_sol, {initMcSol:Float64}) * {sol:Float64} AS marketCap,
       coalesce(lt.vol_sol, 0) * {sol:Float64} AS volume24h,
       coalesce(lt.tx, 0) AS txCount,
       lt.real_tok AS real_tok,
       if(lt.first_price_sol > 0, (lt.last_price_sol - lt.first_price_sol) / lt.first_price_sol * 100, 0) AS priceChange24h,
       (t.mint IN (SELECT mint FROM graduations)) AS complete
     FROM (SELECT * FROM tokens FINAL WHERE mint = {mint:String} LIMIT 1) t
     LEFT JOIN (${TRADE_AGG.replace("FROM trades", "FROM trades WHERE mint = {mint:String}")}) lt ON t.mint = lt.mint
     LIMIT 1
     SETTINGS join_use_nulls = 1`,
    { mint, initMcSol: INITIAL_MC_SOL, sol: solPrice }
  );
  if (!rows.length) return null;
  const r = rows[0];
  const progress = Math.max(0, Math.min(100, (1 - (Number(r.real_tok) || INITIAL_REAL_TOKEN_RAW) / INITIAL_REAL_TOKEN_RAW) * 100));
  return { ...shapePair({ ...r, progress }, solPrice), complete: !!r.complete };
}

// OHLCV built from the RAW trades table at any interval (down to 1s), converted to
// USD. Finer than getOhlcv (which uses 1m aggregates) — used for the chart so a
// wiped/stopped coin still shows detailed candles from its durable trade history.
export async function getTradeCandles(mint: string, intervalSec: number, limit: number, solPrice: number) {
  const iv = Math.max(1, Math.floor(intervalSec));
  const rows = await q<any>(
    `SELECT
       toUnixTimestamp(toStartOfInterval(ts, INTERVAL {iv:UInt32} SECOND)) * 1000 AS timestamp,
       argMin(price_sol, (ts, seq)) AS open_sol,
       max(price_sol)        AS high_sol,
       min(price_sol)        AS low_sol,
       argMax(price_sol, (ts, seq)) AS close_sol,
       sum(sol_amount)       AS vol_sol
     FROM trades
     WHERE mint = {mint:String} AND price_sol > 0
     GROUP BY timestamp
     ORDER BY timestamp DESC
     LIMIT {limit:UInt32}`,
    { mint, iv, limit }
  );
  const p = solPrice || 0;
  return rows
    .map((r) => ({
      timestamp: Number(r.timestamp),
      open: Number(r.open_sol) * p,
      high: Number(r.high_sol) * p,
      low: Number(r.low_sol) * p,
      close: Number(r.close_sol) * p,
      volume: Number(r.vol_sol) * p,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

// OHLCV rolled up from candles_1m (stored in SOL) to any timeframe, converted to USD.
export async function getOhlcv(mint: string, intervalSec: number, limit: number, solPrice: number) {
  const rows = await q<any>(
    `SELECT
       toUnixTimestamp(toStartOfInterval(bucket, INTERVAL {iv:UInt32} SECOND)) * 1000 AS timestamp,
       argMinMerge(open)  AS open_sol,
       max(high)          AS high_sol,
       min(low)           AS low_sol,
       argMaxMerge(close) AS close_sol,
       sum(volume_sol)    AS vol_sol
     FROM candles_1m
     WHERE mint = {mint:String}
     GROUP BY timestamp
     ORDER BY timestamp DESC
     LIMIT {limit:UInt32}`,
    { mint, iv: intervalSec, limit }
  );
  const p = solPrice || 0;
  return rows
    .map((r) => ({
      timestamp: Number(r.timestamp),
      open: Number(r.open_sol) * p,
      high: Number(r.high_sol) * p,
      low: Number(r.low_sol) * p,
      close: Number(r.close_sol) * p,
      volume: Number(r.vol_sol) * p,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function getTrades(mint: string, limit: number, solPrice: number) {
  const rows = await q<any>(
    `SELECT toUnixTimestamp64Milli(ts) AS timestamp, is_buy, sol_amount, token_amount, price_sol, trader
     FROM trades WHERE mint = {mint:String} ORDER BY ts DESC LIMIT {limit:UInt32}`,
    { mint, limit }
  );
  const p = solPrice || 0;
  return rows.map((r) => ({
    timestamp: Number(r.timestamp),
    type: r.is_buy ? "buy" : "sell",
    wallet: r.trader || "",
    tokenAmount: String(r.token_amount),
    otherAmount: String(r.sol_amount),
    otherSymbol: "SOL",
    priceUsd: Number(r.price_sol) * p,
    totalValueUsd: Number(r.sol_amount) * p,
  }));
}

// All on-chain trades for a single wallet (across every token), oldest first, so
// a client-side (mobile) wallet's portfolio/PnL can be reconstructed from the feed.
export async function getWalletTrades(trader: string, limit: number) {
  const rows = await q<any>(
    `SELECT mint, toUnixTimestamp64Milli(ts) AS timestamp, is_buy, sol_amount, token_amount, price_sol
     FROM trades WHERE trader = {trader:String} ORDER BY ts ASC LIMIT {limit:UInt32}`,
    { trader, limit }
  );
  return rows.map((r) => ({
    mint: r.mint,
    timestamp: Number(r.timestamp),
    isBuy: !!r.is_buy,
    solAmount: Number(r.sol_amount),
    tokenAmount: Number(r.token_amount),
    priceSol: Number(r.price_sol),
  }));
}
