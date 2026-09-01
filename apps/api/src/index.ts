// MUST be first: load .env before any module that reads process.env at import
// time (prisma client URL, auth middleware key, etc.).
import "dotenv/config";
import express from "express";
import cors from "cors";
import compression from "compression";
import { createServer } from "http";
import { Server } from "socket.io";
import { tokenRoutes } from "./routes/tokens";
import { trendingRoutes } from "./routes/trending";
import { pulseRoutes } from "./routes/pulse";
import { ohlcvRoutes } from "./routes/ohlcv";
import { videoRoutes } from "./routes/video";
import { feedRoutes } from "./routes/feed";
import { setupWebSocket } from "./websocket";
import { pulseSyncService } from "./services/pulseSync";
import { requireInternalApiKey, rateLimit } from "./middleware/auth";
import { startPulseFeed } from "./pulse/feed";
import { initClickHouseSchema } from "./clickhouse/client";
import { startChWriter } from "./clickhouse/writer";
import * as imgCache from "./pulse/imagecache";
import { initImageCache } from "./pulse/imagecache";
import { isPublicHttpUrl } from "./pulse/ipfs";

const app = express();
const httpServer = createServer(app);

// Allow ONE shared API to serve multiple web deployments (e.g. the website + the
// mobile web app). FRONTEND_URL is a comma-separated list of allowed origins.
// Requests with no Origin (curl, server-to-server, some mobile webviews) are
// allowed too — the REST API is still gated by INTERNAL_API_KEY, and the socket
// only carries public feed data.
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const io = new Server(httpServer, {
  cors: {
    origin: (origin, cb) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
// gzip the JSON lists — a 26KB new-pairs payload compresses to a few KB, which is
// most of the transfer time on a phone. Images are already webp, so skip them:
// re-compressing compressed bytes burns CPU for nothing.
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    const type = String(res.getHeader("Content-Type") || "");
    if (type.startsWith("image/")) return false;
    return compression.filter(req, res);
  },
}));
app.use(express.json());

// Health check (public, no auth required)
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Public image proxy (no auth): coin logos live on IPFS gateways that browsers block
// cross-origin (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin — redirects to per-CID subdomain
// gateways, crossOrigin/canvas loads, etc). Re-serving them from our own origin with
// explicit permissive headers fixes it in every context. Cloudflare caches this route,
// so each image is fetched from the gateway once. SSRF is blocked by resolving the
// host and refusing private targets (isPublicHttpUrl) rather than by a fixed host
// allowlist — the old 13-host list 400'd ~40% of real logos, because every launchpad
// ships its own CDN and the list could never keep up.
app.get("/img", async (req, res) => {
  const u = String(req.query.u || "");
  try {
    // Cache hit short-circuits the DNS check: we already vetted it when we stored it.
    const hit = await imgCache.get(u);
    if (hit) {
      res.setHeader("Content-Type", hit.contentType);
      res.setHeader("Content-Length", String(hit.size));
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
      return imgCache.openStream(hit).pipe(res);
    }
    // ipfs://<cid> never hits the network directly — hedgedFetch maps it onto our own
    // gateway list, so there is no host to vet. Everything else must be a public host.
    if (!/^ipfs:\/\//i.test(u) && !(await isPublicHttpUrl(u))) return res.status(400).end();
    // Cold: fetch it now (hedged across gateways) and store for everyone after.
    const cached = await imgCache.fetchAndStore(u);
    if (cached) {
      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("Content-Length", String(cached.size));
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
      return imgCache.openStream(cached).pipe(res);
    }
    // Cache unavailable (dir not writable) — fall back to the straight proxy.
    const r = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(10000) });
    const ct = r.headers.get("content-type") || "";
    if (!r.ok || !ct.startsWith("image/")) return res.status(502).end();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return res.status(413).end();
    res.setHeader("Content-Type", ct);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    return res.end(buf);
  } catch {
    return res.status(502).end();
  }
});

// Apply internal API key authentication to all /api routes
// This protects Birdeye/Moralis API calls from unauthorized access
app.use("/api", requireInternalApiKey);

// Apply rate limiting as additional protection (100 requests per minute per IP)
app.use("/api", rateLimit(100, 60000));

// Routes (now protected by auth middleware)
app.use("/api/tokens", tokenRoutes);
app.use("/api/trending", trendingRoutes);
app.use("/api/pulse", pulseRoutes);
app.use("/api/ohlcv", ohlcvRoutes);
app.use("/api/video", videoRoutes);
app.use("/api/feed", feedRoutes);

// WebSocket setup
setupWebSocket(io);

// Error handler
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
);

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`🚀 API server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready on port ${PORT}`);
  console.log(`✅ BUILD MARKER: gRPC feed active, pulseSync gated behind ENABLE_PG_SYNC`);

  // Logo disk cache — must be ready before the feed starts discovering coins,
  // otherwise the first minute of prefetches no-op.
  initImageCache()
    .then(() => {
      // THE pulse feed: one gRPC connection -> in-memory live state ->
      // broadcast over WebSocket to every user (see websocket/index.ts).
      startPulseFeed();
    })
    .catch(() => startPulseFeed());

  // ClickHouse persistence: create schema, then start the dual-write flush timer.
  // The SINGLE feed decoder (startPulseFeed) writes to ClickHouse directly — no
  // second gRPC connection/decoder, so the API keeps pace with the stream (no lag).
  // No-op if CLICKHOUSE_URL is unset.
  initClickHouseSchema()
    .then((ready) => { if (ready) startChWriter(); })
    .catch((e) => console.error("[clickhouse] init failed:", (e as Error)?.message));

  // Legacy Postgres (Supabase) pulse sync — OFF by default. Set ENABLE_PG_SYNC=true.
  if (process.env.ENABLE_PG_SYNC === "true") {
    pulseSyncService.start();
    console.log(`📊 Pulse (Postgres) background sync started`);
  }
});
