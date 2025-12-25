import { Server, Socket } from "socket.io";
import { pumpPortalService } from "../services/pumpportal";
import { meteoraService } from "../services/meteora";
import { getGrpcService } from "../grpc";
import { Timeframe } from "../ohlcv";
import { prisma } from "../lib/prisma";
import crypto from "crypto";

// ==========================================
// Rate Limiting
// ==========================================

interface RateLimitState {
  messageCount: number;
  messageWindowStart: number;
  lobbyActionCount: number;
  lobbyActionWindowStart: number;
}

const rateLimits = new Map<string, RateLimitState>();

const RATE_LIMITS = {
  messages: { max: 10, windowMs: 5000 },       // 10 messages per 5 seconds
  lobbyActions: { max: 5, windowMs: 10000 },   // 5 lobby actions per 10 seconds
};

function checkRateLimit(socketId: string, type: "messages" | "lobbyActions"): boolean {
  let state = rateLimits.get(socketId);
  if (!state) {
    state = {
      messageCount: 0,
      messageWindowStart: Date.now(),
      lobbyActionCount: 0,
      lobbyActionWindowStart: Date.now(),
    };
    rateLimits.set(socketId, state);
  }

  const now = Date.now();
  const limit = RATE_LIMITS[type];

  if (type === "messages") {
    if (now - state.messageWindowStart > limit.windowMs) {
      state.messageCount = 0;
      state.messageWindowStart = now;
    }
    state.messageCount++;
    return state.messageCount <= limit.max;
  } else {
    if (now - state.lobbyActionWindowStart > limit.windowMs) {
      state.lobbyActionCount = 0;
      state.lobbyActionWindowStart = now;
    }
    state.lobbyActionCount++;
    return state.lobbyActionCount <= limit.max;
  }
}

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
const userIdToLobby = new Map<string, string>(); // userId -> lobbyId (for reconnection)
const socketToUser = new Map<string, { userId: string; username: string | null; name: string | null; image: string | null }>();

// Track pending join requests: lobbyId -> Map<requestingSocketId, requesterInfo>
interface JoinRequest {
  socketId: string;
  userId: string;
  username: string | null;
  name: string | null;
  image: string | null;
  timestamp: number;
}
const pendingJoinRequests = new Map<string, Map<string, JoinRequest>>();

