"use client";

import { useState } from "react";
import { UserPlus, Loader2, Check, Search } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";

export function AddFriendForm() {
  const { isDark } = useThemeStore();
  const [username, setUsername] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setSending(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to send request");
      }

      setSuccess(data.message || "Friend request sent!");
      setUsername("");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send request");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h3
        className={`text-sm font-medium mb-3 flex items-center gap-2 ${
          isDark ? "text-white/80" : "text-gray-700"
        }`}
      >
        <UserPlus className="h-4 w-4" />
        Add Friend
      </h3>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <Search
            className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${
              isDark ? "text-white/40" : "text-gray-400"
            }`}
          />
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z]/g, ""))}
            placeholder="Enter username..."
            maxLength={9}
            className={`w-full pl-10 pr-3 py-2 rounded-lg border outline-none focus:border-[#FF6B4A]/50 text-sm ${
              isDark
                ? "bg-white/5 text-white border-white/10 placeholder:text-white/30"
                : "bg-white text-gray-900 border-gray-200 placeholder:text-gray-400"
            }`}
          />
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 p-2 rounded">
            {error}
          </p>
        )}
        {success && (
          <p className="text-xs text-green-400 bg-green-500/10 p-2 rounded flex items-center gap-1">
            <Check className="h-3 w-3" />
            {success}
          </p>
        )}

        <button
          type="submit"
          disabled={!username.trim() || sending}
          className={`w-full py-2 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 ${
            !username.trim() || sending
              ? isDark
                ? "bg-white/10 text-white/40 cursor-not-allowed"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-[#FF6B4A] text-white hover:bg-[#FF8F6B]"
          }`}
        >
          {sending ? (
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
  );
}
