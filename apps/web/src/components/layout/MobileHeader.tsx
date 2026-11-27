"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Sun, Moon, Menu, X, Wallet, Settings as SettingsIcon } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { useState, useEffect } from "react";
import { shortenAddress } from "@/lib/wallet";

const NAV = [
  { href: "/pulse", label: "Pulse" },
  { href: "/dashboard", label: "Trending" },
  { href: "/launch", label: "Launch" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/coldstick", label: "3x Wallet" },
];

export function MobileHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { isDark, toggleTheme } = useThemeStore();
  const { wallet } = useMobileWalletStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);


  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");

  // No wallet yet → everything routes to onboarding first.
  const handleNavClick = (e: React.MouseEvent) => {
    setMobileMenuOpen(false);
    if (!wallet) {
      e.preventDefault();
      router.push("/");
    }
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className={`flex items-center px-3 py-1.5 rounded-full border backdrop-blur-sm ${
            isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
          }`}>
            <span className={`font-medium text-sm ${isDark ? 'text-white' : 'text-black'}`}>[poly<span className="text-[#FF6B4A]">x</span>]</span>
          </Link>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className={`p-2 rounded-full border backdrop-blur-md transition-colors ${
                isDark
                  ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white/60'
                  : 'bg-black/5 border-black/10 hover:bg-black/10 text-black/60'
              }`}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className={`p-2 rounded-full border backdrop-blur-md transition-colors ${
                isDark
                  ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white'
                  : 'bg-black/5 border-black/10 hover:bg-black/10 text-black'
              }`}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Menu */}
      {mobileMenuOpen && (
        <>
          {/* Click-away backdrop */}
          <div className="fixed inset-0 z-[90]" onClick={() => setMobileMenuOpen(false)} />
          <div className={`fixed top-14 right-4 left-4 sm:left-auto sm:w-72 z-[100] rounded-2xl border backdrop-blur-md shadow-xl overflow-hidden ${
            isDark ? 'bg-[#161412]/95 border-white/10' : 'bg-white/95 border-black/10'
          }`}>
            <nav className={`p-2 ${wallet ? `border-b ${isDark ? 'border-white/10' : 'border-black/10'}` : ''}`}>
              {NAV.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={handleNavClick}
                  className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-colors ${
                    isActive(href)
                      ? 'text-[#FF6B4A] font-semibold ' + (isDark ? 'bg-white/5' : 'bg-black/5')
                      : isDark
                        ? 'text-white/70 font-medium hover:bg-white/5'
                        : 'text-black/70 font-medium hover:bg-black/5'
                  }`}
                >
                  {label}
                  {isActive(href) && <span className="h-1.5 w-1.5 rounded-full bg-[#FF6B4A]" />}
                </Link>
              ))}
            </nav>

            {wallet && (
              <div className="p-2 space-y-1">
                <Link
                  href="/settings"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10' : 'bg-black/5 hover:bg-black/10'}`}
                >
                  <SettingsIcon className="h-4 w-4 text-[#FF6B4A]" />
                  <span className={`text-sm ${isDark ? 'text-white/70' : 'text-black/70'}`}>Settings</span>
                  <span className={`ml-auto text-xs ${isDark ? 'text-white/40' : 'text-black/40'}`}>→</span>
                </Link>
                <Link
                  href="/wallet"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                    isDark ? 'bg-white/5 hover:bg-white/10' : 'bg-black/5 hover:bg-black/10'
                  }`}
                >
                  <Wallet className="h-4 w-4 text-[#FF6B4A]" />
                  <span className={`font-mono text-sm ${isDark ? 'text-white/60' : 'text-black/60'}`}>
                    {shortenAddress(wallet.publicKey)}
                  </span>
                  <span className={`ml-auto text-xs ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                    Buy / Swap / Withdraw →
                  </span>
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
