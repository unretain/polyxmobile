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

/** Filter params off the query string. Absent/blank => undefined (bound not applied). */
function parseFilters(q: any): ch.PairFilters {
  const n = (v: any) => {
    if (v === undefined || v === null || v === "") return undefined;
    const x = Number(v);
    return Number.isFinite(x) ? x : undefined;
  };
  return {
    search: q.search || undefined,
    exclude: q.exclude || undefined,
    minLiq: n(q.minLiq), maxLiq: n(q.maxLiq),
    minVol: n(q.minVol), maxVol: n(q.maxVol),
    minMcap: n(q.minMcap), maxMcap: n(q.maxMcap),
    minCurve: n(q.minCurve), maxCurve: n(q.maxCurve),
    minFees: n(q.minFees), maxFees: n(q.maxFees),
    minAgeMin: n(q.minAgeMin), maxAgeMin: n(q.maxAgeMin),
    minTx: n(q.minTx), maxTx: n(q.maxTx),
    minBuys: n(q.minBuys), maxBuys: n(q.maxBuys),
    minSells: n(q.minSells), maxSells: n(q.maxSells),
    maxAgeHours: n(q.maxAgeHours),
    activeMins: n(q.activeMins),
  };
}

/** Any bound actually set? If so, an empty result is a real answer — see below. */
const hasFilters = (f: ch.PairFilters) =>
  Object.values(f).some((v) => v !== undefined && v !== "");

/** Stable memo key for a filter set (order-independent). */
const fkey = (f: ch.PairFilters) =>
  Object.entries(f).filter(([, v]) => v !== undefined).sort().map(([k, v]) => `${k}=${v}`).join("&");


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



/**
 * Timeframe -> bar width in MILLISECONDS.
 *
 * "1s" maps to 250ms on purpose. These coins trade ~6x a second, so one-second bars
 * collapse most of the price action (3217 trades became 514 bars). The in-memory tier
 * is already 250ms; this keeps that resolution instead of rebucketing it away, and
 * ClickHouse now matches it via recv_ts.
 */
function timeframeToMs(tf: string): number {
  switch (tf) {
    case "1s": return 250;   // fine tier — 4 bars/sec, matches the live feed
    case "5s": return 5000;
    case "15s": return 15000;
    case "30s": return 30000;
    case "1m": case "1min": return 60000;
    case "5m": case "5min": return 300000;
    case "15m": case "15min": return 900000;
    case "1h": case "1hour": return 3600000;
    case "4h": return 14400000;
    case "1d": case "1day": return 86400000;
    case "1w": return 604800000;
    default: return 60000;
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
      const f = parseFilters(req.query);
      const data = await memo(`f:np:${limit}:${fkey(f)}`, 1000, () => ch.getNewPairs(limit, sol, f));
      // With filters active an empty list is the correct answer. Falling through to
      // the in-memory list would ignore the filter entirely and show coins the user
      // explicitly excluded (a 30-minute age floor was returning 12-second-old coins).
      if (data.length || hasFilters(f)) return res.json({ data, source: "clickhouse", solPrice: sol, realtime: isPulseConnected() });
    } catch (e) { console.error("[feed] CH new-pairs:", (e as Error).message); }
  }
  res.json({ data: getNewPairs(limit), source: "grpc", solPrice: sol, realtime: isPulseConnected() });
});

feedRoutes.get("/graduating", async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit)) || 20, 100);
  const sol = getSolPrice();
  if (clickhouseEnabled()) {
    try {
      const f = parseFilters(req.query);
      const data = await memo(`f:gi:${limit}:${fkey(f)}`, 1000, () => ch.getGraduatingPairs(limit, sol, f));
      if (data.length || hasFilters(f)) return res.json({ data, source: "clickhouse", solPrice: sol });
    } catch (e) { console.error("[feed] CH graduating:", (e as Error).message); }
  }
  res.json({ data: getGraduating(limit), source: "grpc", solPrice: sol });
});

feedRoutes.get("/graduated", async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit)) || 20, 100);
  const sol = getSolPrice();
  if (clickhouseEnabled()) {
    try {
      const f = parseFilters(req.query);
      const data = await memo(`f:ge:${limit}:${fkey(f)}`, 1000, () => ch.getGraduatedPairs(limit, sol, f));
      if (data.length || hasFilters(f)) return res.json({ data, source: "clickhouse", solPrice: sol });
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
  const ivMs = timeframeToMs(String(req.query.timeframe || "1m"));
  const iv = Math.max(1, Math.round(ivMs / 1000)); // in-memory getCandles still takes seconds
  const limit = Math.min(parseInt(String(req.query.limit)) || 1000, 5000);
  // Finer bars must not mean a shorter chart. At 250ms, the client's 1000-bar budget
  // covers just over 4 minutes, so a 6-minute-old coin lost its opening entirely — the
  // "everything before it hit final stretch is missing" case. Sub-second views get a
  // bigger bar budget so the window stays comparable to the 1s view.
  const outLimit = ivMs < 1000 ? Math.min(5000, Math.max(limit, Math.ceil(limit * (1000 / ivMs)))) : limit;
  let data = getCandles(mint, iv, outLimit);
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
  // Sub-minute charts still need ClickHouse: memory only holds MAX_1S 250ms candles
  // (~5 min), so a 10-minute-old coin lost its first half. Blanket-disabling the merge
  // below 1m fixed the double-plotting but created that hole.
  //
  // Instead: ClickHouse is the base (block time, uniform), and memory contributes only
  // bars a FULL bucket beyond CH's newest. That is what stops the duplication — the two
  // sources are ~1.5s apart (receive time vs block time), so requiring a whole bucket of
  // clearance means a trade can never be plotted twice.
  if (clickhouseEnabled()) {
    try {
      const want = Math.min(outLimit, 5000);
      const chData = await memo(`f:cndl:${mint}:${ivMs}:${want}`, 1000, () => ch.getTradeCandles(mint, ivMs, want, getSolPrice()));
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
          const ivMsGap = ivMs;
          const chLast = chData[chData.length - 1].timestamp;
          const liveTail = data.filter((c) => c.timestamp > chLast + ivMsGap);
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
  data = rebucket(data as Bar[], ivMs).slice(-outLimit);

  // Bars must OPEN where the previous one CLOSED. Without this each bar opens at
  // whatever its own first trade was, so consecutive candles don't touch — the chart
  // renders as disconnected floating bars with holes between them. The in-memory path
  // has always done this (see getCandles) and the client does it for live ticks, but
  // the ClickHouse path never did, and ClickHouse now serves nearly the whole chart.
  //
  // This invents no prices: every open/high/low/close still comes from real trades. It
  // only carries the last traded price forward as the next bar's open, which is what it
  // actually was — nothing traded in between to move it.
  for (let i = 1; i < data.length; i++) {
    const prevClose = data[i - 1].close;
    const c = data[i];
    data[i] = {
      ...c,
      open: prevClose,
      high: Math.max(c.high, prevClose),
      low: Math.min(c.low, prevClose),
    };
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
    const data = await memo(`f:wt:${address}:${limit}`, 2000, () => ch.getWalletTrades(address, limit));
    res.json({ data, source: "clickhouse" });
  } catch (e) {
    console.error("[feed] wallet-trades:", (e as Error).message);
    res.status(500).json({ error: "Failed to fetch wallet trades" });
  }
});
