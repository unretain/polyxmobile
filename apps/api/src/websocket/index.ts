import { Server, Socket } from "socket.io";
import { pumpPortalService } from "../services/pumpportal";
import { meteoraService } from "../services/meteora";
import { getGrpcService } from "../grpc";
import { Timeframe } from "../ohlcv";
import { prisma } from "../lib/prisma";

interface SubscriptionState {
  tokens: Set<string>;
  pulse: boolean;
  dashboard: boolean; // Dashboard token price updates
  ohlcvSubscriptions: Set<string>; // Format: "baseMint:quoteMint:timeframe"
}

const subscriptions = new Map<string, SubscriptionState>();
let pumpPortalInitialized = false;
let meteoraPollingCleanup: (() => void) | null = null;
let dashboardPriceInterval: NodeJS.Timeout | null = null;

export function setupWebSocket(io: Server) {
  console.log("🔧 Setting up WebSocket handlers...");

  io.on("connection", (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Initialize subscription state for this client
    subscriptions.set(socket.id, { tokens: new Set(), pulse: false, dashboard: false, ohlcvSubscriptions: new Set() });

    // Handle token subscription
    socket.on("subscribe:token", (data: { address: string }) => {
      const state = subscriptions.get(socket.id);
      if (state) {
        state.tokens.add(data.address);
        socket.join(`token:${data.address}`);
        console.log(`Client ${socket.id} subscribed to token ${data.address}`);
      }
    });

    // Handle token unsubscription
    socket.on("unsubscribe:token", (data: { address: string }) => {
      const state = subscriptions.get(socket.id);
      if (state) {
        state.tokens.delete(data.address);
        socket.leave(`token:${data.address}`);
        console.log(`Client ${socket.id} unsubscribed from token ${data.address}`);
      }
    });

    // Handle Pulse subscription (real-time new pairs)
    socket.on("subscribe:pulse", () => {
      const state = subscriptions.get(socket.id);
      if (state) {
        state.pulse = true;
        socket.join("pulse");
        console.log(`Client ${socket.id} subscribed to Pulse`);
      }
    });

    // Handle Pulse unsubscription
    socket.on("unsubscribe:pulse", () => {
      const state = subscriptions.get(socket.id);
      if (state) {
        state.pulse = false;
        socket.leave("pulse");
        console.log(`Client ${socket.id} unsubscribed from Pulse`);
      }
    });

    // Handle Dashboard subscription (real-time price updates for established tokens)
    socket.on("subscribe:dashboard", () => {
      const state = subscriptions.get(socket.id);
      if (state) {
        state.dashboard = true;
        socket.join("dashboard");
        console.log(`Client ${socket.id} subscribed to Dashboard`);
      }
    });

    // Handle Dashboard unsubscription
    socket.on("unsubscribe:dashboard", () => {
      const state = subscriptions.get(socket.id);
      if (state) {
        state.dashboard = false;
        socket.leave("dashboard");
        console.log(`Client ${socket.id} unsubscribed from Dashboard`);
      }
    });

    // Handle OHLCV candle subscription
    socket.on("subscribe:ohlcv", (data: { baseMint: string; quoteMint: string; timeframe: Timeframe }) => {
      const state = subscriptions.get(socket.id);
      if (state) {
        const subKey = `${data.baseMint}:${data.quoteMint}:${data.timeframe}`;
        state.ohlcvSubscriptions.add(subKey);
        socket.join(`ohlcv:${subKey}`);
        console.log(`Client ${socket.id} subscribed to OHLCV ${subKey}`);
      }
    });

    // Handle OHLCV candle unsubscription
    socket.on("unsubscribe:ohlcv", (data: { baseMint: string; quoteMint: string; timeframe: Timeframe }) => {
      const state = subscriptions.get(socket.id);
      if (state) {
        const subKey = `${data.baseMint}:${data.quoteMint}:${data.timeframe}`;
        state.ohlcvSubscriptions.delete(subKey);
        socket.leave(`ohlcv:${subKey}`);
        console.log(`Client ${socket.id} unsubscribed from OHLCV ${subKey}`);
      }
    });

    // Handle trade subscription (all trades for a pair)
    socket.on("subscribe:trades", (data: { baseMint: string; quoteMint: string }) => {
      const state = subscriptions.get(socket.id);
      if (state) {
        const subKey = `${data.baseMint}:${data.quoteMint}`;
        socket.join(`trades:${subKey}`);
        console.log(`Client ${socket.id} subscribed to trades ${subKey}`);
      }
    });

    // Handle trade unsubscription
    socket.on("unsubscribe:trades", (data: { baseMint: string; quoteMint: string }) => {
      const subKey = `${data.baseMint}:${data.quoteMint}`;
      socket.leave(`trades:${subKey}`);
      console.log(`Client ${socket.id} unsubscribed from trades ${subKey}`);
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      subscriptions.delete(socket.id);
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  // Initialize PumpPortal real-time feed
  console.log("🔧 Initializing PumpPortal...");
  initializePumpPortal(io);

  // Initialize Meteora polling
  console.log("🔧 Initializing Meteora polling...");
  initializeMeteoraPolling(io);

  // Start price update simulation (replace with real data feeds later)
  startPriceUpdates(io);

  // Initialize gRPC OHLCV streaming
  console.log("🔧 Initializing gRPC OHLCV streaming...");
  initializeGrpcOhlcv(io);

  // Initialize Dashboard price streaming (reads from DB, broadcasts to subscribers)
  console.log("🔧 Initializing Dashboard price streaming...");
  initializeDashboardPriceStreaming(io);
}

// Initialize PumpPortal WebSocket for real-time pump.fun data
async function initializePumpPortal(io: Server) {
  if (pumpPortalInitialized) return;

  try {
    await pumpPortalService.connect();
    pumpPortalInitialized = true;

    // Subscribe to new token creations
    pumpPortalService.subscribeNewTokens();

    // Subscribe to migrations (graduations)
    pumpPortalService.subscribeMigrations();

    // Forward new tokens to Pulse subscribers
    pumpPortalService.on("pulse:newPair", (token) => {
      io.to("pulse").emit("pulse:newPair", token);
    });

    // Forward graduating tokens to Pulse subscribers
    pumpPortalService.on("pulse:graduating", (token) => {
      io.to("pulse").emit("pulse:graduating", token);
    });

    // Forward migrations to Pulse subscribers
    pumpPortalService.on("pulse:migrated", (migration) => {
      io.to("pulse").emit("pulse:migrated", migration);
    });

    // Forward token updates (e.g., logo loaded) to Pulse subscribers
    pumpPortalService.on("pulse:tokenUpdate", (update) => {
      io.to("pulse").emit("pulse:tokenUpdate", update);
    });

    // Log connection status
    pumpPortalService.on("connected", () => {
      console.log("📡 PumpPortal connected - broadcasting real-time pump.fun data");
    });

    pumpPortalService.on("disconnected", () => {
      console.log("📡 PumpPortal disconnected");
    });

    console.log("✅ PumpPortal real-time feed initialized");
  } catch (error) {
    console.error("Failed to initialize PumpPortal:", error);
    // Retry after 5 seconds
    setTimeout(() => initializePumpPortal(io), 5000);
  }
}

// Initialize Meteora polling for new DLMM pairs
async function initializeMeteoraPolling(io: Server) {
  if (meteoraPollingCleanup) return;

  try {
    meteoraPollingCleanup = await meteoraService.pollNewPairs((newPair) => {
      // Broadcast new Meteora pair to Pulse subscribers
      io.to("pulse").emit("pulse:newPair", newPair);
      console.log(`📡 New Meteora pair: ${newPair.symbol}`);
    }, 10000); // Poll every 10 seconds

    console.log("✅ Meteora polling initialized");
  } catch (error) {
    console.error("Failed to initialize Meteora polling:", error);
  }
}

// Simulate price updates for subscribed tokens
function startPriceUpdates(io: Server) {
  setInterval(() => {
    // Get all active token subscriptions
    const activeTokens = new Set<string>();
    for (const state of subscriptions.values()) {
      for (const token of state.tokens) {
        activeTokens.add(token);
      }
    }

    // Send price updates for active tokens
    for (const address of activeTokens) {
      const priceChange = (Math.random() - 0.5) * 0.02; // ±1% change
      const price = 0.01 + Math.random() * 0.05; // Mock price

      io.to(`token:${address}`).emit("price:update", {
        address,
        price: price * (1 + priceChange),
        timestamp: Date.now(),
      });
    }
  }, 5000); // Update every 5 seconds
}

// Initialize gRPC service for OHLCV streaming
async function initializeGrpcOhlcv(io: Server) {
  const grpcService = getGrpcService();

  // Forward candle updates to WebSocket subscribers
  grpcService.on("candleUpdate", (data: { baseMint: string; quoteMint: string; timeframe: string; candle: any }) => {
    const subKey = `${data.baseMint}:${data.quoteMint}:${data.timeframe}`;
    io.to(`ohlcv:${subKey}`).emit("ohlcv:update", data);
  });

  // Forward candle closed events
  grpcService.on("candleClosed", (data: { baseMint: string; quoteMint: string; timeframe: string; candle: any }) => {
    const subKey = `${data.baseMint}:${data.quoteMint}:${data.timeframe}`;
    io.to(`ohlcv:${subKey}`).emit("ohlcv:closed", data);
  });

  // Forward trade events
  grpcService.on("trade", (data: { baseMint: string; quoteMint: string; trade: any }) => {
    const subKey = `${data.baseMint}:${data.quoteMint}`;
    io.to(`trades:${subKey}`).emit("trade", data);
  });

  // Start the gRPC service if configured
  const grpcEndpoint = process.env.GRPC_ENDPOINT;
  const grpcToken = process.env.GRPC_TOKEN;

  if (grpcEndpoint) {
    try {
      await grpcService.start({
        enabled: true,
        endpoint: grpcEndpoint,
        xToken: grpcToken,
      });
      console.log("✅ gRPC OHLCV streaming initialized");
    } catch (error) {
      console.error("Failed to initialize gRPC OHLCV:", error);
    }
  } else {
    console.log("⚠️ GRPC_ENDPOINT not set - OHLCV streaming disabled");
  }
}

// Export function to broadcast updates from other parts of the app
export function broadcastPriceUpdate(
  io: Server,
  address: string,
  price: number
) {
  io.to(`token:${address}`).emit("price:update", {
    address,
    price,
    timestamp: Date.now(),
  });
}

// Initialize real-time dashboard price streaming
// Broadcasts token prices from DB every 1 second for live trading
function initializeDashboardPriceStreaming(io: Server) {
  if (dashboardPriceInterval) return;

  console.log("📊 Starting Dashboard price streaming (every 1s)");

  dashboardPriceInterval = setInterval(async () => {
    // Check if anyone is subscribed to dashboard
    let hasDashboardSubscribers = false;
    for (const state of subscriptions.values()) {
      if (state.dashboard) {
        hasDashboardSubscribers = true;
        break;
      }
    }

    if (!hasDashboardSubscribers) return;

    try {
      // Get all dashboard tokens from DB (already synced by background job)
      const tokens = await prisma.token.findMany({
        select: {
          address: true,
          symbol: true,
          price: true,
          priceChange24h: true,
          volume24h: true,
          marketCap: true,
          liquidity: true,
        },
      });

      // Broadcast to all dashboard subscribers
      io.to("dashboard").emit("dashboard:prices", {
        tokens,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("Failed to broadcast dashboard prices:", error);
    }
  }, 1000); // Every 1 second for live trading
}