function generateLobbyId(): string {
  // Use cryptographically secure random bytes
  return crypto.randomBytes(4).toString("hex").toUpperCase();
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
      // Verify user exists in database (prevents impersonation with fake userIds)
      try {
        const user = await prisma.user.findUnique({
          where: { id: data.userId },
          select: { id: true, name: true, image: true },
        });

        if (!user) {
          console.warn(`🎮 Auth failed: User ${data.userId} not found in database`);
          socket.emit("lobby:authError", { error: "User not found" });
          return;
        }

        // Use server-verified data (except username which comes from Profile table in web app)
        socketToUser.set(socket.id, {
          userId: user.id,
          username: data.username, // Username comes from client but userId is verified
          name: user.name,
          image: user.image,
        });
        console.log(`🎮 User authenticated for lobbies: ${data.username || user.id}`);

        // Check if user was in a lobby (reconnection scenario)
        let currentLobbyData = null;
        const existingLobbyId = userIdToLobby.get(user.id);
        if (existingLobbyId) {
          const lobby = lobbies.get(existingLobbyId);
          if (lobby) {
            // User was in a lobby - update their socket ID in the lobby
            const oldMember = Array.from(lobby.members.values()).find(m => m.userId === user.id);
            if (oldMember) {
              // Remove old socket mapping and member entry
              lobby.members.delete(oldMember.odId);
              socketToLobby.delete(oldMember.odId);

              // Add new member entry with new socket ID
              const newMember: LobbyMember = {
                ...oldMember,
                odId: socket.id,
                inVoice: false, // Reset voice state on reconnect
              };
              lobby.members.set(socket.id, newMember);
              socketToLobby.set(socket.id, existingLobbyId);

              // Update owner socket ID if this user is the owner
              if (lobby.ownerId === user.id) {
                lobby.ownerSocketId = socket.id;
              }

              // Join the lobby room
              socket.join(`lobby:${existingLobbyId}`);

              // Notify other members of the reconnection
              socket.to(`lobby:${existingLobbyId}`).emit("lobby:memberReconnected", {
                member: newMember,
                oldOdId: oldMember.odId,
              });

              currentLobbyData = {
                id: lobby.id,
                name: lobby.name,
                ownerId: lobby.ownerId,
                members: Array.from(lobby.members.values()),
                createdAt: lobby.createdAt,
              };

              console.log(`🎮 User ${data.username || user.id} reconnected to lobby ${lobby.name}`);
            }
          } else {
            // Lobby no longer exists, clean up
            userIdToLobby.delete(user.id);
          }
        }

        // Notify friends that this user is online
        const friendships = await prisma.friendship.findMany({
          where: { userId: user.id },
          select: { friendId: true },
        });
        const friendIds = friendships.map((f) => f.friendId);

        // Find which friends are online and notify them
        const onlineFriends: any[] = [];
        for (const [socketId, userData] of socketToUser.entries()) {
          if (friendIds.includes(userData.userId)) {
            // Notify each friend that this user came online (with lobby info if applicable)
            io.to(socketId).emit("friends:userOnline", {
              odId: socket.id,
              userId: user.id,
              username: data.username,
              name: user.name,
              image: user.image,
              lobbyId: currentLobbyData?.id || null,
              lobbyName: currentLobbyData?.name || null,
            });

            // Also collect online friends to send back to the authenticating user
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

        // Send auth success with online friends list and restored lobby (fixes timing issue)
        socket.emit("lobby:authSuccess", { onlineFriends, currentLobby: currentLobbyData });
      } catch (error) {
        console.error("Failed to authenticate user for lobbies:", error);
        socket.emit("lobby:authError", { error: "Authentication failed" });
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

    // Notify a user they received a friend request
    socket.on("friends:requestSent", (data: { receiverId: string; request: any }) => {
      const sender = socketToUser.get(socket.id);
      if (!sender) return;

      // Find if receiver is online
      for (const [socketId, userData] of socketToUser.entries()) {
        if (userData.userId === data.receiverId) {
          io.to(socketId).emit("friends:requestReceived", {
            id: data.request.id,
            sender: {
              id: sender.userId,
              username: sender.username,
              name: sender.name,
              image: sender.image,
            },
          });
          break;
        }
      }
    });

    // Notify a user their friend request was accepted (they're now friends)
    socket.on("friends:requestAccepted", (data: { senderId: string; friend: any }) => {
      const accepter = socketToUser.get(socket.id);
      if (!accepter) return;

      // Find if original sender is online
      for (const [socketId, userData] of socketToUser.entries()) {
        if (userData.userId === data.senderId) {
          io.to(socketId).emit("friends:newFriend", {
            friend: data.friend,
            acceptedBy: {
              id: accepter.userId,
              username: accepter.username,
              name: accepter.name,
              image: accepter.image,
            },
          });
          break;
        }
      }
    });

    // Notify a user they were removed as a friend
    socket.on("friends:removed", (data: { friendId: string }) => {
      const remover = socketToUser.get(socket.id);
      if (!remover) return;

      // Find if the removed friend is online
      for (const [socketId, userData] of socketToUser.entries()) {
        if (userData.userId === data.friendId) {
          io.to(socketId).emit("friends:wasRemoved", {
            removedBy: {
              id: remover.userId,
              username: remover.username,
              name: remover.name,
              image: remover.image,
            },
          });
          break;
        }
      }
    });

    // Broadcast profile update to friends and lobby members
    socket.on("profile:updated", async (data: { name?: string; username?: string; image?: string }) => {
      const user = socketToUser.get(socket.id);
      if (!user) return;

      // Update local cache
      if (data.name !== undefined) user.name = data.name;
      if (data.username !== undefined) user.username = data.username;
      if (data.image !== undefined) user.image = data.image;

      // Notify friends of profile update
      try {
        const friendships = await prisma.friendship.findMany({
          where: { userId: user.userId },
          select: { friendId: true },
        });
        const friendIds = friendships.map((f) => f.friendId);

        for (const [socketId, userData] of socketToUser.entries()) {
          if (friendIds.includes(userData.userId)) {
            io.to(socketId).emit("friends:profileUpdated", {
              odId: socket.id,
              userId: user.userId,
              name: user.name,
              username: user.username,
              image: user.image,
            });
          }
        }
      } catch (error) {
        console.error("Failed to notify friends of profile update:", error);
      }

      // Notify lobby members of profile update
      const lobbyId = socketToLobby.get(socket.id);
      if (lobbyId) {
        const lobby = lobbies.get(lobbyId);
        if (lobby) {
          // Update member info in lobby
          const member = lobby.members.get(socket.id);
          if (member) {
            if (data.name !== undefined) member.name = data.name;
            if (data.username !== undefined) member.username = data.username;
            if (data.image !== undefined) member.image = data.image;
          }

          // Notify other lobby members
          socket.to(`lobby:${lobbyId}`).emit("lobby:memberProfileUpdated", {
            odId: socket.id,
            userId: user.userId,
            name: user.name,
            username: user.username,
            image: user.image,
          });
        }
      }
    });

    // Create a new lobby
    socket.on("lobby:create", (data: { name: string }, callback: (response: { success: boolean; lobby?: any; error?: string }) => void) => {
      // Rate limit lobby actions
      if (!checkRateLimit(socket.id, "lobbyActions")) {
        callback({ success: false, error: "Too many requests. Please wait." });
        return;
      }

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

      // Sanitize lobby name (prevent XSS)
      const sanitizedName = (data.name || `${user.username || user.name}'s Lobby`)
        .slice(0, 50)
        .replace(/[<>&"']/g, "");

      const lobbyId = generateLobbyId();
      const lobby: Lobby = {
        id: lobbyId,
        name: sanitizedName,
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
      userIdToLobby.set(user.userId, lobbyId); // Track by userId for reconnection
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

    // Join an existing lobby (only via invite acceptance - used internally after invite)
    socket.on("lobby:join", (data: { lobbyId: string; fromInvite?: boolean }, callback: (response: { success: boolean; lobby?: any; error?: string }) => void) => {
      // Rate limit lobby actions
      if (!checkRateLimit(socket.id, "lobbyActions")) {
        callback({ success: false, error: "Too many requests. Please wait." });
        return;
      }

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
      userIdToLobby.set(user.userId, data.lobbyId); // Track by userId for reconnection
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

    // Request to join a friend's lobby
    socket.on("lobby:requestJoin", (data: { lobbyId: string }, callback: (response: { success: boolean; error?: string }) => void) => {
      // Rate limit lobby actions
      if (!checkRateLimit(socket.id, "lobbyActions")) {
        callback({ success: false, error: "Too many requests. Please wait." });
        return;
      }

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

      // Initialize pending requests map for this lobby if needed
      if (!pendingJoinRequests.has(data.lobbyId)) {
        pendingJoinRequests.set(data.lobbyId, new Map());
      }

      const lobbyRequests = pendingJoinRequests.get(data.lobbyId)!;

      // Check if already requested
      if (lobbyRequests.has(socket.id)) {
        callback({ success: false, error: "Join request already pending" });
        return;
      }

      // Add join request
      const request: JoinRequest = {
        socketId: socket.id,
        userId: user.userId,
        username: user.username,
        name: user.name,
        image: user.image,
        timestamp: Date.now(),
      };
      lobbyRequests.set(socket.id, request);

      console.log(`🎮 User ${user.username || user.userId} requested to join lobby ${data.lobbyId}`);

      // Notify lobby owner of the join request
      io.to(lobby.ownerSocketId).emit("lobby:joinRequest", {
        lobbyId: data.lobbyId,
        requester: request,
      });

      callback({ success: true });
    });

    // Accept a join request (owner only)
    socket.on("lobby:acceptJoin", (data: { requesterSocketId: string }, callback: (response: { success: boolean; error?: string }) => void) => {
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

      // Only owner can accept
      if (lobby.ownerSocketId !== socket.id) {
        callback({ success: false, error: "Only the lobby owner can accept join requests" });
        return;
      }

      const lobbyRequests = pendingJoinRequests.get(lobbyId);
      if (!lobbyRequests) {
        callback({ success: false, error: "Join request not found" });
        return;
      }

      const request = lobbyRequests.get(data.requesterSocketId);
      if (!request) {
        callback({ success: false, error: "Join request not found" });
        return;
      }

      // Check max members
      if (lobby.members.size >= 5) {
        callback({ success: false, error: "Lobby is full" });
        return;
      }

      // Remove from pending requests
      lobbyRequests.delete(data.requesterSocketId);

      // Tell the requester they were accepted
      io.to(data.requesterSocketId).emit("lobby:joinAccepted", {
        lobbyId,
        lobbyName: lobby.name,
      });

      console.log(`🎮 Join request accepted for ${request.username || request.userId} to lobby ${lobbyId}`);
      callback({ success: true });
    });

    // Deny a join request (owner only)
    socket.on("lobby:denyJoin", (data: { requesterSocketId: string }, callback: (response: { success: boolean; error?: string }) => void) => {
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

      // Only owner can deny
      if (lobby.ownerSocketId !== socket.id) {
        callback({ success: false, error: "Only the lobby owner can deny join requests" });
        return;
      }

      const lobbyRequests = pendingJoinRequests.get(lobbyId);
      if (!lobbyRequests) {
        callback({ success: false, error: "Join request not found" });
        return;
      }

      const request = lobbyRequests.get(data.requesterSocketId);
      if (!request) {
        callback({ success: false, error: "Join request not found" });
        return;
      }

      // Remove from pending requests
      lobbyRequests.delete(data.requesterSocketId);

      // Tell the requester they were denied
      io.to(data.requesterSocketId).emit("lobby:joinDenied", {
        lobbyId,
        lobbyName: lobby.name,
      });

      console.log(`🎮 Join request denied for ${request.username || request.userId} to lobby ${lobbyId}`);
      callback({ success: true });
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
      if (member?.userId) {
        userIdToLobby.delete(member.userId); // Clear userId tracking
      }
      socket.leave(`lobby:${lobbyId}`);

      console.log(`🎮 User left lobby ${lobbyId}`);

      // Notify friends that user left lobby
      if (member?.userId) {
        notifyFriendsOfLobbyUpdate(io, member.userId, socket.id, null, null);
      }

      // If owner left, shut down the entire lobby and kick everyone
      if (lobby.ownerSocketId === socket.id) {
        // Notify all remaining members that lobby is shutting down
        io.to(`lobby:${lobbyId}`).emit("lobby:shutdown", {
          lobbyId,
          reason: "Host left the lobby",
        });

        // Remove all remaining members from the lobby
        for (const [memberSocketId, memberData] of lobby.members) {
          socketToLobby.delete(memberSocketId);
          if (memberData?.userId) {
            userIdToLobby.delete(memberData.userId); // Clear userId tracking
          }
          const memberSocket = io.sockets.sockets.get(memberSocketId);
          if (memberSocket) {
            memberSocket.leave(`lobby:${lobbyId}`);
          }
          // Notify friends that member left lobby
          if (memberData?.userId) {
            notifyFriendsOfLobbyUpdate(io, memberData.userId, memberSocketId, null, null);
          }
        }

        // Delete the lobby
        lobbies.delete(lobbyId);
        // Clean up pending join requests for this lobby
        pendingJoinRequests.delete(lobbyId);
        console.log(`🎮 Lobby ${lobbyId} shut down (host left)`);
      } else if (lobby.members.size === 0) {
        // If lobby is empty, delete it
        lobbies.delete(lobbyId);
        pendingJoinRequests.delete(lobbyId);
        console.log(`🎮 Lobby ${lobbyId} deleted (empty)`);
      } else {
        // Notify remaining members that someone left
        io.to(`lobby:${lobbyId}`).emit("lobby:memberLeft", {
          odId: socket.id,
          userId: member?.userId,
          lobbyId,
        });
      }

      callback?.({ success: true });
    });

    // Kick a member from lobby (owner only)
    socket.on("lobby:kick", (data: { targetSocketId: string }, callback: (response: { success: boolean; error?: string }) => void) => {
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

      // Only owner can kick
      if (lobby.ownerSocketId !== socket.id) {
        callback({ success: false, error: "Only the lobby owner can kick members" });
        return;
      }

      // Can't kick yourself
      if (data.targetSocketId === socket.id) {
        callback({ success: false, error: "You can't kick yourself" });
        return;
      }

      const targetMember = lobby.members.get(data.targetSocketId);
      if (!targetMember) {
        callback({ success: false, error: "Member not found" });
        return;
      }

      // Remove member
      lobby.members.delete(data.targetSocketId);
      socketToLobby.delete(data.targetSocketId);
      if (targetMember.userId) {
        userIdToLobby.delete(targetMember.userId); // Clear userId tracking
      }

      // Get the target socket and make them leave the room
      const targetSocket = io.sockets.sockets.get(data.targetSocketId);
      if (targetSocket) {
        targetSocket.leave(`lobby:${lobbyId}`);
        targetSocket.emit("lobby:kicked", { lobbyId, lobbyName: lobby.name });
      }

      // Notify friends of the kicked user
      if (targetMember.userId) {
        notifyFriendsOfLobbyUpdate(io, targetMember.userId, data.targetSocketId, null, null);
      }

      // Notify remaining members
      io.to(`lobby:${lobbyId}`).emit("lobby:memberLeft", {
        odId: data.targetSocketId,
        userId: targetMember.userId,
        lobbyId,
        kicked: true,
      });

      console.log(`🎮 User ${targetMember.username || targetMember.userId} was kicked from lobby ${lobbyId}`);
      callback({ success: true });
    });

    // Invite a friend to lobby
    socket.on("lobby:invite", async (data: { friendSocketId: string }, callback: (response: { success: boolean; error?: string }) => void) => {
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
      if (!user) {
        callback({ success: false, error: "Not authenticated" });
        return;
      }

      // Verify the target socket belongs to a friend
      const targetUser = socketToUser.get(data.friendSocketId);
      if (!targetUser) {
        callback({ success: false, error: "User not found" });
        return;
      }

      // Verify friendship exists
      try {
        const friendship = await prisma.friendship.findFirst({
          where: {
            userId: user.userId,
            friendId: targetUser.userId,
          },
        });

        if (!friendship) {
          callback({ success: false, error: "You can only invite friends" });
          return;
        }
      } catch (error) {
        console.error("Failed to verify friendship:", error);
        callback({ success: false, error: "Failed to verify friendship" });
        return;
      }

      // Send invite to friend
      io.to(data.friendSocketId).emit("lobby:invite", {
        lobbyId,
        lobbyName: lobby.name,
        invitedBy: {
          odId: socket.id,
          userId: user.userId,
          username: user.username,
          name: user.name,
          image: user.image,
        },
        timestamp: Date.now(),
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
      // Rate limit messages
      if (!checkRateLimit(socket.id, "messages")) {
        socket.emit("chat:error", { error: "Slow down! You're sending messages too fast." });
        return;
      }

      const lobbyId = socketToLobby.get(socket.id);
      if (!lobbyId) return;

      const user = socketToUser.get(socket.id);
      if (!user) return;

      // Sanitize message content (basic XSS prevention)
      const sanitizedContent = data.content
        .slice(0, 1000)
        .replace(/[<>]/g, ""); // Remove < and > to prevent HTML injection

      const message: ChatMessage = {
        id: generateMessageId(),
        odId: socket.id,
        userId: user.userId,
        username: user.username,
        name: user.name,
        image: user.image,
        content: sanitizedContent,
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

      // Clean up lobby membership - but DON'T clear userIdToLobby (allow reconnection)
      const lobbyId = socketToLobby.get(socket.id);
      if (lobbyId) {
        const lobby = lobbies.get(lobbyId);
        if (lobby) {
          const member = lobby.members.get(socket.id);

          // Notify voice leave if in voice
          if (member?.inVoice) {
            io.to(`lobby:${lobbyId}`).emit("voice:userLeft", {
              odId: socket.id,
              userId: member.userId,
            });
          }

          // If owner disconnected, shut down the entire lobby and kick everyone
          // (owners can't reconnect since others would be waiting)
          if (lobby.ownerSocketId === socket.id) {
            // Clear the owner's mapping since lobby is shutting down
            if (member?.userId) {
              userIdToLobby.delete(member.userId);
            }
            lobby.members.delete(socket.id);

            // Notify all remaining members that lobby is shutting down
            io.to(`lobby:${lobbyId}`).emit("lobby:shutdown", {
              lobbyId,
              reason: "Host disconnected",
            });

            // Remove all remaining members from the lobby
            for (const [memberSocketId, memberData] of lobby.members) {
              socketToLobby.delete(memberSocketId);
              if (memberData?.userId) {
                userIdToLobby.delete(memberData.userId); // Clear since lobby is gone
              }
              const memberSocket = io.sockets.sockets.get(memberSocketId);
              if (memberSocket) {
                memberSocket.leave(`lobby:${lobbyId}`);
              }
              // Notify friends that member left lobby
              if (memberData?.userId) {
                notifyFriendsOfLobbyUpdate(io, memberData.userId, memberSocketId, null, null);
              }
            }

            // Delete the lobby
            lobbies.delete(lobbyId);
            pendingJoinRequests.delete(lobbyId);
            console.log(`🎮 Lobby ${lobbyId} shut down (host disconnected)`);
          } else {
            // Non-owner disconnected - DON'T remove them yet (allow reconnection)
            // Just notify remaining members they went offline temporarily
            io.to(`lobby:${lobbyId}`).emit("lobby:memberDisconnected", {
              odId: socket.id,
              userId: member?.userId,
              lobbyId,
            });
            console.log(`🎮 User ${member?.username || member?.userId} disconnected from lobby ${lobbyId} (may reconnect)`);
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
      rateLimits.delete(socket.id);
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
