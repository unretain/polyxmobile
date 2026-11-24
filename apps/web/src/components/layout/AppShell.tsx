"use client";

import { MobileHeader } from "@/components/layout/MobileHeader";
import { BottomNav } from "@/components/layout/BottomNav";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { useThemeStore } from "@/stores/themeStore";

interface AppShellProps {
  children: React.ReactNode;
  /** Redirect to onboarding when there's no wallet (default true). */
  guard?: boolean;
}

/**
 * The one app frame: background, floating header, scrollable content, bottom
 * tab bar. Every section layout renders this instead of hand-rolling the same
 * boilerplate (which is how the six copies drifted apart).
 */
export function AppShell({ children, guard = true }: AppShellProps) {
  const { isDark } = useThemeStore();

  const frame = (
    <div className={`flex h-dvh flex-col ${isDark ? "bg-[#0a0a0a]" : "bg-gray-50"}`}>
      {isDark && <div className="fixed inset-0 star-grid opacity-20 pointer-events-none" />}
      <MobileHeader />
      <main
        className="relative z-10 flex-1 overflow-auto pt-20 px-4 sm:px-6"
        style={{ paddingBottom: "calc(max(env(safe-area-inset-bottom), 12px) + 84px)" }}
      >
        {children}
      </main>
      <BottomNav />
    </div>
  );

  return guard ? <AuthGuard>{frame}</AuthGuard> : frame;
}
