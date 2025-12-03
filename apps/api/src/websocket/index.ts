import { Server, Socket } from "socket.io";
import { pumpPortalService } from "../services/pumpportal";
import { meteoraService } from "../services/meteora";

interface SubscriptionState {
  tokens: Set<string>;
  pulse: boolean;
}

const subscriptions = new Map<string, SubscriptionState>();
let pumpPortalInitialized = false;
let meteoraPollingCleanup: (() => void) | null = null;

export function setupWebSocket(io: Server) {
  console.log("🔧 Setting up WebSocket handlers...");

  io.on("connection", (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Initialize subscription state for this client
    subscriptions.set(socket.id, { tokens: new Set(), pulse: false });

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
