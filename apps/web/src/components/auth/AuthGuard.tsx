"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const { wallet } = useMobileWalletStore();
  const [isHydrated, setIsHydrated] = useState(false);

  // Wait for client-side hydration (zustand persist loads from localStorage)
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (isHydrated && !wallet) {
      // Redirect to home to trigger wallet onboarding
      router.push("/");
    }
  }, [wallet, isHydrated, router]);

  // Show loading while hydrating
  if (!isHydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
      </div>
    );
  }

  // No wallet, will redirect
  if (!wallet) {
    return null;
  }

  return <>{children}</>;
}
