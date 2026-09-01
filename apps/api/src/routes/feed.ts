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
import { memo } from "../lib/memo";

export const feedRoutes = Router();

type Bar = { timestamp: number; open: number; high: number; low: number; close: number; volume: number };

/**
 * Roll bars into uniform `ivMs` buckets. The in-memory tail is 250ms-grained while
 * ClickHouse returns the requested interval, so appending one to the other put bars
 * of two different widths on the same axis — half the "choppy" look.
 */
function rebucket(bars: Bar[], ivMs: number): Bar[] {
  const out = new Map<number, Bar>();
  for (const b of bars) {
    const t = Math.floor(b.timestamp / ivMs) * ivMs;
    const cur = out.get(t);
    if (!cur) out.set(t, { ...b, timestamp: t });
    else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  return Array.from(out.values()).sort((a, b) => a.timestamp - b.timestamp);
}



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
      const data = await memo(`f:np:${limit}`, 1000, () => ch.getNewPairs(limit, sol));
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
      const data = await memo(`f:gi:${limit}`, 1000, () => ch.getGraduatingPairs(limit, sol));
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
      const data = await memo(`f:ge:${limit}`, 1000, () => ch.getGraduatedPairs(limit, sol));
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
      const data = await memo(`f:tok:${req.params.mint}`, 1000, () => ch.getTokenData(req.params.mint, getSolPrice()));
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
  // In-memory candles only exist from the moment WE started tracking the coin. For a
  // coin picked up late — the final-stretch backfill after a restart, or a coin that
  // got sniped to 80% within seconds of launch — that means the chart began mid-story
  // and the launch was missing. This used to only consult ClickHouse when memory had
  // NOTHING, so a handful of recent candles was enough to permanently hide the real
  // history. Now we also top up whenever memory doesn't fill the requested window,
  // and splice the durable history in FRONT of it.
  // NOTE the condition is not "memory is short of `limit`". The fine tier is 250ms
  // per candle and capped at MAX_1S (~5 min of wall time), so a 10-minute-old coin
  // returns a FULL 1000 candles that still only cover the last ~4 minutes — the launch
  // is evicted from memory but sitting in ClickHouse. Counting candles said "we have
  // enough" and skipped the top-up, which is exactly how GPRO lost its opening candles.
  // So: always consult ClickHouse (memoised at 1s) and splice in anything older.
  // NEVER merge the two sources below 1 minute. In-memory candles are bucketed by
  // RECEIVE time (for true sub-second resolution) while ClickHouse stores on-chain
  // BLOCK time — about 1.5s apart at current feed lag. Splicing them at 1s means the
  // same trades appear twice, ~1.5s apart, which is what put the steps and phantom
  // jumps in the chart. Inside a 60s bucket that offset is irrelevant, so merging is
  // safe there and gives the long durable history.
  const canMerge = iv >= 60;
  if (clickhouseEnabled() && (canMerge || data.length === 0)) {
    try {
      const want = Math.min(limit, 2000);
      const chData = await memo(`f:cndl:${mint}:${iv}:${want}`, 1000, () => ch.getTradeCandles(mint, iv, want, getSolPrice()));
      if (chData.length) {
        if (!data.length) {
          data = chData;
          source = "clickhouse";
        } else if (chData[0].timestamp < data[0].timestamp) {
          // ClickHouse reaches further back, so IT is the base series and memory only
          // contributes the live tail past CH's newest bucket. Concatenating the two
          // and slicing to `limit` instead would drop the very history we just added
          // (memory alone can already be `limit` candles long), and it would mix bar
          // widths — memory's fine tier is 250ms, CH's is the requested interval.
          const chLast = chData[chData.length - 1].timestamp;
          const liveTail = data.filter((c) => c.timestamp > chLast);
          data = [...chData, ...liveTail];
          source = "clickhouse+grpc";
        }
      }
    } catch (e) { console.error("[feed] CH ohlcv:", (e as Error).message); }
  }
  // Uniform bar WIDTH (ClickHouse returns the requested interval, the in-memory tail
  // is 250ms — mixing them on one axis was half the choppiness). We do NOT gap-fill:
  // padding quiet stretches with zero-volume bars at the last price drew long flat
  // shelves across the chart, which looked far worse than the honest gaps it replaced.
  const ivMs = Math.max(250, iv * 1000);
  data = rebucket(data as Bar[], ivMs).slice(-limit);
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
    const data = await memo(`f:wt:${address}:${limit}`, 2000, () => ch.getWalletTrades(address, limit));
    res.json({ data, source: "clickhouse" });
  } catch (e) {
    console.error("[feed] wallet-trades:", (e as Error).message);
    res.status(500).json({ error: "Failed to fetch wallet trades" });
  }
});
