"use client";

import { MobileHeader } from "@/components/layout/MobileHeader";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { useThemeStore } from "@/stores/themeStore";

export default function PulseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isDark } = useThemeStore();

  return (
    <AuthGuard>
      <div className={`flex h-screen flex-col ${isDark ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
        {/* Star grid background - only show in dark mode */}
        {isDark && <div className="fixed inset-0 star-grid opacity-20 pointer-events-none" />}

        <MobileHeader />
        <main className="relative z-10 flex-1 overflow-auto pt-24 px-6 pb-6">{children}</main>
      </div>
    </AuthGuard>
  );
}
