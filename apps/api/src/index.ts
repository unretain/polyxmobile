import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { tokenRoutes } from "./routes/tokens";
import { trendingRoutes } from "./routes/trending";
import { pulseRoutes } from "./routes/pulse";
import { ohlcvRoutes } from "./routes/ohlcv";
import { videoRoutes } from "./routes/video";
import { setupWebSocket } from "./websocket";
import { pulseSyncService } from "./services/pulseSync";
import { requireInternalApiKey, rateLimit } from "./middleware/auth";

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
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

  // Start background Pulse sync (every 5 seconds)
  // Syncs token data from Moralis to DB for enriched metadata (logos, market cap)
  pulseSyncService.start();
  console.log(`📊 Pulse background sync started`);

  // Dashboard token sync DISABLED - not using Birdeye for dashboard tokens
  // All data comes from DB, no external API calls needed
});
