"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Sun, Moon, Menu, X, Wallet } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { useState } from "react";
import { shortenAddress } from "@/lib/wallet";

export function MobileHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { isDark, toggleTheme } = useThemeStore();
  const { wallet } = useMobileWalletStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (path: string) => pathname === path;

  // Handle nav click - redirect to home if no wallet (to trigger onboarding)
  const handleNavClick = (e: React.MouseEvent, path: string) => {
    setMobileMenuOpen(false);
    if (!wallet) {
      e.preventDefault();
      router.push("/"); // Go to home to create wallet first
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
            {/* Theme Toggle */}
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

            {/* Menu Button */}
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

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className={`absolute top-full left-0 right-0 mt-2 mx-4 rounded-2xl border backdrop-blur-md shadow-xl overflow-hidden ${
            isDark ? 'bg-[#1a1a1a]/95 border-white/10' : 'bg-white/95 border-black/10'
          }`}>
            {/* Navigation Links */}
            <div className={`p-2 ${wallet ? `border-b ${isDark ? 'border-white/10' : 'border-black/10'}` : ''}`}>
              <Link
                href="/pulse"
                onClick={(e) => handleNavClick(e, "/pulse")}
                className={`block px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  isActive('/pulse')
                    ? 'bg-[#FF6B4A] text-white'
                    : isDark
                      ? 'text-white/70 hover:bg-white/5'
                      : 'text-black/70 hover:bg-black/5'
                }`}
              >
                Pulse
              </Link>
              <Link
                href="/dashboard"
                onClick={(e) => handleNavClick(e, "/dashboard")}
                className={`block px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  isActive('/dashboard')
                    ? 'bg-[#FF6B4A] text-white'
                    : isDark
                      ? 'text-white/70 hover:bg-white/5'
                      : 'text-black/70 hover:bg-black/5'
                }`}
              >
                Dashboard
              </Link>
            </div>

            {/* Wallet Info (if user has wallet) */}
            {wallet && (
              <div className="p-3">
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${
                  isDark ? 'bg-white/5' : 'bg-black/5'
                }`}>
                  <Wallet className={`h-4 w-4 ${isDark ? 'text-white/60' : 'text-black/60'}`} />
                  <span className={`font-mono text-sm ${isDark ? 'text-white/60' : 'text-black/60'}`}>
                    {shortenAddress(wallet.publicKey)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </header>
    </>
  );
}
