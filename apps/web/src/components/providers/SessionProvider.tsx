"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextAuthSessionProvider
      // Refetch session when window regains focus (catches cookie deletion)
      refetchOnWindowFocus={true}
      // Refetch every 5 minutes to catch session expiry
      refetchInterval={5 * 60}
    >
      {children}
    </NextAuthSessionProvider>
  );
}
