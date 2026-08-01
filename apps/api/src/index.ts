// MUST be first: load .env before any module that reads process.env at import
// time (prisma client URL, auth middleware key, etc.).
import "dotenv/config";
import express from "express";
import cors from "cors";
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
app.use(express.json());

// Health check (public, no auth required)
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
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

  // THE pulse feed: one Corvus gRPC connection -> in-memory live state ->
  // broadcast over WebSocket to every user (see websocket/index.ts).
  startPulseFeed();

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
