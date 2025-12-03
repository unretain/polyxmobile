"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useAuthStore } from "@/stores/authStore";

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { isAuthenticated, isLoading: zustandLoading, checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Check both NextAuth session and Zustand auth store
  const isNextAuthLoading = status === "loading";
  const isLoggedIn = session?.user || isAuthenticated;
  const isLoading = isNextAuthLoading || zustandLoading;

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      // Redirect to landing page with auth=true query param to trigger modal
      router.push("/?auth=true");
    }
  }, [isLoggedIn, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
      </div>
    );
  }

  if (!isLoggedIn) {
    return null;
  }

  return <>{children}</>;
}
