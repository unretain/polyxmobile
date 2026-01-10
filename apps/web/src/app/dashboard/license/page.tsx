"use client";

import { useThemeStore } from "@/stores/themeStore";

// Mobile app: License page is not relevant for mobile wallet-only app
// Note: MobileHeader is provided by dashboard/layout.tsx
export default function LicenseDashboard() {
  const { isDark } = useThemeStore();

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-6">
      <div className="text-center">
        <h1 className={`text-2xl font-bold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          License & Billing
        </h1>
        <p className={`${isDark ? 'text-white/50' : 'text-gray-500'}`}>
          License management is available on desktop.
        </p>
      </div>
    </div>
  );
}
