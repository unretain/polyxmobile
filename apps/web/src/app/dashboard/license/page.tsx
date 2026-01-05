"use client";

import { MobileHeader } from "@/components/layout/MobileHeader";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { useThemeStore } from "@/stores/themeStore";

// Mobile app: License page is not relevant for mobile wallet-only app
export default function LicenseDashboard() {
  const { isDark } = useThemeStore();

  return (
    <AuthGuard>
      <div className={`min-h-screen ${isDark ? 'bg-[#0a0a0a] text-white' : 'bg-[#f5f5f5] text-black'}`}>
        <MobileHeader />

        <main className="flex items-center justify-center min-h-screen px-6">
          <div className="text-center">
            <h1 className={`text-2xl font-bold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              License & Billing
            </h1>
            <p className={`${isDark ? 'text-white/50' : 'text-gray-500'}`}>
              License management is available on desktop.
            </p>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}
