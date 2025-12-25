"use client";

import { useState, useEffect } from "react";
import { User, Users, Loader2, UserMinus, MessageCircle } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import Image from "next/image";

interface Friend {
  id: string;
  username: string | null;
  name: string | null;
  image: string | null;
}

export function FriendsList() {
  const { isDark } = useThemeStore();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    fetchFriends();
  }, []);

  const fetchFriends = async () => {
    try {
      const res = await fetch("/api/friends");
      if (res.ok) {
        const data = await res.json();
        setFriends(data.friends || []);
      }
    } catch (error) {
      console.error("Failed to fetch friends:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFriend = async (friendId: string) => {
    setRemoving(friendId);
    try {
      const res = await fetch(`/api/friends/${friendId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setFriends(friends.filter((f) => f.id !== friendId));
      }
    } catch (error) {
      console.error("Failed to remove friend:", error);
    } finally {
      setRemoving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2
          className={`h-6 w-6 animate-spin ${
            isDark ? "text-white/40" : "text-gray-400"
          }`}
        />
      </div>
    );
  }

  return (
    <div>
      <h3
        className={`text-sm font-medium mb-3 flex items-center gap-2 ${
          isDark ? "text-white/80" : "text-gray-700"
        }`}
      >
        <Users className="h-4 w-4" />
        Friends ({friends.length})
      </h3>

      {friends.length === 0 ? (
        <p
          className={`text-sm text-center py-8 ${
            isDark ? "text-white/40" : "text-gray-400"
          }`}
        >
          No friends yet. Add friends by username above!
        </p>
      ) : (
        <div className="space-y-2">
          {friends.map((friend) => (
            <div
              key={friend.id}
              className={`flex items-center gap-3 p-3 rounded-lg ${
                isDark ? "bg-white/5" : "bg-gray-50"
              }`}
            >
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
              <div className="flex-1 min-w-0">
                <p
                  className={`font-medium truncate ${
                    isDark ? "text-white" : "text-gray-900"
                  }`}
                >
                  {friend.name || friend.username || "Unknown"}
                </p>
                {friend.username && (
                  <p
                    className={`text-xs truncate ${
                      isDark ? "text-white/50" : "text-gray-500"
                    }`}
                  >
                    @{friend.username}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleRemoveFriend(friend.id)}
                  disabled={removing === friend.id}
                  className={`p-2 rounded-lg transition-colors ${
                    isDark
                      ? "hover:bg-white/10 text-white/40 hover:text-red-400"
                      : "hover:bg-gray-100 text-gray-400 hover:text-red-500"
                  }`}
                  title="Remove friend"
                >
                  {removing === friend.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserMinus className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
