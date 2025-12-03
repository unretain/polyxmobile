"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { LogOut, User, Shield, Copy, Check, Key, ChevronDown } from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import { useAuthStore } from "@/stores/authStore";
import { useState, useRef, useEffect } from "react";
import { shortenAddress } from "@/lib/wallet";
import { getUserById } from "@/lib/userDb";

export function Header() {
  const router = useRouter();
  const { data: session } = useSession();
  const { user, logout } = useAuthStore();
  const [copied, setCopied] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [privateKeyCopied, setPrivateKeyCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Use Zustand user first (has wallet info), fallback to NextAuth session
  const currentUser = user || session?.user;
  const walletAddress = user?.wallet;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setShowDropdown(false);
    await signOut({ redirect: false });
    logout();
    router.push("/");
  };

  const handleOpenSecurity = () => {
    setShowDropdown(false);
    // Get the stored user to retrieve the encrypted private key
    if (user?.id) {
      const storedUser = getUserById(user.id);
      if (storedUser?.wallet?.encryptedSecretKey) {
        // For demo, we'll show the encrypted key (in production, you'd decrypt it)
        setPrivateKey(atob(storedUser.wallet.encryptedSecretKey).replace(/.*/, storedUser.wallet.encryptedSecretKey));
      }
    }
    setShowSecurityModal(true);
  };

  const handleCopyPrivateKey = async () => {
    if (privateKey) {
      await navigator.clipboard.writeText(privateKey);
      setPrivateKeyCopied(true);
      setTimeout(() => setPrivateKeyCopied(false), 2000);
    }
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          {/* Left - Logo */}
          <Link href="/" className="flex items-center px-4 py-2 rounded-full border backdrop-blur-md bg-white/5 border-white/10 hover:bg-white/10 transition-colors">
            <span className="font-medium text-sm">[<span className="text-white">poly</span><span className="text-[#FF6B4A]">x</span>]</span>
          </Link>

          {/* Spacer to push nav and wallet/account to the right of logo */}
          <div className="flex-1" />

          {/* Center - Navigation */}
          <nav className="flex items-center gap-1 px-2 py-1.5 rounded-full border backdrop-blur-md bg-white/5 border-white/10">
            <Link
              href="/pulse"
              className="px-4 py-1.5 rounded-full text-sm font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              Pulse
            </Link>
            <Link
              href="/dashboard"
              className="px-4 py-1.5 rounded-full text-sm font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/solutions"
              className="px-4 py-1.5 rounded-full text-sm font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              Solutions
            </Link>
            <Link
              href="/markets"
              className="px-4 py-1.5 rounded-full text-sm font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              Markets
            </Link>
          </nav>

          {/* Right - Wallet & User Menu */}
          <div className="flex items-center gap-2">
            {/* Wallet Balance - shown first */}
            {walletAddress && (
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(walletAddress);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex items-center gap-2 rounded-full border backdrop-blur-md bg-white/5 border-white/10 px-3 py-2 text-sm font-medium transition-colors hover:bg-white/10"
                title="Click to copy address"
              >
                <Image
                  src="/solana-logo.png"
                  alt="Solana"
                  width={20}
                  height={20}
                  className="rounded-full"
                />
                <span className="text-white font-medium">0.00</span>
                <span className="text-white/40">SOL</span>
                <div className="w-px h-4 bg-white/10" />
                <span className="text-white/60">{shortenAddress(walletAddress)}</span>
                {copied ? (
                  <Check className="h-3 w-3 text-green-400" />
                ) : (
                  <Copy className="h-3 w-3 text-white/40" />
                )}
              </button>
            )}

            {/* User Account Dropdown */}
            {currentUser && (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="flex items-center gap-2 px-3 py-2 rounded-full border backdrop-blur-md bg-white/5 border-white/10 hover:bg-white/10 transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF8F6B] flex items-center justify-center">
                    <User className="h-4 w-4 text-white" />
                  </div>
                  {user?.twoFactorEnabled && (
                    <Shield className="h-3 w-3 text-green-500" />
                  )}
                  <ChevronDown className={`h-4 w-4 text-white/40 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu */}
                {showDropdown && (
                  <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border backdrop-blur-md bg-[#111]/95 border-white/10 shadow-xl overflow-hidden">
                    {/* User Info */}
                    <div className="px-4 py-3 border-b border-white/10">
                      <p className="text-sm font-medium text-white truncate">{currentUser.name || currentUser.email}</p>
                      {walletAddress && (
                        <p className="text-xs text-white/40 mt-1">{shortenAddress(walletAddress)}</p>
                      )}
                    </div>

                    {/* Menu Items */}
                    <div className="py-1">
                      <button
                        onClick={handleOpenSecurity}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                      >
                        <Key className="h-4 w-4" />
                        Security
                      </button>
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                      >
                        <LogOut className="h-4 w-4" />
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Security Modal */}
      {showSecurityModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowSecurityModal(false)} />
          <div className="relative w-full max-w-md bg-[#0f0f0f] border border-white/10 rounded-2xl shadow-2xl">
            <div className="p-6 border-b border-white/10">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Shield className="h-5 w-5 text-[#FF6B4A]" />
                Security
              </h2>
            </div>

            <div className="p-6 space-y-4">
              {/* 2FA Status */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-3">
                  <Shield className={`h-5 w-5 ${user?.twoFactorEnabled ? 'text-green-500' : 'text-white/40'}`} />
                  <div>
                    <p className="text-sm font-medium text-white">Two-Factor Authentication</p>
                    <p className="text-xs text-white/40">{user?.twoFactorEnabled ? 'Enabled' : 'Not enabled'}</p>
                  </div>
                </div>
                <div className={`px-2 py-1 rounded-full text-xs font-medium ${user?.twoFactorEnabled ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40'}`}>
                  {user?.twoFactorEnabled ? 'Active' : 'Off'}
                </div>
              </div>

              {/* Wallet Info */}
              {walletAddress && (
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-3 mb-3">
                    <Image
                      src="/solana-logo.png"
                      alt="Solana"
                      width={20}
                      height={20}
                      className="rounded-full"
                    />
                    <p className="text-sm font-medium text-white">Wallet Address</p>
                  </div>
                  <p className="font-mono text-xs text-white/60 break-all select-all bg-black/30 rounded-lg p-3">
                    {walletAddress}
                  </p>
                </div>
              )}

              {/* Private Key Section */}
              {user?.id && (
                <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                  <div className="flex items-center gap-3 mb-3">
                    <Key className="h-5 w-5 text-red-400" />
                    <p className="text-sm font-medium text-red-400">Private Key</p>
                  </div>
                  <p className="text-xs text-white/50 mb-3">
                    Warning: Never share your private key with anyone. Anyone with your private key can access your funds.
                  </p>
                  {privateKey ? (
                    <div className="space-y-2">
                      <p className="font-mono text-xs text-white/60 break-all select-all bg-black/30 rounded-lg p-3">
                        {privateKey}
                      </p>
                      <button
                        onClick={handleCopyPrivateKey}
                        className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        {privateKeyCopied ? (
                          <>
                            <Check className="h-3 w-3" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            Copy Private Key
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-white/40 italic">
                      Private key not available (Phantom wallet or external wallet)
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="p-6 border-t border-white/10">
              <button
                onClick={() => setShowSecurityModal(false)}
                className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
