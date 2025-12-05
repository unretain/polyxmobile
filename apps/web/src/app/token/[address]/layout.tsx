"use client";

import { Header } from "@/components/layout/Header";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { useThemeStore } from "@/stores/themeStore";

export default function TokenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isDark } = useThemeStore();

  return (
    <AuthGuard>
      <div className={`flex h-screen flex-col ${isDark ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
        {/* Star grid background */}
        <div className={`fixed inset-0 star-grid pointer-events-none ${isDark ? 'opacity-20' : 'opacity-10'}`} />

        <Header />
        <main className="relative z-10 flex-1 overflow-auto pt-24 px-6 pb-6">{children}</main>
      </div>
    </AuthGuard>
  );
}
