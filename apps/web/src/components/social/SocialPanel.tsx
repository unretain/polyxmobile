"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Users,
  MessageCircle,
  Send,
  Mic,
  MicOff,
  PhoneOff,
  Crown,
  LogOut,
  User,
  VolumeX,
  Volume2,
  UserPlus,
  Loader2,
  UserMinus,
  Search,
  Play,
  Ban,
  Check,
  Bell,
  BellOff,
  Camera,
  Pencil,
} from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import {
  useLobbyStore,
  LobbyMember,
  ChatMessage,
  LobbyInvite,
  OnlineFriend,
  JoinRequest,
} from "@/stores/lobbyStore";
import { useSocketStore } from "@/stores/socketStore";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { useVoiceChat } from "@/hooks/useVoiceChat";
import { useToast } from "@/components/ui/Toast";

interface SocialPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Friend {
  id: string;
  odIdIndex?: string;
  username: string | null;
  name: string | null;
  image: string | null;
}

type Tab = "profile" | "friends" | "lobby";

export function SocialPanel({ isOpen, onClose }: SocialPanelProps) {
  const { isDark } = useThemeStore();
  const { data: session } = useSession();
  const { socket, isConnected, connect } = useSocketStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    currentLobby,
    messages,
    typingUsers,
    pendingInvites,
    inVoice,
    voiceMembers,
    onlineFriends,
    setCurrentLobby,
    addMember,
    removeMember,
    addMessage,
    setTyping,
    addInvite,
    removeInvite,
    pendingJoinRequests,
    addJoinRequest,
    removeJoinRequest,
    setInVoice,
    setVoiceMembers,
    addVoiceMember,
    removeVoiceMember,
    setOnlineFriends,
    updateOnlineFriend,
    removeOnlineFriend,
    reset,
  } = useLobbyStore();

  const [activeTab, setActiveTab] = useState<Tab>("friends");
  const [messageInput, setMessageInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [kickingMember, setKickingMember] = useState<string | null>(null);

  // Profile state
  const [username, setUsername] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(true);
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuccess, setUsernameSuccess] = useState(false);

  // Friends state
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [searchUsername, setSearchUsername] = useState("");
  const [sendingRequest, setSendingRequest] = useState(false);
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [invitingFriend, setInvitingFriend] = useState<string | null>(null);
  const [requestingJoin, setRequestingJoin] = useState<string | null>(null); // lobbyId we're requesting to join

  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const { showToast } = useToast();

  // Profile editing state
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null); // Local name override

  // Voice chat hook
  const { isMuted, isDeafened, toggleMute, toggleDeafen } = useVoiceChat({
    socket,
    inVoice,
    onVoiceMemberJoined: addVoiceMember,
    onVoiceMemberLeft: removeVoiceMember,
  });

  // Connect socket when panel opens
  useEffect(() => {
    if (isOpen && session?.user?.id && !isConnected) {
      connect(
        session.user.id,
        (session.user as any).username || null,
        session.user.name || null,
        session.user.image || null
      );
    }
  }, [isOpen, session?.user?.id, isConnected, connect]);

  // Set up socket event listeners
  useEffect(() => {
    if (!socket) return;

    // Lobby events
    const handleMemberJoined = ({ member }: { member: LobbyMember }) => {
      addMember(member);
    };

    const handleMemberLeft = ({ odId }: { odId: string }) => {
      removeMember(odId);
    };

    const handleOwnerChanged = ({ newOwnerId }: { newOwnerId: string }) => {
      const lobby = useLobbyStore.getState().currentLobby;
      if (lobby) {
        setCurrentLobby({ ...lobby, ownerId: newOwnerId });
      }
    };

    const handleInvite = (invite: LobbyInvite) => {
      addInvite(invite);
      // Show toast notification if enabled
      if (notificationsEnabled) {
        showToast(`${invite.invitedBy.name || invite.invitedBy.username} invited you to ${invite.lobbyName}`, "info");
      }
    };

    // Chat events
    const handleChatMessage = (message: ChatMessage) => {
      addMessage(message);
    };

    const handleTyping = ({
      odId,
      username,
      isTyping,
    }: {
      odId: string;
      username: string | null;
      isTyping: boolean;
    }) => {
      setTyping(odId, username, isTyping);
    };

    // Voice events
    const handleVoiceUserJoined = (member: LobbyMember) => {
      addVoiceMember({ ...member, inVoice: true });
    };

    const handleVoiceUserLeft = ({ odId }: { odId: string }) => {
      removeVoiceMember(odId);
    };

    const handleVoiceMembers = ({ members }: { members: LobbyMember[] }) => {
      setVoiceMembers(members);
    };

    // Online friends events
    const handleOnlineFriends = ({ friends }: { friends: OnlineFriend[] }) => {
      setOnlineFriends(friends);
    };

    const handleFriendOnline = (friend: OnlineFriend) => {
      updateOnlineFriend(friend);
    };

    const handleFriendOffline = ({ odId }: { odId: string }) => {
      removeOnlineFriend(odId);
    };

    const handleFriendLobbyUpdate = ({
      odId,
      userId,
      lobbyId,
      lobbyName,
    }: {
      odId: string;
      userId: string;
      lobbyId: string | null;
      lobbyName: string | null;
    }) => {
      // Find by userId (more reliable than odId which can change on reconnect)
      const friend = useLobbyStore.getState().onlineFriends.find((f) => f.userId === userId);
      if (friend) {
        // Update both odId (in case it changed) and lobby info
        updateOnlineFriend({ ...friend, odId, lobbyId, lobbyName });
      }
    };

    // Handle auth success - fixes timing issue with online friends
    const handleAuthSuccess = ({ onlineFriends }: { onlineFriends: OnlineFriend[] }) => {
      setOnlineFriends(onlineFriends);
    };

    // Handle being kicked from lobby
    const handleKicked = ({ lobbyName }: { lobbyId: string; lobbyName: string }) => {
      reset();
      setError(`You were kicked from ${lobbyName}`);
    };

    // Handle incoming join request (for lobby owner)
    const handleJoinRequest = ({ requester }: { lobbyId: string; requester: JoinRequest }) => {
      addJoinRequest(requester);
      if (notificationsEnabled) {
        showToast(`${requester.name || requester.username} wants to join your lobby`, "info");
      }
    };

    // Handle join request accepted (we can now join)
    const handleJoinAccepted = ({ lobbyId }: { lobbyId: string; lobbyName: string }) => {
      setRequestingJoin(null);
      // Now actually join the lobby
      socket.emit(
        "lobby:join",
        { lobbyId },
        (response: { success: boolean; lobby?: any; error?: string }) => {
          if (response.success && response.lobby) {
            setCurrentLobby(response.lobby);
            setActiveTab("lobby");
            showToast("Joined lobby!", "success");
          } else {
            setError(response.error || "Failed to join lobby");
          }
        }
      );
    };

    // Handle join request denied
    const handleJoinDenied = ({ lobbyName }: { lobbyId: string; lobbyName: string }) => {
      setRequestingJoin(null);
      showToast(`Your request to join ${lobbyName} was denied`, "error");
    };

    // Handle lobby shutdown (host left)
    const handleShutdown = ({ reason }: { lobbyId: string; reason: string }) => {
      reset();
      setRequestingJoin(null);
      showToast(reason || "Lobby was closed", "info");
    };

    // Handle incoming friend request (real-time)
    const handleFriendRequestReceived = (data: { id: string; sender: any }) => {
      setPendingRequests((prev) => {
        // Prevent duplicates
        if (prev.some((r) => r.id === data.id)) return prev;
        return [...prev, { id: data.id, sender: data.sender }];
      });
      if (notificationsEnabled) {
        showToast(`${data.sender.name || data.sender.username} sent you a friend request`, "info");
      }
    };

    // Handle friend request accepted (we're now friends)
    const handleNewFriend = (data: { friend: any; acceptedBy: any }) => {
      // Refresh friends list to include the new friend
      fetchFriends();
      if (notificationsEnabled) {
        showToast(`${data.acceptedBy.name || data.acceptedBy.username} accepted your friend request!`, "success");
      }
    };

    // Handle being removed as a friend
    const handleWasRemoved = (data: { removedBy: any }) => {
      // Refresh friends list to remove them
      fetchFriends();
      // Also remove from online friends
      const onlineFriend = useLobbyStore.getState().onlineFriends.find(
        (f) => f.userId === data.removedBy.id
      );
      if (onlineFriend) {
        removeOnlineFriend(onlineFriend.odId);
      }
    };

    socket.on("lobby:memberJoined", handleMemberJoined);
    socket.on("lobby:memberLeft", handleMemberLeft);
    socket.on("lobby:ownerChanged", handleOwnerChanged);
    socket.on("lobby:invite", handleInvite);
    socket.on("lobby:kicked", handleKicked);
    socket.on("lobby:shutdown", handleShutdown);
    socket.on("lobby:authSuccess", handleAuthSuccess);
    socket.on("lobby:joinRequest", handleJoinRequest);
    socket.on("lobby:joinAccepted", handleJoinAccepted);
    socket.on("lobby:joinDenied", handleJoinDenied);
    socket.on("chat:message", handleChatMessage);
    socket.on("chat:typing", handleTyping);
    socket.on("voice:userJoined", handleVoiceUserJoined);
    socket.on("voice:userLeft", handleVoiceUserLeft);
    socket.on("voice:members", handleVoiceMembers);
    socket.on("friends:online", handleOnlineFriends);
    socket.on("friends:userOnline", handleFriendOnline);
    socket.on("friends:userOffline", handleFriendOffline);
    socket.on("friends:lobbyUpdate", handleFriendLobbyUpdate);
    socket.on("friends:requestReceived", handleFriendRequestReceived);
    socket.on("friends:newFriend", handleNewFriend);
    socket.on("friends:wasRemoved", handleWasRemoved);

    return () => {
      socket.off("lobby:memberJoined", handleMemberJoined);
      socket.off("lobby:memberLeft", handleMemberLeft);
      socket.off("lobby:ownerChanged", handleOwnerChanged);
      socket.off("lobby:invite", handleInvite);
      socket.off("lobby:kicked", handleKicked);
      socket.off("lobby:shutdown", handleShutdown);
      socket.off("lobby:authSuccess", handleAuthSuccess);
      socket.off("lobby:joinRequest", handleJoinRequest);
      socket.off("lobby:joinAccepted", handleJoinAccepted);
      socket.off("lobby:joinDenied", handleJoinDenied);
      socket.off("chat:message", handleChatMessage);
      socket.off("chat:typing", handleTyping);
      socket.off("voice:userJoined", handleVoiceUserJoined);
      socket.off("voice:userLeft", handleVoiceUserLeft);
      socket.off("voice:members", handleVoiceMembers);
      socket.off("friends:online", handleOnlineFriends);
      socket.off("friends:userOnline", handleFriendOnline);
      socket.off("friends:userOffline", handleFriendOffline);
      socket.off("friends:lobbyUpdate", handleFriendLobbyUpdate);
      socket.off("friends:requestReceived", handleFriendRequestReceived);
      socket.off("friends:newFriend", handleNewFriend);
      socket.off("friends:wasRemoved", handleWasRemoved);
    };
  }, [socket, notificationsEnabled, addJoinRequest, setCurrentLobby, showToast, removeOnlineFriend]);

  // Fetch friends list and profile
  useEffect(() => {
    if (isOpen) {
      fetchFriends();
      fetchPendingRequests();
      fetchProfile();
    }
  }, [isOpen]);

  // Fetch profile/username
  const fetchProfile = async () => {
    try {
      setUsernameLoading(true);
      const res = await fetch("/api/users/profile");
      if (res.ok) {
        const data = await res.json();
        setUsername(data.username || "");
      }
    } catch (error) {
      console.error("Failed to fetch profile:", error);
    } finally {
      setUsernameLoading(false);
    }
  };

  const handleSaveUsername = async () => {
    if (!username.trim()) return;

    setUsernameSaving(true);
    setUsernameError(null);
    setUsernameSuccess(false);

    try {
      const res = await fetch("/api/users/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim().toLowerCase() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to save username");
      }

      setUsernameSuccess(true);
      setTimeout(() => setUsernameSuccess(false), 3000);
    } catch (err) {
      setUsernameError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setUsernameSaving(false);
    }
  };

  const fetchFriends = async () => {
    try {
      setLoadingFriends(true);
      const res = await fetch("/api/friends");
      if (res.ok) {
        const data = await res.json();
        setFriends(data.friends || []);

        // Request online status from server
        if (socket && data.friends?.length > 0) {
          socket.emit("friends:getOnline", {
            friendIds: data.friends.map((f: Friend) => f.id),
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch friends:", error);
    } finally {
      setLoadingFriends(false);
    }
  };

  const fetchPendingRequests = async () => {
    try {
      const res = await fetch("/api/friends/request");
      if (res.ok) {
        const data = await res.json();
        setPendingRequests(data.requests || []);
      }
    } catch (error) {
      console.error("Failed to fetch pending requests:", error);
    }
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Lobby handlers
  const handleRequestJoinLobby = useCallback(
    (lobbyId: string) => {
      if (!socket) return;

      // Check if already in this lobby
      if (currentLobby?.id === lobbyId) {
        showToast("You're already in this lobby!", "info");
        return;
      }

      setError(null);
      setRequestingJoin(lobbyId);

      socket.emit(
        "lobby:requestJoin",
        { lobbyId },
        (response: { success: boolean; error?: string }) => {
          if (response.success) {
            showToast("Join request sent! Waiting for approval...", "info");
          } else {
            setRequestingJoin(null);
            setError(response.error || "Failed to send join request");
          }
        }
      );
    },
    [socket, showToast, currentLobby?.id]
  );

  const handleLeave = useCallback(() => {
    if (!socket) return;

    socket.emit("lobby:leave", () => {
      reset();
    });
  }, [socket, reset]);

  // Accept a join request
  const handleAcceptJoinRequest = useCallback(
    (requesterSocketId: string) => {
      if (!socket) return;

      socket.emit(
        "lobby:acceptJoin",
        { requesterSocketId },
        (response: { success: boolean; error?: string }) => {
          if (response.success) {
            removeJoinRequest(requesterSocketId);
          } else {
            setError(response.error || "Failed to accept join request");
          }
        }
      );
    },
    [socket, removeJoinRequest]
  );

  // Deny a join request
  const handleDenyJoinRequest = useCallback(
    (requesterSocketId: string) => {
      if (!socket) return;

      socket.emit(
        "lobby:denyJoin",
        { requesterSocketId },
        (response: { success: boolean; error?: string }) => {
          if (response.success) {
            removeJoinRequest(requesterSocketId);
          } else {
            setError(response.error || "Failed to deny join request");
          }
        }
      );
    },
    [socket, removeJoinRequest]
  );

  const handleKickMember = useCallback(
    (targetSocketId: string) => {
      if (!socket) return;
      setKickingMember(targetSocketId);

      socket.emit(
        "lobby:kick",
        { targetSocketId },
        (response: { success: boolean; error?: string }) => {
          setKickingMember(null);
          if (!response.success) {
            setError(response.error || "Failed to kick member");
          }
        }
      );
    },
    [socket]
  );

  const handleSendMessage = useCallback(() => {
    if (!socket || !messageInput.trim()) return;

    socket.emit("chat:message", { content: messageInput.trim() });
    setMessageInput("");
  }, [socket, messageInput]);

  const handleJoinVoice = useCallback(() => {
    if (!socket) return;
    socket.emit("voice:join");
    setInVoice(true);
  }, [socket, setInVoice]);

  const handleLeaveVoice = useCallback(() => {
    if (!socket) return;
    socket.emit("voice:leave");
    setInVoice(false);
    setVoiceMembers([]);
  }, [socket, setInVoice, setVoiceMembers]);

  const handleAcceptInvite = useCallback(
    (lobbyId: string) => {
      if (!socket) return;
      removeInvite(lobbyId);

      socket.emit(
        "lobby:join",
        { lobbyId },
        (response: { success: boolean; lobby?: any; error?: string }) => {
          if (response.success && response.lobby) {
            setCurrentLobby(response.lobby);
            setActiveTab("lobby");
          } else {
            setError(response.error || "Failed to join lobby");
          }
        }
      );
    },
    [socket, removeInvite, setCurrentLobby]
  );

  const handleDeclineInvite = useCallback(
    (lobbyId: string) => {
      removeInvite(lobbyId);
    },
    [removeInvite]
  );

  const handleInviteFriend = useCallback(
    (odId: string) => {
      if (!socket || !currentLobby) return;
      setInvitingFriend(odId);

      socket.emit(
        "lobby:invite",
        { friendSocketId: odId },
        (response: { success: boolean; error?: string }) => {
          setInvitingFriend(null);
          if (!response.success) {
            setError(response.error || "Failed to send invite");
          }
        }
      );
    },
    [socket, currentLobby]
  );

  // Invite friend from Lobby tab - creates lobby if needed
  const handleInviteFromLobbyTab = useCallback(
    (odId: string) => {
      if (!socket) return;
      setInvitingFriend(odId);

      // If already in a lobby, just invite
      if (currentLobby) {
        socket.emit(
          "lobby:invite",
          { friendSocketId: odId },
          (response: { success: boolean; error?: string }) => {
            setInvitingFriend(null);
            if (!response.success) {
              setError(response.error || "Failed to send invite");
            } else {
              showToast("Invite sent!", "success");
            }
          }
        );
        return;
      }

      // Create lobby first, then invite
      socket.emit(
        "lobby:create",
        { name: `${session?.user?.name || "User"}'s Lobby` },
        (response: { success: boolean; lobby?: any; error?: string }) => {
          if (response.success && response.lobby) {
            setCurrentLobby(response.lobby);
            // Now invite the friend
            socket.emit(
              "lobby:invite",
              { friendSocketId: odId },
              (inviteResponse: { success: boolean; error?: string }) => {
                setInvitingFriend(null);
                if (!inviteResponse.success) {
                  setError(inviteResponse.error || "Failed to send invite");
                } else {
                  showToast("Lobby created and invite sent!", "success");
                }
              }
            );
          } else {
            setInvitingFriend(null);
            setError(response.error || "Failed to create lobby");
          }
        }
      );
    },
    [socket, currentLobby, session?.user?.name, setCurrentLobby]
  );

  // Save display name
  const handleSaveName = async () => {
    if (!nameInput.trim()) return;

    setNameSaving(true);
    try {
      const res = await fetch("/api/users/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save name");
      }

      setDisplayName(nameInput.trim()); // Update local display name
      setEditingName(false);
      showToast("Name saved!", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setNameSaving(false);
    }
  };

  // Friend request handlers
  const handleSendFriendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchUsername.trim()) return;

    setSendingRequest(true);
    setRequestError(null);
    setRequestSuccess(null);

    try {
      const res = await fetch("/api/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: searchUsername.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to send request");
      }

      // If we got a new friend (auto-accepted their pending request), refresh the list
      if (data.friend) {
        fetchFriends();
        // Notify them via WebSocket that we're now friends
        if (socket) {
          socket.emit("friends:requestAccepted", {
            senderId: data.friend.id,
            friend: {
              id: session?.user?.id,
              username: (session?.user as any)?.username,
              name: session?.user?.name,
              image: session?.user?.image,
            },
          });
        }
      } else if (data.request) {
        // Notify recipient via WebSocket
        if (socket) {
          socket.emit("friends:requestSent", {
            receiverId: data.request.receiver.id,
            request: { id: data.request.id },
          });
        }
      }

      setRequestSuccess(data.message || "Friend request sent!");
      setSearchUsername("");
      setTimeout(() => setRequestSuccess(null), 3000);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Failed to send request");
    } finally {
      setSendingRequest(false);
    }
  };

  const handleAcceptRequest = async (requestId: string) => {
    try {
      // Find the request to get the sender info
      const request = pendingRequests.find((r) => r.id === requestId);

      const res = await fetch(`/api/friends/request/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });

      if (res.ok) {
        setPendingRequests(pendingRequests.filter((r) => r.id !== requestId));
        fetchFriends();

        // Notify the sender via WebSocket that we accepted
        if (socket && request?.sender) {
          socket.emit("friends:requestAccepted", {
            senderId: request.sender.id,
            friend: {
              id: session?.user?.id,
              username: (session?.user as any)?.username,
              name: session?.user?.name,
              image: session?.user?.image,
            },
          });
        }
      }
    } catch (error) {
      console.error("Failed to accept request:", error);
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    try {
      const res = await fetch(`/api/friends/request/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });

      if (res.ok) {
        setPendingRequests(pendingRequests.filter((r) => r.id !== requestId));
      }
    } catch (error) {
      console.error("Failed to reject request:", error);
    }
  };

  const handleRemoveFriend = async (friendId: string) => {
    try {
      const res = await fetch(`/api/friends/${friendId}`, { method: "DELETE" });
      if (res.ok) {
        setFriends(friends.filter((f) => f.id !== friendId));

        // Notify them via WebSocket that they were removed
        if (socket) {
          socket.emit("friends:removed", { friendId });
        }
      }
    } catch (error) {
      console.error("Failed to remove friend:", error);
    }
  };

  // Typing indicator
  const typingTimeout = useRef<NodeJS.Timeout | null>(null);
  const handleTyping = useCallback(() => {
    if (!socket) return;

    socket.emit("chat:typing", { isTyping: true });

    if (typingTimeout.current) {
      clearTimeout(typingTimeout.current);
    }
    typingTimeout.current = setTimeout(() => {
      socket?.emit("chat:typing", { isTyping: false });
    }, 2000);
  }, [socket]);

  if (!isOpen) return null;

  const isOnline = (friendId: string) => onlineFriends.some((f) => f.userId === friendId);
  const getFriendLobby = (friendId: string) =>
    onlineFriends.find((f) => f.userId === friendId && f.lobbyId);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed right-0 top-0 bottom-0 z-[70] w-full max-w-md border-l shadow-2xl transform transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        } ${isDark ? "bg-[#0f0f0f] border-white/10" : "bg-white border-gray-200"}`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between p-4 border-b ${
            isDark ? "border-white/10" : "border-gray-200"
          }`}
        >
          <h2
            className={`text-lg font-bold flex items-center gap-2 ${
              isDark ? "text-white" : "text-gray-900"
            }`}
          >
            <Users className="h-5 w-5" />
            {currentLobby ? currentLobby.name : "Social"}
          </h2>
          <div className="flex items-center gap-2">
            {/* Notification toggle */}
            <button
              onClick={() => setNotificationsEnabled(!notificationsEnabled)}
              className={`p-2 rounded-lg transition-colors ${
                notificationsEnabled
                  ? "text-[#FF6B4A] hover:bg-[#FF6B4A]/10"
                  : isDark
                  ? "text-white/40 hover:bg-white/10"
                  : "text-gray-400 hover:bg-gray-100"
              }`}
              title={notificationsEnabled ? "Notifications on" : "Notifications off"}
            >
              {notificationsEnabled ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
            </button>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${
                isDark ? "hover:bg-white/10 text-white/60" : "hover:bg-gray-100 text-gray-600"
              }`}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Pending Invites */}
        {pendingInvites.length > 0 && !currentLobby && (
          <div className={`p-3 border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
            <p className={`text-xs font-medium mb-2 ${isDark ? "text-white/60" : "text-gray-500"}`}>
              Lobby Invites
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
                    Join
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

        {/* Tabs - always visible */}
        <div className={`flex border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
          <button
            onClick={() => setActiveTab("profile")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "profile"
                ? isDark
                  ? "text-white border-b-2 border-[#FF6B4A]"
                  : "text-gray-900 border-b-2 border-[#FF6B4A]"
                : isDark
                ? "text-white/60 hover:text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <User className="h-4 w-4" />
            Profile
          </button>
          <button
            onClick={() => setActiveTab("friends")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "friends"
                ? isDark
                  ? "text-white border-b-2 border-[#FF6B4A]"
                  : "text-gray-900 border-b-2 border-[#FF6B4A]"
                : isDark
                ? "text-white/60 hover:text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Users className="h-4 w-4" />
            Friends
          </button>
          <button
            onClick={() => setActiveTab("lobby")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === "lobby"
                  ? isDark
                    ? "text-white border-b-2 border-[#FF6B4A]"
                    : "text-gray-900 border-b-2 border-[#FF6B4A]"
                  : isDark
                  ? "text-white/60 hover:text-white"
                  : "text-gray-600 hover:text-gray-900"
              }`}
          >
            <MessageCircle className="h-4 w-4" />
            {currentLobby ? currentLobby.name : "Lobby"}
            {currentLobby && <span className="w-2 h-2 rounded-full bg-green-500 ml-1" />}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col" style={{ height: "calc(100vh - 130px)" }}>
          {activeTab === "lobby" && currentLobby ? (
            // Active Lobby View
            <>
              {/* Members with kick functionality */}
              <div className={`p-3 border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
                <p className={`text-xs font-medium mb-2 ${isDark ? "text-white/60" : "text-gray-500"}`}>
                  Members ({currentLobby.members.length}/5)
                </p>
                <div className="space-y-2">
                  {currentLobby.members.map((member) => {
                    const isOwner = member.userId === currentLobby.ownerId;
                    const isSelf = member.odId === socket?.id;
                    const canKick = session?.user?.id === currentLobby.ownerId && !isSelf;

                    return (
                      <div
                        key={member.odId}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                          isDark ? "bg-white/5" : "bg-gray-50"
                        }`}
                      >
                        {member.image ? (
                          <Image
                            src={member.image}
                            alt={member.name || "User"}
                            width={28}
                            height={28}
                            className="w-7 h-7 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF8F6B] flex items-center justify-center">
                            <User className="h-4 w-4 text-white" />
                          </div>
                        )}
                        <span className={`flex-1 text-sm ${isDark ? "text-white" : "text-gray-900"}`}>
                          {member.name || member.username || "User"}
                          {isSelf && <span className={`ml-1 text-xs ${isDark ? "text-white/40" : "text-gray-400"}`}>(you)</span>}
                        </span>
                        {isOwner && <Crown className="h-4 w-4 text-yellow-500" />}
                        {member.inVoice && <Mic className="h-4 w-4 text-green-500" />}
                        {canKick && (
                          <button
                            onClick={() => handleKickMember(member.odId)}
                            disabled={kickingMember === member.odId}
                            className="p-1 rounded hover:bg-red-500/20 text-red-400 transition-colors"
                            title="Kick from lobby"
                          >
                            {kickingMember === member.odId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Ban className="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Pending Join Requests (for lobby owner) */}
              {session?.user?.id === currentLobby.ownerId && pendingJoinRequests.length > 0 && (
                <div className={`p-3 border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
                  <p className={`text-xs font-medium mb-2 ${isDark ? "text-white/60" : "text-gray-500"}`}>
                    Join Requests ({pendingJoinRequests.length})
                  </p>
                  <div className="space-y-2">
                    {pendingJoinRequests.map((request) => (
                      <div
                        key={request.socketId}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                          isDark ? "bg-white/5" : "bg-gray-50"
                        }`}
                      >
                        {request.image ? (
                          <Image
                            src={request.image}
                            alt={request.name || "User"}
                            width={28}
                            height={28}
                            className="w-7 h-7 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF8F6B] flex items-center justify-center">
                            <User className="h-4 w-4 text-white" />
                          </div>
                        )}
                        <span className={`flex-1 text-sm ${isDark ? "text-white" : "text-gray-900"}`}>
                          {request.name || request.username || "User"}
                        </span>
                        <button
                          onClick={() => handleAcceptJoinRequest(request.socketId)}
                          className="p-1.5 rounded bg-[#FF6B4A] text-white hover:bg-[#FF8F6B]"
                          title="Accept"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDenyJoinRequest(request.socketId)}
                          className={`p-1.5 rounded ${isDark ? "bg-white/10 hover:bg-white/20" : "bg-gray-200 hover:bg-gray-300"}`}
                          title="Deny"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Invite Friends (if in lobby) */}
              {friends.filter((f) => isOnline(f.id) && !currentLobby.members.some((m) => m.userId === f.id)).length > 0 && (
                <div className={`p-3 border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
                  <p className={`text-xs font-medium mb-2 ${isDark ? "text-white/60" : "text-gray-500"}`}>
                    Invite Friends
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {friends
                      .filter((f) => isOnline(f.id) && !currentLobby.members.some((m) => m.userId === f.id))
                      .map((friend) => {
                        const onlineFriend = onlineFriends.find((of) => of.userId === friend.id);
                        return (
                          <button
                            key={friend.id}
                            onClick={() => onlineFriend && handleInviteFriend(onlineFriend.odId)}
                            disabled={invitingFriend === onlineFriend?.odId}
                            className={`flex items-center gap-2 px-2 py-1 rounded-full transition-colors ${
                              isDark
                                ? "bg-white/5 hover:bg-white/10"
                                : "bg-gray-50 hover:bg-gray-100"
                            }`}
                          >
                            {friend.image ? (
                              <Image
                                src={friend.image}
                                alt={friend.name || "Friend"}
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
                              {friend.name || friend.username}
                            </span>
                            {invitingFriend === onlineFriend?.odId ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <UserPlus className="h-3 w-3 text-[#FF6B4A]" />
                            )}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}

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
                {inVoice && (
                  <div className={`mt-2 text-xs ${isDark ? "text-white/40" : "text-gray-500"}`}>
                    {voiceMembers.length + 1} {voiceMembers.length + 1 === 1 ? "user" : "users"} in voice
                  </div>
                )}
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {messages.length === 0 && (
                  <p className={`text-center text-sm py-8 ${isDark ? "text-white/40" : "text-gray-400"}`}>
                    No messages yet. Say hello!
                  </p>
                )}
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
                          {new Date(msg.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
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
                  {Array.from(typingUsers.values()).join(", ")}{" "}
                  {typingUsers.size === 1 ? "is" : "are"} typing...
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
          ) : activeTab === "profile" ? (
            // Profile Tab
            <div className="p-4 space-y-4 overflow-y-auto">
              {/* Profile Picture */}
              <div className="flex flex-col items-center py-4">
                <div className="relative group">
                  {session?.user?.image ? (
                    <Image
                      src={session.user.image}
                      alt={session.user.name || "User"}
                      width={80}
                      height={80}
                      className="w-20 h-20 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF8F6B] flex items-center justify-center">
                      <User className="h-10 w-10 text-white" />
                    </div>
                  )}
                  {/* Camera overlay for future upload */}
                  <div className={`absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${isDark ? "bg-black/50" : "bg-black/40"}`}>
                    <Camera className="h-6 w-6 text-white" />
                  </div>
                </div>

                {/* Editable Name */}
                <div className="mt-3 flex items-center gap-2">
                  {editingName ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && nameInput.trim()) {
                            handleSaveName();
                          } else if (e.key === "Escape") {
                            setEditingName(false);
                          }
                        }}
                        placeholder="Display name"
                        maxLength={50}
                        className={`px-3 py-1.5 rounded-lg border text-sm font-medium outline-none focus:ring-2 focus:ring-[#FF6B4A]/50 ${
                          isDark
                            ? "bg-white/5 text-white border-white/10"
                            : "bg-white text-gray-900 border-gray-200"
                        }`}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={handleSaveName}
                        disabled={!nameInput.trim() || nameSaving}
                        className="p-1.5 rounded bg-[#FF6B4A] text-white hover:bg-[#FF8F6B] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {nameSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingName(false)}
                        className={`p-1.5 rounded ${isDark ? "hover:bg-white/10 text-white/60" : "hover:bg-gray-100 text-gray-500"}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                        {displayName || session?.user?.name || "User"}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setNameInput(displayName || session?.user?.name || "");
                          setEditingName(true);
                        }}
                        className={`p-1.5 rounded transition-colors ${isDark ? "hover:bg-white/10 text-white/40" : "hover:bg-gray-100 text-gray-400"}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
                <p className={`text-sm ${isDark ? "text-white/50" : "text-gray-500"}`}>
                  {session?.user?.email}
                </p>
              </div>

              {/* Username */}
              <div className={`p-4 rounded-lg ${isDark ? "bg-white/5" : "bg-gray-50"}`}>
                <h3 className={`text-sm font-medium mb-3 ${isDark ? "text-white/80" : "text-gray-700"}`}>
                  Username
                </h3>
                <p className={`text-xs mb-3 ${isDark ? "text-white/40" : "text-gray-500"}`}>
                  Your unique username for friends to find you. 1-9 letters only.
                </p>
                {usernameLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className={`h-5 w-5 animate-spin ${isDark ? "text-white/40" : "text-gray-400"}`} />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm ${isDark ? "text-white/40" : "text-gray-400"}`}>@</span>
                        <input
                          type="text"
                          value={username}
                          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z]/g, ""))}
                          placeholder="username"
                          maxLength={9}
                          className={`w-full pl-8 pr-3 py-2 rounded-lg border outline-none focus:border-[#FF6B4A]/50 text-sm ${
                            isDark
                              ? "bg-white/5 text-white border-white/10 placeholder:text-white/30"
                              : "bg-white text-gray-900 border-gray-200 placeholder:text-gray-400"
                          }`}
                        />
                      </div>
                      <button
                        onClick={handleSaveUsername}
                        disabled={!username.trim() || usernameSaving}
                        className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                          !username.trim() || usernameSaving
                            ? isDark
                              ? "bg-white/10 text-white/40 cursor-not-allowed"
                              : "bg-gray-100 text-gray-400 cursor-not-allowed"
                            : "bg-[#FF6B4A] text-white hover:bg-[#FF8F6B]"
                        }`}
                      >
                        {usernameSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                      </button>
                    </div>
                    {usernameError && (
                      <p className="text-xs text-red-400 bg-red-500/10 p-2 rounded">{usernameError}</p>
                    )}
                    {usernameSuccess && (
                      <p className="text-xs text-green-400 bg-green-500/10 p-2 rounded">Username saved!</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === "friends" ? (
            // Friends Tab
            <div className="p-4 space-y-4 overflow-y-auto">
              {/* Add Friend Form */}
              <div className={`p-4 rounded-lg ${isDark ? "bg-white/5" : "bg-gray-50"}`}>
                <h3 className={`text-sm font-medium mb-3 flex items-center gap-2 ${isDark ? "text-white/80" : "text-gray-700"}`}>
                  <UserPlus className="h-4 w-4" />
                  Add Friend
                </h3>
                <form onSubmit={handleSendFriendRequest} className="space-y-3">
                  <div className="relative">
                    <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${isDark ? "text-white/40" : "text-gray-400"}`} />
                    <input
                      type="text"
                      value={searchUsername}
                      onChange={(e) => setSearchUsername(e.target.value.toLowerCase().replace(/[^a-z]/g, ""))}
                      placeholder="Enter username..."
                      maxLength={9}
                      className={`w-full pl-10 pr-3 py-2 rounded-lg border outline-none focus:border-[#FF6B4A]/50 text-sm ${
                        isDark
                          ? "bg-white/5 text-white border-white/10 placeholder:text-white/30"
                          : "bg-white text-gray-900 border-gray-200 placeholder:text-gray-400"
                      }`}
                    />
                  </div>
                  {requestError && (
                    <p className="text-xs text-[#FF6B4A] bg-[#FF6B4A]/10 p-2 rounded">{requestError}</p>
                  )}
                  {requestSuccess && (
                    <p className="text-xs text-green-400 bg-green-500/10 p-2 rounded flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      {requestSuccess}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={!searchUsername.trim() || sendingRequest}
                    className={`w-full py-2 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 ${
                      !searchUsername.trim() || sendingRequest
                        ? isDark
                          ? "bg-white/10 text-white/40 cursor-not-allowed"
                          : "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "bg-[#FF6B4A] text-white hover:bg-[#FF8F6B]"
                    }`}
                  >
                    {sendingRequest ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-4 w-4" />
                        Send Request
                      </>
                    )}
                  </button>
                </form>
              </div>

              {/* Pending Requests */}
              {pendingRequests.length > 0 && (
                <div>
                  <h3 className={`text-sm font-medium mb-3 ${isDark ? "text-white/80" : "text-gray-700"}`}>
                    Friend Requests ({pendingRequests.length})
                  </h3>
                  <div className="space-y-2">
                    {pendingRequests.map((request) => (
                      <div
                        key={request.id}
                        className={`flex items-center gap-3 p-3 rounded-lg ${isDark ? "bg-white/5" : "bg-gray-50"}`}
                      >
                        {request.sender.image ? (
                          <Image
                            src={request.sender.image}
                            alt={request.sender.name || "User"}
                            width={40}
                            height={40}
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF8F6B] flex items-center justify-center">
                            <User className="h-5 w-5 text-white" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                            {request.sender.name || request.sender.username || "Unknown"}
                          </p>
                          {request.sender.username && (
                            <p className={`text-xs truncate ${isDark ? "text-white/50" : "text-gray-500"}`}>
                              @{request.sender.username}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAcceptRequest(request.id)}
                            className="px-3 py-1 rounded bg-[#FF6B4A] text-white text-xs font-medium hover:bg-[#FF8F6B]"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => handleRejectRequest(request.id)}
                            className={`px-3 py-1 rounded text-xs font-medium ${
                              isDark ? "bg-white/10 text-white/60" : "bg-gray-200 text-gray-600"
                            }`}
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Friends List */}
              <div>
                <h3 className={`text-sm font-medium mb-3 flex items-center gap-2 ${isDark ? "text-white/80" : "text-gray-700"}`}>
                  <Users className="h-4 w-4" />
                  Friends ({friends.length})
                </h3>
                {loadingFriends ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className={`h-6 w-6 animate-spin ${isDark ? "text-white/40" : "text-gray-400"}`} />
                  </div>
                ) : friends.length === 0 ? (
                  <p className={`text-sm text-center py-8 ${isDark ? "text-white/40" : "text-gray-400"}`}>
                    No friends yet. Add friends by username above!
                  </p>
                ) : (
                  <div className="space-y-2">
                    {friends.map((friend) => {
                      const online = isOnline(friend.id);
                      const friendLobby = getFriendLobby(friend.id);
                      return (
                        <div
                          key={friend.id}
                          className={`flex items-center gap-3 p-3 rounded-lg ${isDark ? "bg-white/5" : "bg-gray-50"}`}
                        >
                          <div className="relative">
                            {friend.image ? (
                              <Image
                                src={friend.image}
                                alt={friend.name || "Friend"}
                                width={40}
                                height={40}
                                className="w-10 h-10 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF8F6B] flex items-center justify-center">
                                <User className="h-5 w-5 text-white" />
                              </div>
                            )}
                            {/* Online indicator */}
                            <div
                              className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 ${
                                isDark ? "border-[#0f0f0f]" : "border-white"
                              } ${online ? "bg-green-500" : "bg-gray-400"}`}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                              {friend.name || friend.username || "Unknown"}
                            </p>
                            <p className={`text-xs truncate ${isDark ? "text-white/50" : "text-gray-500"}`}>
                              {friendLobby ? (
                                <span className="text-green-400">In lobby: {friendLobby.lobbyName}</span>
                              ) : online ? (
                                <span className="text-green-400">Online</span>
                              ) : (
                                "Offline"
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            {/* Request to join friend's lobby button */}
                            {friendLobby && (
                              <button
                                onClick={() => handleRequestJoinLobby(friendLobby.lobbyId!)}
                                disabled={requestingJoin === friendLobby.lobbyId}
                                className="p-2 rounded-lg bg-[#FF6B4A]/20 text-[#FF6B4A] hover:bg-[#FF6B4A]/30 transition-colors disabled:opacity-50"
                                title="Request to join"
                              >
                                {requestingJoin === friendLobby.lobbyId ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Play className="h-4 w-4" />
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => handleRemoveFriend(friend.id)}
                              className={`p-2 rounded-lg transition-colors ${
                                isDark
                                  ? "hover:bg-white/10 text-white/40 hover:text-red-400"
                                  : "hover:bg-gray-100 text-gray-400 hover:text-red-500"
                              }`}
                              title="Remove friend"
                            >
                              <UserMinus className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Lobby Tab (not in lobby) - Shows friends list with invite functionality
            <div className="p-4 space-y-4 overflow-y-auto">
              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">{error}</div>
              )}

              {/* Status message */}
              <div className={`text-center py-2 ${isDark ? "text-white/60" : "text-gray-500"}`}>
                <p className="text-sm">
                  {currentLobby
                    ? "Invite friends to your lobby"
                    : "Invite a friend to start a lobby"}
                </p>
              </div>

              {/* Friends List with Invite */}
              <div>
                <h3 className={`text-sm font-medium mb-3 flex items-center gap-2 ${isDark ? "text-white/80" : "text-gray-700"}`}>
                  <Users className="h-4 w-4" />
                  Friends ({friends.length})
                </h3>
                {loadingFriends ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className={`h-6 w-6 animate-spin ${isDark ? "text-white/40" : "text-gray-400"}`} />
                  </div>
                ) : friends.length === 0 ? (
                  <div className={`text-center py-8 ${isDark ? "text-white/40" : "text-gray-400"}`}>
                    <Users className="h-10 w-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No friends yet</p>
                    <p className="text-xs mt-1">Add friends in the Friends tab</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Online friends first, then offline */}
                    {friends
                      .sort((a, b) => {
                        const aOnline = isOnline(a.id);
                        const bOnline = isOnline(b.id);
                        if (aOnline && !bOnline) return -1;
                        if (!aOnline && bOnline) return 1;
                        return 0;
                      })
                      .map((friend) => {
                        const online = isOnline(friend.id);
                        const friendLobby = getFriendLobby(friend.id);
                        const onlineFriend = onlineFriends.find((of) => of.userId === friend.id);

                        return (
                          <div
                            key={friend.id}
                            className={`flex items-center gap-3 p-3 rounded-lg ${isDark ? "bg-white/5" : "bg-gray-50"}`}
                          >
                            <div className="relative">
                              {friend.image ? (
                                <Image
                                  src={friend.image}
                                  alt={friend.name || "Friend"}
                                  width={40}
                                  height={40}
                                  className="w-10 h-10 rounded-full object-cover"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF8F6B] flex items-center justify-center">
                                  <User className="h-5 w-5 text-white" />
                                </div>
                              )}
                              {/* Online indicator */}
                              <div
                                className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 ${
                                  isDark ? "border-[#0f0f0f]" : "border-white"
                                } ${online ? "bg-green-500" : "bg-gray-400"}`}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                                {friend.name || friend.username || "Unknown"}
                              </p>
                              <p className={`text-xs truncate ${isDark ? "text-white/50" : "text-gray-500"}`}>
                                {friendLobby ? (
                                  <span className="text-green-400">In lobby: {friendLobby.lobbyName}</span>
                                ) : online ? (
                                  <span className="text-green-400">Online</span>
                                ) : (
                                  "Offline"
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {/* Request to join friend's lobby button */}
                              {friendLobby && (
                                <button
                                  onClick={() => handleRequestJoinLobby(friendLobby.lobbyId!)}
                                  disabled={requestingJoin === friendLobby.lobbyId}
                                  className="px-3 py-1.5 rounded-lg bg-[#FF6B4A] text-white text-xs font-medium hover:bg-[#FF8F6B] flex items-center gap-1 disabled:opacity-50"
                                >
                                  {requestingJoin === friendLobby.lobbyId ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Play className="h-3 w-3" />
                                  )}
                                  {requestingJoin === friendLobby.lobbyId ? "Requesting..." : "Request"}
                                </button>
                              )}
                              {/* Invite button - only show if online and not in a lobby with them already */}
                              {online && !friendLobby && onlineFriend && (
                                <button
                                  onClick={() => handleInviteFromLobbyTab(onlineFriend.odId)}
                                  disabled={invitingFriend === onlineFriend.odId}
                                  className="px-3 py-1.5 rounded-lg bg-[#FF6B4A] text-white text-xs font-medium hover:bg-[#FF8F6B] flex items-center gap-1 disabled:opacity-50"
                                >
                                  {invitingFriend === onlineFriend.odId ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <UserPlus className="h-3 w-3" />
                                  )}
                                  Invite
                                </button>
                              )}
                              {/* Offline indicator */}
                              {!online && (
                                <span className={`text-xs ${isDark ? "text-white/30" : "text-gray-400"}`}>
                                  Offline
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
