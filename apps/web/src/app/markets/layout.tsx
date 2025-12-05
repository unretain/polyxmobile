"use client";

import { Header } from "@/components/layout/Header";
import { useThemeStore } from "@/stores/themeStore";

export default function MarketsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isDark } = useThemeStore();

  return (
    <div className={`flex h-screen flex-col ${isDark ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
      {/* Star grid background - only show in dark mode */}
      {isDark && <div className="fixed inset-0 star-grid opacity-20 pointer-events-none" />}

      <Header />
      <main className="relative z-10 flex-1 overflow-auto pt-24 px-6 pb-6">{children}</main>
    </div>
  );
}
