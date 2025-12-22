"use client";

import { useEffect } from "react";
import { TokenCard } from "./TokenCard";
import { useTokenStore } from "@/stores/tokenStore";
import { Loader2 } from "lucide-react";

export function TokenList() {
  const { tokens, isLoading, error, fetchTokens, searchQuery, connectRealtime, disconnectRealtime } = useTokenStore();

  useEffect(() => {
    // Fetch initial data
    fetchTokens();

    // Connect to WebSocket for real-time price updates
    connectRealtime();

    // Cleanup on unmount
    return () => {
      disconnectRealtime();
    };
  }, [fetchTokens, connectRealtime, disconnectRealtime]);

  // Filter tokens by search query
  const filteredTokens = tokens.filter((token) => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    return (
      token.symbol.toLowerCase().includes(query) ||
      token.name.toLowerCase().includes(query) ||
      token.address.toLowerCase().includes(query)
    );
  });

  if (isLoading && tokens.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-destructive">{error}</p>
        <button
          onClick={() => fetchTokens()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    );
  }

  if (filteredTokens.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground">No tokens found</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {filteredTokens.map((token) => (
        <TokenCard key={token.address} token={token} />
      ))}
    </div>
  );
}
