/**
 * HTTP feed API — serves the in-memory pulse state for the initial page load
 * and as a fallback. The live experience comes over WebSocket (pulse:snapshot);
 * these endpoints are just a snapshot read of the same in-memory feed, so they
 * never touch a database and cost nothing to fan out.
 *
 * Charts (OHLCV) and per-token trade lists come from GeckoTerminal on the web
 * side — you can't build full history from a live stream.
 */
import { Router } from "express";
import {
  isPulseConnected, getSolPrice,
  getNewPairs, getGraduating, getGraduated, getToken, getSnapshot,
  getCandles, hasCandles,
} from "../pulse/feed";
import * as ch from "../clickhouse/queries";
import { clickhouseEnabled } from "../clickhouse/client";

export const feedRoutes = Router();

function timeframeToSeconds(tf: string): number {
  switch (tf) {
    case "1s": return 1;   // true per-second candles from our stream
    case "5s": return 5;
    case "15s": return 15;
    case "30s": return 30;
    case "1m": case "1min": return 60;
    case "5m": case "5min": return 300;
    case "15m": case "15min": return 900;
    case "1h": case "1hour": return 3600;
    case "4h": return 14400;
    case "1d": case "1day": return 86400;
    case "1w": return 604800;
    default: return 60;
  }
}

feedRoutes.get("/status", (_req, res) => {
  res.json({ connected: isPulseConnected(), solPrice: getSolPrice() });
});

feedRoutes.get("/snapshot", (_req, res) => {
  res.json(getSnapshot());
});

// The lists prefer ClickHouse — it holds EVERY token the ingestor has ever seen
// (no 200-cap eviction, survives restarts), so coins stop randomly dropping.
// In-memory is the fallback when CH is disabled or momentarily empty/erroring.
feedRoutes.get("/new-pairs", async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit)) || 50, 200);
  const sol = getSolPrice();
  if (clickhouseEnabled()) {
    try {
      const data = await ch.getNewPairs(limit, sol);
      if (data.length) return res.json({ data, source: "clickhouse", solPrice: sol, realtime: isPulseConnected() });
    } catch (e) { console.error("[feed] CH new-pairs:", (e as Error).message); }
  }
  res.json({ data: getNewPairs(limit), source: "grpc", solPrice: sol, realtime: isPulseConnected() });
});

feedRoutes.get("/graduating", async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit)) || 20, 100);
  const sol = getSolPrice();
  if (clickhouseEnabled()) {
    try {
      const data = await ch.getGraduatingPairs(limit, sol);
      if (data.length) return res.json({ data, source: "clickhouse", solPrice: sol });
    } catch (e) { console.error("[feed] CH graduating:", (e as Error).message); }
  }
  res.json({ data: getGraduating(limit), source: "grpc", solPrice: sol });
});

feedRoutes.get("/graduated", async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit)) || 20, 100);
  const sol = getSolPrice();
  if (clickhouseEnabled()) {
    try {
      const data = await ch.getGraduatedPairs(limit, sol);
      if (data.length) return res.json({ data, source: "clickhouse", solPrice: sol });
    } catch (e) { console.error("[feed] CH graduated:", (e as Error).message); }
  }
  res.json({ data: getGraduated(limit), source: "grpc", solPrice: sol });
});

// Token detail: in-memory first (freshest live price), else ClickHouse so a coin
// that was evicted or created before the last restart still loads its page.
feedRoutes.get("/token/:mint", async (req, res) => {
  const inMem = getToken(req.params.mint);
  if (inMem) return res.json(inMem);
  if (clickhouseEnabled()) {
    try {
      const data = await ch.getTokenData(req.params.mint, getSolPrice());
      if (data) return res.json(data);
    } catch (e) { console.error("[feed] CH token:", (e as Error).message); }
  }
  res.status(404).json({ error: "not found" });
});

// OHLCV: in-memory candles for the live view (down to 1s). For an evicted /
// pre-restart token with no in-memory candles, fall back to ClickHouse's durable
// 1m+ history (candles_1m). Sub-minute intervals only exist in memory.
feedRoutes.get("/ohlcv/:mint", async (req, res) => {
  const mint = req.params.mint;
  const iv = timeframeToSeconds(String(req.query.timeframe || "1m"));
  const limit = Math.min(parseInt(String(req.query.limit)) || 1000, 5000);
  let data = getCandles(mint, iv, limit);
  let source = "grpc";
  if (data.length === 0 && clickhouseEnabled()) {
    try {
      // Build fine candles from the durable trade history (down to 1s), in USD to
      // match the in-memory getCandles (which already multiplies by solPrice).
      const chData = await ch.getTradeCandles(mint, iv, Math.min(limit, 600), getSolPrice());
      if (chData.length) { data = chData; source = "clickhouse"; }
    } catch (e) { console.error("[feed] CH ohlcv:", (e as Error).message); }
  }
  res.json({ data, source, hasHistory: hasCandles(mint) || data.length > 0 });
});

// GET /api/feed/wallet-trades/:address — every on-chain trade for a wallet, from
// the durable feed. Powers the portfolio/PnL for client-side (mobile) wallets,
// whose trades never touch the custodial Postgres.
feedRoutes.get("/wallet-trades/:address", async (req, res) => {
  const address = req.params.address;
  const limit = Math.min(parseInt(String(req.query.limit)) || 2000, 5000);
  if (!clickhouseEnabled()) return res.json({ data: [], source: "none" });
  try {
    const data = await ch.getWalletTrades(address, limit);
    res.json({ data, source: "clickhouse" });
  } catch (e) {
    console.error("[feed] wallet-trades:", (e as Error).message);
    res.status(500).json({ error: "Failed to fetch wallet trades" });
  }
});
