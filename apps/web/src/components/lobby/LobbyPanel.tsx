"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Users, Plus, MessageCircle, Send, Mic, MicOff, PhoneOff, Crown, LogOut, User, VolumeX, Volume2 } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { useLobbyStore, LobbyMember, ChatMessage, LobbyInvite } from "@/stores/lobbyStore";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { io, Socket } from "socket.io-client";
import { useVoiceChat } from "@/hooks/useVoiceChat";

interface LobbyPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LobbyPanel({ isOpen, onClose }: LobbyPanelProps) {
  const { isDark } = useThemeStore();
  const { data: session } = useSession();
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    currentLobby,
    messages,
    typingUsers,
    pendingInvites,
    inVoice,
    voiceMembers,
    setCurrentLobby,
    addMember,
    removeMember,
    addMessage,
    setTyping,
    addInvite,
    removeInvite,
    setInVoice,
    setVoiceMembers,
    addVoiceMember,
    removeVoiceMember,
    reset,
  } = useLobbyStore();

  const [lobbyName, setLobbyName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showJoinForm, setShowJoinForm] = useState(false);

  // Voice chat hook
  const {
    isMuted,
    isDeafened,
    toggleMute,
    toggleDeafen,
  } = useVoiceChat({
    socket: socketRef.current,
    inVoice,
    onVoiceMemberJoined: addVoiceMember,
    onVoiceMemberLeft: removeVoiceMember,
  });

  // Initialize socket connection
  useEffect(() => {
    if (!session?.user?.id) return;

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";
    const socket = io(wsUrl, { transports: ["websocket"] });
    socketRef.current = socket;

    // Authenticate for lobby features
    socket.on("connect", () => {
      socket.emit("lobby:auth", {
        userId: session.user.id,
        username: (session.user as any).username || null,
        name: session.user.name,
        image: session.user.image,
      });
    });

    // Lobby events
    socket.on("lobby:memberJoined", ({ member }: { member: LobbyMember }) => {
      addMember(member);
    });

    socket.on("lobby:memberLeft", ({ odId }: { odId: string }) => {
      removeMember(odId);
    });

    socket.on("lobby:ownerChanged", ({ newOwnerId }: { newOwnerId: string }) => {
      const lobby = useLobbyStore.getState().currentLobby;
      if (lobby) {
        setCurrentLobby({ ...lobby, ownerId: newOwnerId });
      }
    });

    socket.on("lobby:invite", (invite: LobbyInvite) => {
      addInvite(invite);
    });

    // Chat events
    socket.on("chat:message", (message: ChatMessage) => {
      addMessage(message);
    });

    socket.on("chat:typing", ({ odId, username, isTyping }: { odId: string; username: string | null; isTyping: boolean }) => {
      setTyping(odId, username, isTyping);
    });

    // Voice events
    socket.on("voice:userJoined", (member: LobbyMember) => {
      addVoiceMember({ ...member, inVoice: true });
    });

    socket.on("voice:userLeft", ({ odId }: { odId: string }) => {
      removeVoiceMember(odId);
    });

    socket.on("voice:members", ({ members }: { members: LobbyMember[] }) => {
      setVoiceMembers(members);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session?.user?.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleCreate = useCallback(() => {
    if (!socketRef.current) return;
    setIsCreating(true);
    setError(null);

    socketRef.current.emit(
      "lobby:create",
      { name: lobbyName || `${session?.user?.name || "User"}'s Lobby` },
      (response: { success: boolean; lobby?: any; error?: string }) => {
        setIsCreating(false);
        if (response.success && response.lobby) {
          setCurrentLobby(response.lobby);
          setLobbyName("");
          setShowCreateForm(false);
        } else {
          setError(response.error || "Failed to create lobby");
        }
      }
    );
  }, [lobbyName, session?.user?.name, setCurrentLobby]);

  const handleJoin = useCallback(() => {
    if (!socketRef.current || !joinCode.trim()) return;
    setIsJoining(true);
    setError(null);

    socketRef.current.emit(
      "lobby:join",
      { lobbyId: joinCode.trim() },
      (response: { success: boolean; lobby?: any; error?: string }) => {
        setIsJoining(false);
        if (response.success && response.lobby) {
          setCurrentLobby(response.lobby);
          setJoinCode("");
          setShowJoinForm(false);
        } else {
          setError(response.error || "Failed to join lobby");
        }
      }
    );
  }, [joinCode, setCurrentLobby]);

  const handleLeave = useCallback(() => {
    if (!socketRef.current) return;

    socketRef.current.emit("lobby:leave", () => {
      reset();
    });
  }, [reset]);

  const handleSendMessage = useCallback(() => {
    if (!socketRef.current || !messageInput.trim()) return;

    socketRef.current.emit("chat:message", { content: messageInput.trim() });
    setMessageInput("");
  }, [messageInput]);

  const handleJoinVoice = useCallback(() => {
    if (!socketRef.current) return;
    socketRef.current.emit("voice:join");
    setInVoice(true);
  }, [setInVoice]);

  const handleLeaveVoice = useCallback(() => {
    if (!socketRef.current) return;
    socketRef.current.emit("voice:leave");
    setInVoice(false);
    setVoiceMembers([]);
  }, [setInVoice, setVoiceMembers]);

  const handleAcceptInvite = useCallback((lobbyId: string) => {
    if (!socketRef.current) return;
    removeInvite(lobbyId);

    socketRef.current.emit(
      "lobby:join",
      { lobbyId },
      (response: { success: boolean; lobby?: any; error?: string }) => {
        if (response.success && response.lobby) {
          setCurrentLobby(response.lobby);
        } else {
          setError(response.error || "Failed to join lobby");
        }
      }
    );
  }, [removeInvite, setCurrentLobby]);

  const handleDeclineInvite = useCallback((lobbyId: string) => {
    removeInvite(lobbyId);
  }, [removeInvite]);

  // Typing indicator
  const typingTimeout = useRef<NodeJS.Timeout | null>(null);
  const handleTyping = useCallback(() => {
    if (!socketRef.current) return;

    socketRef.current.emit("chat:typing", { isTyping: true });

    if (typingTimeout.current) {
      clearTimeout(typingTimeout.current);
    }
    typingTimeout.current = setTimeout(() => {
      socketRef.current?.emit("chat:typing", { isTyping: false });
    }, 2000);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-y-0 right-0 w-96 z-50 transform transition-transform duration-300 ${
        isOpen ? "translate-x-0" : "translate-x-full"
      } ${isDark ? "bg-[#0D0D0D]" : "bg-white"} border-l ${
        isDark ? "border-white/10" : "border-gray-200"
      } flex flex-col`}
    >
      {/* Header */}
      <div className={`p-4 border-b ${isDark ? "border-white/10" : "border-gray-200"} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <Users className={`h-5 w-5 ${isDark ? "text-white" : "text-gray-900"}`} />
          <h2 className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
            {currentLobby ? currentLobby.name : "Lobbies"}
          </h2>
        </div>
        <button
          onClick={onClose}
          className={`p-2 rounded-lg transition-colors ${
            isDark ? "hover:bg-white/10 text-white/60" : "hover:bg-gray-100 text-gray-500"
          }`}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && !currentLobby && (
        <div className={`p-3 border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
          <p className={`text-xs font-medium mb-2 ${isDark ? "text-white/60" : "text-gray-500"}`}>
            Pending Invites
          </p>
          {pendingInvites.map((invite) => (
            <div
              key={invite.lobbyId}
              className={`p-3 rounded-lg mb-2 ${isDark ? "bg-white/5" : "bg-gray-50"}`}
            >
              <p className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                {invite.lobbyName}
              </p>
              <p className={`text-xs ${isDark ? "text-white/50" : "text-gray-500"}`}>
                From {invite.invitedBy.name || invite.invitedBy.username}
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => handleAcceptInvite(invite.lobbyId)}
                  className="flex-1 py-1 rounded bg-[#FF6B4A] text-white text-xs font-medium hover:bg-[#FF8F6B]"
                >
                  Accept
                </button>
                <button
                  onClick={() => handleDeclineInvite(invite.lobbyId)}
                  className={`flex-1 py-1 rounded text-xs font-medium ${
                    isDark ? "bg-white/10 text-white/60" : "bg-gray-200 text-gray-600"
                  }`}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {!currentLobby ? (
          // Lobby Selection View
          <div className="p-4 space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Create Lobby */}
            {!showJoinForm && (
              <div className={`p-4 rounded-lg ${isDark ? "bg-white/5" : "bg-gray-50"}`}>
                {showCreateForm ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={lobbyName}
                      onChange={(e) => setLobbyName(e.target.value)}
                      placeholder="Lobby name (optional)"
                      className={`w-full px-3 py-2 rounded-lg border text-sm ${
                        isDark
                          ? "bg-white/5 border-white/10 text-white placeholder:text-white/30"
                          : "bg-white border-gray-200 text-gray-900 placeholder:text-gray-400"
                      }`}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleCreate}
                        disabled={isCreating}
                        className="flex-1 py-2 rounded-lg bg-[#FF6B4A] text-white text-sm font-medium hover:bg-[#FF8F6B] disabled:opacity-50"
                      >
                        {isCreating ? "Creating..." : "Create"}
                      </button>
                      <button
                        onClick={() => setShowCreateForm(false)}
                        className={`px-4 py-2 rounded-lg text-sm ${
                          isDark ? "bg-white/10 text-white/60" : "bg-gray-200 text-gray-600"
                        }`}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className={`w-full py-3 rounded-lg flex items-center justify-center gap-2 transition-colors ${
                      isDark
                        ? "bg-white/10 text-white hover:bg-white/20"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    <Plus className="h-5 w-5" />
                    Create Lobby
                  </button>
                )}
              </div>
            )}

            {/* Join Lobby */}
            {!showCreateForm && (
              <div className={`p-4 rounded-lg ${isDark ? "bg-white/5" : "bg-gray-50"}`}>
                {showJoinForm ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value)}
                      placeholder="Enter lobby code"
                      className={`w-full px-3 py-2 rounded-lg border text-sm ${
                        isDark
                          ? "bg-white/5 border-white/10 text-white placeholder:text-white/30"
                          : "bg-white border-gray-200 text-gray-900 placeholder:text-gray-400"
                      }`}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleJoin}
                        disabled={isJoining || !joinCode.trim()}
                        className="flex-1 py-2 rounded-lg bg-[#FF6B4A] text-white text-sm font-medium hover:bg-[#FF8F6B] disabled:opacity-50"
                      >
                        {isJoining ? "Joining..." : "Join"}
                      </button>
                      <button
                        onClick={() => setShowJoinForm(false)}
                        className={`px-4 py-2 rounded-lg text-sm ${
                          isDark ? "bg-white/10 text-white/60" : "bg-gray-200 text-gray-600"
                        }`}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowJoinForm(true)}
                    className={`w-full py-3 rounded-lg flex items-center justify-center gap-2 transition-colors ${
                      isDark
                        ? "bg-white/10 text-white hover:bg-white/20"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    <Users className="h-5 w-5" />
                    Join Lobby
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          // Active Lobby View
          <>
            {/* Lobby Code */}
            <div className={`p-3 border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
              <p className={`text-xs ${isDark ? "text-white/50" : "text-gray-500"}`}>
                Lobby Code: <span className="font-mono font-medium">{currentLobby.id}</span>
              </p>
            </div>

            {/* Members */}
            <div className={`p-3 border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
              <p className={`text-xs font-medium mb-2 ${isDark ? "text-white/60" : "text-gray-500"}`}>
                Members ({currentLobby.members.length}/5)
              </p>
              <div className="flex flex-wrap gap-2">
                {currentLobby.members.map((member) => (
                  <div
                    key={member.odId}
                    className={`flex items-center gap-2 px-2 py-1 rounded-full ${
                      isDark ? "bg-white/10" : "bg-gray-100"
                    }`}
                  >
                    {member.image ? (
                      <Image
                        src={member.image}
                        alt={member.name || "User"}
                        width={20}
                        height={20}
                        className="w-5 h-5 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF8F6B] flex items-center justify-center">
                        <User className="h-3 w-3 text-white" />
                      </div>
                    )}
                    <span className={`text-xs ${isDark ? "text-white" : "text-gray-900"}`}>
                      {member.name || member.username || "User"}
                    </span>
                    {member.userId === currentLobby.ownerId && (
                      <Crown className="h-3 w-3 text-yellow-500" />
                    )}
                    {member.inVoice && (
                      <Mic className="h-3 w-3 text-green-500" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Voice Controls */}
            <div className={`p-3 border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
              <div className="flex gap-2">
                {!inVoice ? (
                  <button
                    onClick={handleJoinVoice}
                    className="flex-1 py-2 rounded-lg bg-green-500/20 text-green-400 text-sm font-medium flex items-center justify-center gap-2 hover:bg-green-500/30"
                  >
                    <Mic className="h-4 w-4" />
                    Join Voice
                  </button>
                ) : (
                  <>
                    {/* Mute/Unmute */}
                    <button
                      onClick={toggleMute}
                      className={`p-2 rounded-lg text-sm font-medium flex items-center justify-center transition-colors ${
                        isMuted
                          ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                          : "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                      }`}
                      title={isMuted ? "Unmute" : "Mute"}
                    >
                      {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    </button>

                    {/* Deafen/Undeafen */}
                    <button
                      onClick={toggleDeafen}
                      className={`p-2 rounded-lg text-sm font-medium flex items-center justify-center transition-colors ${
                        isDeafened
                          ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                          : isDark
                            ? "bg-white/10 text-white/60 hover:bg-white/20"
                            : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                      }`}
                      title={isDeafened ? "Undeafen" : "Deafen"}
                    >
                      {isDeafened ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </button>

                    {/* Leave Voice */}
                    <button
                      onClick={handleLeaveVoice}
                      className="flex-1 py-2 rounded-lg bg-red-500/20 text-red-400 text-sm font-medium flex items-center justify-center gap-2 hover:bg-red-500/30"
                    >
                      <PhoneOff className="h-4 w-4" />
                      Disconnect
                    </button>
                  </>
                )}
                <button
                  onClick={handleLeave}
                  className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 ${
                    isDark
                      ? "bg-white/10 text-white/60 hover:bg-white/20"
                      : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                  }`}
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>

              {/* Voice members indicator */}
              {inVoice && voiceMembers.length > 0 && (
                <div className={`mt-2 text-xs ${isDark ? "text-white/40" : "text-gray-500"}`}>
                  {voiceMembers.length} {voiceMembers.length === 1 ? "user" : "users"} in voice
                </div>
              )}
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {messages.map((msg) => (
                <div key={msg.id} className="flex gap-2">
                  {msg.image ? (
                    <Image
                      src={msg.image}
                      alt={msg.name || "User"}
                      width={32}
                      height={32}
                      className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF8F6B] flex items-center justify-center flex-shrink-0">
                      <User className="h-4 w-4 text-white" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                        {msg.name || msg.username || "User"}
                      </span>
                      <span className={`text-xs ${isDark ? "text-white/40" : "text-gray-400"}`}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className={`text-sm ${isDark ? "text-white/80" : "text-gray-700"} break-words`}>
                      {msg.content}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Typing Indicator */}
            {typingUsers.size > 0 && (
              <div className={`px-3 py-1 text-xs ${isDark ? "text-white/40" : "text-gray-400"}`}>
                {Array.from(typingUsers.values()).join(", ")} {typingUsers.size === 1 ? "is" : "are"} typing...
              </div>
            )}

            {/* Message Input */}
            <div className={`p-3 border-t ${isDark ? "border-white/10" : "border-gray-200"}`}>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => {
                    setMessageInput(e.target.value);
                    handleTyping();
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                  placeholder="Type a message..."
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm ${
                    isDark
                      ? "bg-white/5 border-white/10 text-white placeholder:text-white/30"
                      : "bg-white border-gray-200 text-gray-900 placeholder:text-gray-400"
                  }`}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!messageInput.trim()}
                  className="p-2 rounded-lg bg-[#FF6B4A] text-white hover:bg-[#FF8F6B] disabled:opacity-50"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
