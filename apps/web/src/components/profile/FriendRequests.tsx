"use client";

import { useState, useEffect } from "react";
import { User, UserCheck, UserX, Loader2, Bell } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import Image from "next/image";

interface FriendRequest {
  id: string;
  sender: {
    id: string;
    username: string | null;
    name: string | null;
    image: string | null;
  };
  createdAt: string;
}

interface SentRequest {
  id: string;
  receiver: {
    id: string;
    username: string | null;
    name: string | null;
    image: string | null;
  };
  createdAt: string;
}

export function FriendRequests() {
  const { isDark } = useThemeStore();
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
  const [sentRequests, setSentRequests] = useState<SentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      const res = await fetch("/api/friends");
      if (res.ok) {
        const data = await res.json();
        setPendingRequests(data.pendingRequests || []);
        setSentRequests(data.sentRequests || []);
      }
    } catch (error) {
      console.error("Failed to fetch requests:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRespond = async (requestId: string, action: "accept" | "reject") => {
    setResponding(requestId);
    try {
      const res = await fetch(`/api/friends/request/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (res.ok) {
        setPendingRequests(pendingRequests.filter((r) => r.id !== requestId));
        // Refresh to get updated friends list if accepted
        if (action === "accept") {
          fetchRequests();
        }
      }
    } catch (error) {
      console.error("Failed to respond to request:", error);
    } finally {
      setResponding(null);
    }
  };

  const handleCancel = async (requestId: string) => {
    setCancelling(requestId);
    try {
      const res = await fetch(`/api/friends/request/${requestId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setSentRequests(sentRequests.filter((r) => r.id !== requestId));
      }
    } catch (error) {
      console.error("Failed to cancel request:", error);
    } finally {
      setCancelling(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2
          className={`h-5 w-5 animate-spin ${
            isDark ? "text-white/40" : "text-gray-400"
          }`}
        />
      </div>
    );
  }

  if (pendingRequests.length === 0 && sentRequests.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Pending Requests (Received) */}
      {pendingRequests.length > 0 && (
        <div>
          <h3
            className={`text-sm font-medium mb-3 flex items-center gap-2 ${
              isDark ? "text-white/80" : "text-gray-700"
            }`}
          >
            <Bell className="h-4 w-4" />
            Friend Requests ({pendingRequests.length})
          </h3>
          <div className="space-y-2">
            {pendingRequests.map((request) => (
              <div
                key={request.id}
                className={`flex items-center gap-3 p-3 rounded-lg ${
                  isDark ? "bg-white/5" : "bg-gray-50"
                }`}
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
                  <p
                    className={`font-medium truncate ${
                      isDark ? "text-white" : "text-gray-900"
                    }`}
                  >
                    {request.sender.name || request.sender.username || "Unknown"}
                  </p>
                  {request.sender.username && (
                    <p
                      className={`text-xs truncate ${
                        isDark ? "text-white/50" : "text-gray-500"
                      }`}
                    >
                      @{request.sender.username}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleRespond(request.id, "accept")}
                    disabled={responding === request.id}
                    className="p-2 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
                    title="Accept"
                  >
                    {responding === request.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserCheck className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => handleRespond(request.id, "reject")}
                    disabled={responding === request.id}
                    className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                    title="Reject"
                  >
                    <UserX className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sent Requests */}
      {sentRequests.length > 0 && (
        <div>
          <h3
            className={`text-sm font-medium mb-3 ${
              isDark ? "text-white/60" : "text-gray-600"
            }`}
          >
            Pending Sent ({sentRequests.length})
          </h3>
          <div className="space-y-2">
            {sentRequests.map((request) => (
              <div
                key={request.id}
                className={`flex items-center gap-3 p-3 rounded-lg ${
                  isDark ? "bg-white/5" : "bg-gray-50"
                }`}
              >
                {request.receiver.image ? (
                  <Image
                    src={request.receiver.image}
                    alt={request.receiver.name || "User"}
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
                  <p
                    className={`font-medium truncate ${
                      isDark ? "text-white" : "text-gray-900"
                    }`}
                  >
                    {request.receiver.name || request.receiver.username || "Unknown"}
                  </p>
                  {request.receiver.username && (
                    <p
                      className={`text-xs truncate ${
                        isDark ? "text-white/50" : "text-gray-500"
                      }`}
                    >
                      @{request.receiver.username}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleCancel(request.id)}
                  disabled={cancelling === request.id}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    isDark
                      ? "bg-white/10 text-white/60 hover:bg-white/20"
                      : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                  }`}
                >
                  {cancelling === request.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Cancel"
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
