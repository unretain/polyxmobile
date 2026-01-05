"use client";

import { MobileHeader } from "@/components/layout/MobileHeader";
import { useThemeStore } from "@/stores/themeStore";

// Mobile app: Solutions/API page is not relevant for mobile wallet-only app
export default function SolutionsPage() {
  const { isDark } = useThemeStore();

  return (
    <div className={`min-h-screen ${isDark ? 'bg-[#0a0a0a] text-white' : 'bg-[#f5f5f5] text-black'}`}>
      <MobileHeader />

      <main className="flex items-center justify-center min-h-screen px-6">
        <div className="text-center">
          <h1 className={`text-2xl font-bold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Solutions
          </h1>
          <p className={`${isDark ? 'text-white/50' : 'text-gray-500'}`}>
            API and embed solutions are available on desktop.
          </p>
        </div>
      </main>
    </div>
  );
}
