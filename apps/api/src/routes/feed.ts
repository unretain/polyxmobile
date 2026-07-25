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
  getCandles, hasCandles, backfillToken, isBackfilling,
} from "../pulse/feed";

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

feedRoutes.get("/new-pairs", (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit)) || 50, 200);
  res.json({ data: getNewPairs(limit), source: "grpc", solPrice: getSolPrice(), realtime: isPulseConnected() });
});

feedRoutes.get("/graduating", (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit)) || 20, 100);
  res.json({ data: getGraduating(limit), source: "grpc", solPrice: getSolPrice() });
});

feedRoutes.get("/graduated", (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit)) || 20, 100);
  res.json({ data: getGraduated(limit), source: "grpc", solPrice: getSolPrice() });
});

feedRoutes.get("/token/:mint", (req, res) => {
  const data = getToken(req.params.mint);
  if (!data) return res.status(404).json({ error: "not found" });
  res.json(data);
});

// OHLCV built from OUR gRPC stream (in-memory candles). Empty if we never tracked
// this token — the web then falls back to GeckoTerminal for old/migrated tokens.
feedRoutes.get("/ohlcv/:mint", (req, res) => {
  const mint = req.params.mint;
  const iv = timeframeToSeconds(String(req.query.timeframe || "1m"));
  const limit = Math.min(parseInt(String(req.query.limit)) || 1000, 5000);
  const data = getCandles(mint, iv, limit);
  // Never seen it live → reconstruct from RPC (fire-and-forget; ready next poll).
  if (data.length === 0) backfillToken(mint).catch(() => {});
  res.json({ data, source: "grpc", hasHistory: hasCandles(mint), backfilling: isBackfilling(mint) });
});
