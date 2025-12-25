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

// ==========================================
// Lobby System (in-memory, temporary)
// ==========================================

interface LobbyMember {
  odId: string; // Socket id
  userId: string;
  username: string | null;
  name: string | null;
  image: string | null;
  inVoice: boolean;
}

interface Lobby {
  id: string;
  name: string;
  ownerId: string;
  ownerSocketId: string;
  members: Map<string, LobbyMember>; // socketId -> member
  createdAt: number;
}

interface ChatMessage {
  id: string;
  odId: string;
  userId: string;
  username: string | null;
  name: string | null;
  image: string | null;
  content: string;
  timestamp: number;
}

const lobbies = new Map<string, Lobby>();
const socketToLobby = new Map<string, string>(); // socketId -> lobbyId
const socketToUser = new Map<string, { userId: string; username: string | null; name: string | null; image: string | null }>();

function generateLobbyId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generateMessageId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// Helper to notify friends of lobby status change
async function notifyFriendsOfLobbyUpdate(
  io: Server,
  userId: string,
  socketId: string,
  lobbyId: string | null,
  lobbyName: string | null
) {
  try {
    const friendships = await prisma.friendship.findMany({
      where: { userId },
      select: { friendId: true },
    });
    const friendIds = friendships.map((f) => f.friendId);

    for (const [sid, userData] of socketToUser.entries()) {
      if (friendIds.includes(userData.userId)) {
        io.to(sid).emit("friends:lobbyUpdate", {
          odId: socketId,
          userId,
          lobbyId,
          lobbyName,
        });
      }
    }
  } catch (error) {
    console.error("Failed to notify friends of lobby update:", error);
  }
}
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

        // LIVE: Also subscribe to PumpPortal trades for this token
        // This ensures we get real-time trade events from the chain
        pumpPortalService.subscribeTokenTrades([data.address]);
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

    // ==========================================
    // Lobby Event Handlers
    // ==========================================

    // Authenticate user for lobby features
    socket.on("lobby:auth", async (data: { userId: string; username: string | null; name: string | null; image: string | null }) => {
      socketToUser.set(socket.id, {
        userId: data.userId,
        username: data.username,
        name: data.name,
        image: data.image,
      });
      console.log(`🎮 User authenticated for lobbies: ${data.username || data.userId}`);

      // Notify friends that this user is online
      try {
        const friendships = await prisma.friendship.findMany({
          where: { userId: data.userId },
          select: { friendId: true },
        });
        const friendIds = friendships.map((f) => f.friendId);

        // Find which friends are online and notify them
        for (const [socketId, userData] of socketToUser.entries()) {
          if (friendIds.includes(userData.userId)) {
            io.to(socketId).emit("friends:userOnline", {
              odId: socket.id,
              userId: data.userId,
              username: data.username,
              name: data.name,
              image: data.image,
              lobbyId: null,
              lobbyName: null,
            });
          }
        }
      } catch (error) {
        console.error("Failed to notify friends of user online:", error);
      }
    });

    // Get online friends
    socket.on("friends:getOnline", async (data: { friendIds: string[] }) => {
      const onlineFriends: any[] = [];

      for (const [socketId, userData] of socketToUser.entries()) {
        if (data.friendIds.includes(userData.userId)) {
          const lobbyId = socketToLobby.get(socketId);
          const lobby = lobbyId ? lobbies.get(lobbyId) : null;

          onlineFriends.push({
            odId: socketId,
            userId: userData.userId,
            username: userData.username,
            name: userData.name,
            image: userData.image,
            lobbyId: lobby?.id || null,
            lobbyName: lobby?.name || null,
          });
        }
      }

      socket.emit("friends:online", { friends: onlineFriends });
    });

    // Create a new lobby
    socket.on("lobby:create", (data: { name: string }, callback: (response: { success: boolean; lobby?: any; error?: string }) => void) => {
      const user = socketToUser.get(socket.id);
      if (!user) {
        callback({ success: false, error: "Not authenticated" });
        return;
      }

      // Check if user is already in a lobby
      const existingLobbyId = socketToLobby.get(socket.id);
      if (existingLobbyId) {
        callback({ success: false, error: "Already in a lobby" });
        return;
      }

      const lobbyId = generateLobbyId();
      const lobby: Lobby = {
        id: lobbyId,
        name: data.name || `${user.username || user.name}'s Lobby`,
        ownerId: user.userId,
        ownerSocketId: socket.id,
        members: new Map(),
        createdAt: Date.now(),
      };

      // Add creator as first member
      const member: LobbyMember = {
        odId: socket.id,
        userId: user.userId,
        username: user.username,
        name: user.name,
        image: user.image,
        inVoice: false,
      };
      lobby.members.set(socket.id, member);

      lobbies.set(lobbyId, lobby);
      socketToLobby.set(socket.id, lobbyId);
      socket.join(`lobby:${lobbyId}`);

      console.log(`🎮 Lobby created: ${lobbyId} by ${user.username || user.userId}`);

      // Notify friends of lobby join
      notifyFriendsOfLobbyUpdate(io, user.userId, socket.id, lobbyId, lobby.name);

      callback({
        success: true,
        lobby: {
          id: lobby.id,
          name: lobby.name,
          ownerId: lobby.ownerId,
          members: Array.from(lobby.members.values()),
          createdAt: lobby.createdAt,
        },
      });
    });

    // Join an existing lobby
    socket.on("lobby:join", (data: { lobbyId: string }, callback: (response: { success: boolean; lobby?: any; error?: string }) => void) => {
      const user = socketToUser.get(socket.id);
      if (!user) {
        callback({ success: false, error: "Not authenticated" });
        return;
      }

      // Check if user is already in a lobby
      const existingLobbyId = socketToLobby.get(socket.id);
      if (existingLobbyId) {
        callback({ success: false, error: "Already in a lobby" });
        return;
      }

      const lobby = lobbies.get(data.lobbyId);
      if (!lobby) {
        callback({ success: false, error: "Lobby not found" });
        return;
      }

      // Check max members (5 for voice)
      if (lobby.members.size >= 5) {
        callback({ success: false, error: "Lobby is full (max 5 members)" });
        return;
      }

      // Add member
      const member: LobbyMember = {
        odId: socket.id,
        userId: user.userId,
        username: user.username,
        name: user.name,
        image: user.image,
        inVoice: false,
      };
      lobby.members.set(socket.id, member);
      socketToLobby.set(socket.id, data.lobbyId);
      socket.join(`lobby:${data.lobbyId}`);

      console.log(`🎮 User ${user.username || user.userId} joined lobby ${data.lobbyId}`);

      // Notify other members
      socket.to(`lobby:${data.lobbyId}`).emit("lobby:memberJoined", {
        member,
        lobbyId: data.lobbyId,
      });

      // Notify friends of lobby join
      notifyFriendsOfLobbyUpdate(io, user.userId, socket.id, data.lobbyId, lobby.name);

      callback({
        success: true,
        lobby: {
          id: lobby.id,
          name: lobby.name,
          ownerId: lobby.ownerId,
          members: Array.from(lobby.members.values()),
          createdAt: lobby.createdAt,
        },
      });
    });

    // Leave current lobby
    socket.on("lobby:leave", (callback?: (response: { success: boolean }) => void) => {
      const lobbyId = socketToLobby.get(socket.id);
      if (!lobbyId) {
        callback?.({ success: false });
        return;
      }

      const lobby = lobbies.get(lobbyId);
      if (!lobby) {
        socketToLobby.delete(socket.id);
        callback?.({ success: false });
        return;
      }

      const member = lobby.members.get(socket.id);
      lobby.members.delete(socket.id);
      socketToLobby.delete(socket.id);
      socket.leave(`lobby:${lobbyId}`);

      console.log(`🎮 User left lobby ${lobbyId}`);

      // Notify friends that user left lobby
      if (member?.userId) {
        notifyFriendsOfLobbyUpdate(io, member.userId, socket.id, null, null);
      }

      // If lobby is empty, delete it
      if (lobby.members.size === 0) {
        lobbies.delete(lobbyId);
        console.log(`🎮 Lobby ${lobbyId} deleted (empty)`);
      } else {
        // If owner left, transfer ownership
        if (lobby.ownerSocketId === socket.id) {
          const newOwner = lobby.members.values().next().value;
          if (newOwner) {
            lobby.ownerId = newOwner.userId;
            lobby.ownerSocketId = newOwner.odId;
            io.to(`lobby:${lobbyId}`).emit("lobby:ownerChanged", {
              newOwnerId: newOwner.userId,
              lobbyId,
            });
          }
        }

        // Notify remaining members
        io.to(`lobby:${lobbyId}`).emit("lobby:memberLeft", {
          odId: socket.id,
          userId: member?.userId,
          lobbyId,
        });
      }

      callback?.({ success: true });
    });

    // Invite a friend to lobby
    socket.on("lobby:invite", (data: { friendSocketId: string }, callback: (response: { success: boolean; error?: string }) => void) => {
      const lobbyId = socketToLobby.get(socket.id);
      if (!lobbyId) {
        callback({ success: false, error: "Not in a lobby" });
        return;
      }

      const lobby = lobbies.get(lobbyId);
      if (!lobby) {
        callback({ success: false, error: "Lobby not found" });
        return;
      }

      const user = socketToUser.get(socket.id);

      // Send invite to friend
      io.to(data.friendSocketId).emit("lobby:invite", {
        lobbyId,
        lobbyName: lobby.name,
        invitedBy: {
          userId: user?.userId,
          username: user?.username,
          name: user?.name,
          image: user?.image,
        },
      });

      callback({ success: true });
    });

    // Get lobby info
    socket.on("lobby:info", (data: { lobbyId: string }, callback: (response: { success: boolean; lobby?: any; error?: string }) => void) => {
      const lobby = lobbies.get(data.lobbyId);
      if (!lobby) {
        callback({ success: false, error: "Lobby not found" });
        return;
      }

      callback({
        success: true,
        lobby: {
          id: lobby.id,
          name: lobby.name,
          ownerId: lobby.ownerId,
          members: Array.from(lobby.members.values()),
          createdAt: lobby.createdAt,
        },
      });
    });

    // ==========================================
    // Chat Event Handlers
    // ==========================================

    // Send chat message
    socket.on("chat:message", (data: { content: string }) => {
      const lobbyId = socketToLobby.get(socket.id);
      if (!lobbyId) return;

      const user = socketToUser.get(socket.id);
      if (!user) return;

      const message: ChatMessage = {
        id: generateMessageId(),
        odId: socket.id,
        userId: user.userId,
        username: user.username,
        name: user.name,
        image: user.image,
        content: data.content.slice(0, 1000), // Limit message length
        timestamp: Date.now(),
      };

      // Broadcast to all lobby members (including sender)
      io.to(`lobby:${lobbyId}`).emit("chat:message", message);
    });

    // Typing indicator
    socket.on("chat:typing", (data: { isTyping: boolean }) => {
      const lobbyId = socketToLobby.get(socket.id);
      if (!lobbyId) return;

      const user = socketToUser.get(socket.id);
      if (!user) return;

      // Broadcast to other members (not sender)
      socket.to(`lobby:${lobbyId}`).emit("chat:typing", {
        odId: socket.id,
        userId: user.userId,
        username: user.username,
        isTyping: data.isTyping,
      });
    });

    // ==========================================
    // Voice Chat Event Handlers (WebRTC Signaling)
    // ==========================================

    // Join voice channel
    socket.on("voice:join", () => {
      const lobbyId = socketToLobby.get(socket.id);
      if (!lobbyId) return;

      const lobby = lobbies.get(lobbyId);
      if (!lobby) return;

      const member = lobby.members.get(socket.id);
      if (!member) return;

      member.inVoice = true;

      // Get list of other members in voice
      const voiceMembers = Array.from(lobby.members.values()).filter(
        (m) => m.inVoice && m.odId !== socket.id
      );

      // Notify others that user joined voice
      socket.to(`lobby:${lobbyId}`).emit("voice:userJoined", {
        odId: socket.id,
        userId: member.userId,
        username: member.username,
        name: member.name,
        image: member.image,
      });

      // Send back list of current voice members (for WebRTC connections)
      socket.emit("voice:members", { members: voiceMembers });
    });

    // Leave voice channel
    socket.on("voice:leave", () => {
      const lobbyId = socketToLobby.get(socket.id);
      if (!lobbyId) return;

      const lobby = lobbies.get(lobbyId);
      if (!lobby) return;

      const member = lobby.members.get(socket.id);
      if (!member) return;

      member.inVoice = false;

      // Notify others
      socket.to(`lobby:${lobbyId}`).emit("voice:userLeft", {
        odId: socket.id,
        userId: member.userId,
      });
    });

    // WebRTC signaling: offer
    socket.on("voice:offer", (data: { targetSocketId: string; offer: RTCSessionDescriptionInit }) => {
      io.to(data.targetSocketId).emit("voice:offer", {
        fromSocketId: socket.id,
        offer: data.offer,
      });
    });

    // WebRTC signaling: answer
    socket.on("voice:answer", (data: { targetSocketId: string; answer: RTCSessionDescriptionInit }) => {
      io.to(data.targetSocketId).emit("voice:answer", {
        fromSocketId: socket.id,
        answer: data.answer,
      });
    });

    // WebRTC signaling: ICE candidate
    socket.on("voice:ice-candidate", (data: { targetSocketId: string; candidate: RTCIceCandidateInit }) => {
      io.to(data.targetSocketId).emit("voice:ice-candidate", {
        fromSocketId: socket.id,
        candidate: data.candidate,
      });
    });

    // Handle disconnection
    socket.on("disconnect", async () => {
      const user = socketToUser.get(socket.id);

      // Clean up lobby membership
      const lobbyId = socketToLobby.get(socket.id);
      if (lobbyId) {
        const lobby = lobbies.get(lobbyId);
        if (lobby) {
          const member = lobby.members.get(socket.id);
          lobby.members.delete(socket.id);

          // Notify voice leave if in voice
          if (member?.inVoice) {
            io.to(`lobby:${lobbyId}`).emit("voice:userLeft", {
              odId: socket.id,
              userId: member.userId,
            });
          }

          // If lobby is empty, delete it
          if (lobby.members.size === 0) {
            lobbies.delete(lobbyId);
            console.log(`🎮 Lobby ${lobbyId} deleted (empty after disconnect)`);
          } else {
            // Transfer ownership if needed
            if (lobby.ownerSocketId === socket.id) {
              const newOwner = lobby.members.values().next().value;
              if (newOwner) {
                lobby.ownerId = newOwner.userId;
                lobby.ownerSocketId = newOwner.odId;
                io.to(`lobby:${lobbyId}`).emit("lobby:ownerChanged", {
                  newOwnerId: newOwner.userId,
                  lobbyId,
                });
              }
            }

            // Notify remaining members
            io.to(`lobby:${lobbyId}`).emit("lobby:memberLeft", {
              odId: socket.id,
              userId: member?.userId,
              lobbyId,
            });
          }
        }
        socketToLobby.delete(socket.id);
      }

      // Notify friends that user went offline
      if (user) {
        try {
          const friendships = await prisma.friendship.findMany({
            where: { userId: user.userId },
            select: { friendId: true },
          });
          const friendIds = friendships.map((f) => f.friendId);

          for (const [socketId, userData] of socketToUser.entries()) {
            if (friendIds.includes(userData.userId)) {
              io.to(socketId).emit("friends:userOffline", {
                odId: socket.id,
                userId: user.userId,
              });
            }
          }
        } catch (error) {
          console.error("Failed to notify friends of user offline:", error);
        }
      }

      socketToUser.delete(socket.id);
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

    // LIVE: Forward individual trade events to token subscribers
    // This enables real-time trade feeds on token pages
    pumpPortalService.on("trade", (trade) => {
      // Broadcast to token-specific room
      io.to(`token:${trade.mint}`).emit("trade", {
        mint: trade.mint,
        type: trade.txType,
        tokenAmount: trade.tokenAmount,
        solAmount: trade.solAmount,
        marketCapSol: trade.marketCapSol,
        trader: trade.traderPublicKey,
        signature: trade.signature,
        timestamp: trade.timestamp || Date.now(),
      });

      // Also broadcast to pulse room for live activity feed
      io.to("pulse").emit("pulse:trade", {
        mint: trade.mint,
        type: trade.txType,
        solAmount: trade.solAmount,
        marketCapSol: trade.marketCapSol,
        timestamp: trade.timestamp || Date.now(),
      });
    });

    // LIVE: Forward 1-second OHLCV updates to token subscribers
    // This enables real-time chart updates without polling
    pumpPortalService.on("ohlcv:update", (data) => {
      io.to(`token:${data.mint}`).emit("ohlcv:update", {
        mint: data.mint,
        candle: data.candle,
      });
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
