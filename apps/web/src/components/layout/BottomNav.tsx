"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, LayoutGrid, PieChart, Wallet } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";

const TABS = [
  { href: "/pulse", label: "Pulse", icon: Activity },
  { href: "/dashboard", label: "Charts", icon: LayoutGrid },
  { href: "/portfolio", label: "Portfolio", icon: PieChart },
  { href: "/wallet", label: "Wallet", icon: Wallet },
] as const;

/**
 * iOS-style bottom tab bar — the primary navigation on mobile (the Capacitor
 * app). The hamburger menu in MobileHeader keeps the long tail (3x wallet,
 * docs, legal); these four tabs are the app.
 */
export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { isDark } = useThemeStore();
  const { wallet } = useMobileWalletStore();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 px-4"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
    >
      <div
        className={`mx-auto max-w-md grid grid-cols-4 rounded-2xl border backdrop-blur-xl shadow-lg ${
          isDark ? "bg-[#141414]/90 border-white/10" : "bg-white/90 border-black/10"
        }`}
      >
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              onClick={(e) => {
                if (!wallet) {
                  e.preventDefault();
                  router.push("/"); // no wallet yet → onboarding
                }
              }}
              className="flex flex-col items-center gap-0.5 py-2.5 select-none"
            >
              <Icon
                className={`h-5 w-5 transition-colors ${
                  active ? "text-[#FF6B4A]" : isDark ? "text-white/40" : "text-black/40"
                }`}
                strokeWidth={active ? 2.4 : 2}
              />
              <span
                className={`text-[10px] font-medium transition-colors ${
                  active ? "text-[#FF6B4A]" : isDark ? "text-white/40" : "text-black/40"
                }`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
