import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { tokenRoutes, startDashboardTokenSync } from "./routes/tokens";
import { trendingRoutes } from "./routes/trending";
import { pulseRoutes } from "./routes/pulse";
import { ohlcvRoutes } from "./routes/ohlcv";
import { setupWebSocket } from "./websocket";
import { pulseSyncService } from "./services/pulseSync";

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

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/api/tokens", tokenRoutes);
app.use("/api/trending", trendingRoutes);
app.use("/api/pulse", pulseRoutes);
app.use("/api/ohlcv", ohlcvRoutes);

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
  // Real-time updates still come via PumpPortal WebSocket
  pulseSyncService.start();
  console.log(`📊 Pulse background sync started`);

  // Start background Dashboard token sync (every 30 seconds)
  // Established tokens don't need as frequent updates as Pulse tokens
  startDashboardTokenSync();
  console.log(`📊 Dashboard token sync started`);
});
