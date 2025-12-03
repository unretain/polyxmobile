"use client";

import { Search } from "lucide-react";
import { useTokenStore } from "@/stores/tokenStore";

export function TokenSearch() {
  const { searchQuery, setSearchQuery } = useTokenStore();

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        placeholder="Search tokens..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-secondary pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary sm:w-64"
      />
    </div>
  );
}
