"use client";

import { MobileHeader } from "@/components/layout/MobileHeader";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { useThemeStore } from "@/stores/themeStore";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";

// Mobile app: Portfolio page - shows wallet info for mobile wallet-only app
export default function PortfolioPage() {
  const { isDark } = useThemeStore();
  const { wallet } = useMobileWalletStore();

  return (
    <AuthGuard>
      <div className={`min-h-screen ${isDark ? 'bg-[#0a0a0a] text-white' : 'bg-[#f5f5f5] text-black'}`}>
        <MobileHeader />

        <main className="pt-24 px-4 pb-6">
          <h1 className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Portfolio
          </h1>

          {wallet && (
            <div className={`p-4 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
              <p className={`text-sm mb-2 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>Wallet Address</p>
              <p className={`font-mono text-sm break-all ${isDark ? 'text-[#FF6B4A]' : 'text-[#FF6B4A]'}`}>
                {wallet.publicKey}
              </p>
            </div>
          )}

          <div className={`mt-6 text-center ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
            <p className="text-sm">
              Portfolio tracking coming soon
            </p>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}
