/**
 * Read queries over the ClickHouse feed. Trades are stored SOL-denominated
 * (price_sol / mcap_sol from on-chain reserves); USD is computed here by
 * multiplying by the live SOL price. priceChange is a pure ratio (SOL price
 * cancels), so it's always correct even if the price feed hiccups.
 */
import { getClickHouse } from "./client";

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

// USD fields are already computed in SQL; this just normalizes/labels the row.
function shapePair(r: any, solPrice: number) {
  return {
    address: r.address,
    symbol: r.symbol || r.address.slice(0, 6),
    name: r.name || r.symbol || r.address.slice(0, 8),
    logoUri: r.logoUri || null,
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
    count() AS tx
  FROM trades GROUP BY mint`;

async function activePairs(limit: number, solPrice: number) {
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
     WHERE t.mint NOT IN (SELECT mint FROM graduations)
     ORDER BY t.created_at DESC
     LIMIT {scan:UInt32}
     SETTINGS join_use_nulls = 1`,
    { scan: Math.max(limit * 3, 150), init: INITIAL_REAL_TOKEN_RAW, initMcSol: INITIAL_MC_SOL, sol: solPrice, maxAge: MAX_AGE_DAYS }
  );
  return rows.map((r) => shapePair(r, solPrice));
}

export async function getNewPairs(limit: number, solPrice: number) {
  const all = await activePairs(limit, solPrice);
  return all.filter((p) => p.progress < FINAL_STRETCH_PROGRESS).slice(0, limit);
}

export async function getGraduatingPairs(limit: number, solPrice: number) {
  const all = await activePairs(limit, solPrice);
  return all
    .filter((p) => p.progress >= FINAL_STRETCH_PROGRESS)
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, limit);
}

export async function getGraduatedPairs(limit: number, solPrice: number) {
  const rows = await q<any>(
    `SELECT
       g.mint AS address, t.name AS name, t.symbol AS symbol, t.image AS logoUri,
       toUnixTimestamp64Milli(g.ts) AS createdAt,
       coalesce(lt.last_price_sol, 0) * {sol:Float64} AS price,
       coalesce(lt.mcap_sol, 0) AS marketCapSol,
       coalesce(lt.mcap_sol, 0) * {sol:Float64} AS marketCap,
       coalesce(lt.vol_sol, 0) * {sol:Float64} AS volume24h,
       coalesce(lt.tx, 0) AS txCount
     FROM (SELECT mint, max(ts) AS ts FROM graduations GROUP BY mint HAVING ts > now() - INTERVAL {maxAge:UInt16} DAY ORDER BY ts DESC LIMIT {limit:UInt32}) g
     LEFT JOIN tokens t FINAL ON g.mint = t.mint
     LEFT JOIN (${TRADE_AGG}) lt ON g.mint = lt.mint
     ORDER BY g.ts DESC
     SETTINGS join_use_nulls = 1`,
    { limit, sol: solPrice, maxAge: MAX_AGE_DAYS }
  );
  return rows.map((r) => ({ ...shapePair(r, solPrice), complete: true, progress: 100, destination: "pumpswap" }));
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
