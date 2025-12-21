"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { LogOut, User, Shield, Copy, Check, Key, ChevronDown, Sun, Moon, CreditCard, Wallet, Loader2, ExternalLink, ArrowUpRight, Mail, PieChart } from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import { useState, useRef, useEffect, useCallback } from "react";
import { shortenAddress } from "@/lib/wallet";
import { AuthModal } from "@/components/auth/AuthModal";

// Extended session user type with our custom fields
interface SessionUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  walletAddress?: string;
  twoFactorEnabled?: boolean;
}

interface BalanceResponse {
  walletAddress: string;
  sol: {
    mint: string;
    balance: string;
    uiBalance: number;
    decimals: number;
  };
  tokens: Array<{
    mint: string;
    balance: string;
    uiBalance: number;
    decimals: number;
  }>;
}

// Routes that require authentication
const protectedRoutes = ["/dashboard", "/pulse", "/markets", "/token"];

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const { logout } = useAuthStore();
  const { isDark, toggleTheme } = useThemeStore();
  const [copied, setCopied] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [privateKeyLoading, setPrivateKeyLoading] = useState(false);
  const [privateKeyCopied, setPrivateKeyCopied] = useState(false);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentUser = session?.user as SessionUser | undefined;
  const walletAddress = currentUser?.walletAddress;
  const twoFactorEnabled = currentUser?.twoFactorEnabled;
  const isAuthenticated = status === "authenticated";

  // Check if a route is protected
  const isProtectedRoute = (path: string) => {
    return protectedRoutes.some(
      (route) => path === route || path.startsWith(`${route}/`)
    );
  };

  // Check if current path matches
  const isActive = (path: string) => pathname === path;

  // Handle nav link click - show auth modal for protected routes if not authenticated
  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (isProtectedRoute(path) && !isAuthenticated) {
      e.preventDefault();
      setPendingRedirect(path);
      setAuthMode("signin");
      setIsAuthModalOpen(true);
    }
  };

  // Handle successful auth - redirect to pending route
  const handleAuthClose = () => {
    setIsAuthModalOpen(false);
    // If user successfully authenticated and there's a pending redirect, navigate there
    if (isAuthenticated && pendingRedirect) {
      router.push(pendingRedirect);
      setPendingRedirect(null);
    }
  };

  // Check for redirect param in URL (from middleware auth redirect)
  useEffect(() => {
    const redirectPath = searchParams.get("redirect");
    if (redirectPath && !isAuthenticated && status !== "loading") {
      // User was redirected here by middleware - open auth modal
      setPendingRedirect(redirectPath);
      setAuthMode("signin");
      setIsAuthModalOpen(true);
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete("redirect");
      window.history.replaceState({}, "", url.pathname);
    }
  }, [searchParams, isAuthenticated, status]);

  // Watch for auth state changes to handle redirect after login
  useEffect(() => {
    if (isAuthenticated && pendingRedirect) {
      router.push(pendingRedirect);
      setPendingRedirect(null);
      setIsAuthModalOpen(false);
    }
  }, [isAuthenticated, pendingRedirect, router]);

  // Fetch balance
  const fetchBalance = useCallback(async () => {
    if (status !== "authenticated") return;
    setBalanceLoading(true);
    try {
      const res = await fetch("/api/trading/balance");
      if (res.ok) {
        const data = await res.json();
        setBalance(data);
      }
    } catch (err) {
      console.error("Failed to fetch balance:", err);
    } finally {
      setBalanceLoading(false);
    }
  }, [status]);

  // Fetch balance on mount and when authenticated
  useEffect(() => {
    if (status === "authenticated") {
      fetchBalance();
    }
  }, [status, fetchBalance]);

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

  const handleOpenSecurity = async () => {
    setShowDropdown(false);
    setPrivateKey(null);
    setPrivateKeyLoading(true);
    setShowSecurityModal(true);

    // Fetch private key from API
    try {
      const res = await fetch("/api/wallet/private-key");
      if (res.ok) {
        const data = await res.json();
        setPrivateKey(data.privateKey);
      }
    } catch (err) {
      console.error("Failed to fetch private key:", err);
    } finally {
      setPrivateKeyLoading(false);
    }
  };

  const handleOpenWallet = () => {
    setShowDropdown(false);
    setWithdrawAddress("");
    setWithdrawAmount("");
    setWithdrawError(null);
    setWithdrawSuccess(null);
    setShowWalletModal(true);
    fetchBalance();
  };

  const handleCopyPrivateKey = async () => {
    if (privateKey) {
      await navigator.clipboard.writeText(privateKey);
      setPrivateKeyCopied(true);
      setTimeout(() => setPrivateKeyCopied(false), 2000);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAddress || !withdrawAmount) return;

    setWithdrawing(true);
    setWithdrawError(null);
    setWithdrawSuccess(null);

    try {
      const res = await fetch("/api/trading/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationAddress: withdrawAddress,
          amount: withdrawAmount,
          tokenMint: null, // SOL
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Withdrawal failed");
      }

      setWithdrawSuccess(`Sent ${withdrawAmount} SOL successfully!`);
      setWithdrawAddress("");
      setWithdrawAmount("");
      fetchBalance();

      if (data.explorerUrl) {
        window.open(data.explorerUrl, "_blank");
      }
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Withdrawal failed");
    } finally {
      setWithdrawing(false);
    }
  };

  const openAuthModal = (mode: "signin" | "signup") => {
    setAuthMode(mode);
    setIsAuthModalOpen(true);
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 px-6 md:px-10 lg:px-16 py-5">
        <div className="max-w-[1600px] mx-auto flex items-center relative">
          {/* Left - Logo */}
          <Link href="/" className={`flex items-center px-4 py-2 rounded-full border backdrop-blur-sm ${
            isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
          }`}>
            <span className={`font-medium text-sm ${isDark ? 'text-white' : 'text-black'}`}>[poly<span className="text-[#FF6B4A]">x</span>]</span>
          </Link>

          {/* Center - Navigation (absolutely positioned to stay centered) */}
          <nav className={`absolute left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-full border backdrop-blur-sm ${
            isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'
          }`}>
            <Link
              href="/pulse"
              onClick={(e) => handleNavClick(e, "/pulse")}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive('/pulse')
                  ? 'bg-[#FF6B4A] text-white'
                  : isDark
                    ? 'text-white/60 hover:text-white hover:bg-white/10'
                    : 'text-black/60 hover:text-black hover:bg-black/10'
              }`}
            >
              Pulse
            </Link>
            <Link
              href="/dashboard"
              onClick={(e) => handleNavClick(e, "/dashboard")}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive('/dashboard')
                  ? 'bg-[#FF6B4A] text-white'
                  : isDark
                    ? 'text-white/60 hover:text-white hover:bg-white/10'
                    : 'text-black/60 hover:text-black hover:bg-black/10'
              }`}
            >
              Dashboard
            </Link>
            <Link
              href="/solutions"
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive('/solutions')
                  ? 'bg-[#FF6B4A] text-white'
                  : isDark
                    ? 'text-white/60 hover:text-white hover:bg-white/10'
                    : 'text-black/60 hover:text-black hover:bg-black/10'
              }`}
            >
              Solutions
            </Link>
            <Link
              href="/markets"
              onClick={(e) => handleNavClick(e, "/markets")}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive('/markets')
                  ? 'bg-[#FF6B4A] text-white'
                  : isDark
                    ? 'text-white/60 hover:text-white hover:bg-white/10'
                    : 'text-black/60 hover:text-black hover:bg-black/10'
              }`}
            >
              Markets
            </Link>
          </nav>

          {/* Right - Actions (ml-auto pushes to right) */}
          <div className="flex items-center gap-2 ml-auto">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className={`p-2.5 rounded-full border backdrop-blur-md transition-colors ${
                isDark
                  ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white/60 hover:text-white'
                  : 'bg-black/5 border-black/10 hover:bg-black/10 text-black/60 hover:text-black'
              }`}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* Show wallet and user menu when logged in */}
            {currentUser ? (
              <>
                {/* Wallet Balance - clickable to open wallet modal */}
                {walletAddress && (
                  <button
                    onClick={handleOpenWallet}
                    className={`flex items-center gap-2 rounded-full border backdrop-blur-md px-3 py-2 text-sm font-medium transition-colors ${
                      isDark
                        ? 'bg-white/5 border-white/10 hover:bg-white/10'
                        : 'bg-black/5 border-black/10 hover:bg-black/10'
                    }`}
                    title="Open wallet"
                  >
                    <Image
                      src="/solana-logo.png"
                      alt="Solana"
                      width={20}
                      height={20}
                      className="rounded-full"
                    />
                    <span className={`font-medium ${isDark ? 'text-white' : 'text-black'}`}>
                      {balance ? balance.sol.uiBalance.toFixed(4) : "0.00"}
                    </span>
                    <span className={isDark ? 'text-white/40' : 'text-black/40'}>SOL</span>
                    <div className={`w-px h-4 ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
                    <span className={isDark ? 'text-white/60' : 'text-black/60'}>{shortenAddress(walletAddress)}</span>
                    <Wallet className={`h-3 w-3 ${isDark ? 'text-white/40' : 'text-black/40'}`} />
                  </button>
                )}

                {/* User Account Dropdown */}
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setShowDropdown(!showDropdown)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-full border backdrop-blur-md transition-colors ${
                      isDark
                        ? 'bg-white/5 border-white/10 hover:bg-white/10'
                        : 'bg-black/5 border-black/10 hover:bg-black/10'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF8F6B] flex items-center justify-center">
                      <User className="h-4 w-4 text-white" />
                    </div>
                    {twoFactorEnabled && (
                      <Shield className="h-3 w-3 text-green-500" />
                    )}
                    <ChevronDown className={`h-4 w-4 transition-transform ${isDark ? 'text-white/40' : 'text-black/40'} ${showDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Dropdown Menu */}
                  {showDropdown && (
                    <div className={`absolute right-0 top-full mt-2 w-56 rounded-xl border backdrop-blur-md shadow-xl overflow-hidden ${
                      isDark ? 'bg-[#1a1a1a]/95 border-white/10' : 'bg-white/95 border-black/10'
                    }`}>
                      {/* User Info */}
                      <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                        <p className={`text-sm font-medium truncate ${isDark ? 'text-white' : 'text-black'}`}>{currentUser.name || currentUser.email}</p>
                        {walletAddress && (
                          <p className={`text-xs mt-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{shortenAddress(walletAddress)}</p>
                        )}
                      </div>

                      {/* Menu Items */}
                      <div className="py-1">
                        <Link
                          href="/portfolio"
                          onClick={() => setShowDropdown(false)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                            isDark ? 'text-white/70 hover:text-white hover:bg-white/5' : 'text-black/70 hover:text-black hover:bg-black/5'
                          }`}
                        >
                          <PieChart className="h-4 w-4" />
                          Portfolio
                        </Link>
                        <Link
                          href="/dashboard/license"
                          onClick={() => setShowDropdown(false)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                            isDark ? 'text-white/70 hover:text-white hover:bg-white/5' : 'text-black/70 hover:text-black hover:bg-black/5'
                          }`}
                        >
                          <CreditCard className="h-4 w-4" />
                          License & Billing
                        </Link>
                        <button
                          onClick={handleOpenSecurity}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                            isDark ? 'text-white/70 hover:text-white hover:bg-white/5' : 'text-black/70 hover:text-black hover:bg-black/5'
                          }`}
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
              </>
            ) : (
              <>
                {/* Login/Signup buttons when not logged in */}
                <button
                  onClick={() => openAuthModal("signin")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-all ${
                    isDark
                      ? 'bg-white/5 border-white/10 text-white hover:bg-white/10'
                      : 'bg-black/5 border-black/10 text-black hover:bg-black/10'
                  }`}
                >
                  <Mail className="w-4 h-4" />
                  <span>Log In</span>
                </button>
                <button
                  onClick={() => openAuthModal("signup")}
                  className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all bg-[#FF6B4A] text-white hover:bg-[#FF5A36]"
                >
                  <Wallet className="w-4 h-4" />
                  <span>Sign Up</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={handleAuthClose}
        mode={authMode}
      />

      {/* Wallet Modal */}
      {showWalletModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className={`absolute inset-0 backdrop-blur-sm ${isDark ? 'bg-black/80' : 'bg-black/50'}`} onClick={() => setShowWalletModal(false)} />
          <div className={`relative w-full max-w-md border rounded-2xl shadow-2xl ${isDark ? 'bg-[#0f0f0f] border-white/10' : 'bg-white border-gray-200'}`}>
            <div className={`p-6 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
              <h2 className={`text-xl font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                <Wallet className="h-5 w-5 text-[#FF6B4A]" />
                Wallet
              </h2>
            </div>

            <div className="p-6 space-y-4">
              {/* Balance */}
              <div className={`p-4 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                <div className="flex items-center justify-between mb-3">
                  <p className={`text-sm ${isDark ? 'text-white/60' : 'text-gray-600'}`}>Balance</p>
                  <button
                    onClick={fetchBalance}
                    disabled={balanceLoading}
                    className={`text-xs transition-colors ${isDark ? 'text-white/40 hover:text-white' : 'text-gray-400 hover:text-gray-900'}`}
                  >
                    {balanceLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <Image
                    src="/solana-logo.png"
                    alt="Solana"
                    width={32}
                    height={32}
                    className="rounded-full"
                  />
                  <div>
                    <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {balance ? balance.sol.uiBalance.toFixed(4) : "0.0000"} SOL
                    </p>
                  </div>
                </div>
              </div>

              {/* Deposit Address */}
              <div className={`p-4 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                <p className={`text-sm mb-2 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>Deposit Address</p>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-xs break-all text-[#FF6B4A] flex-1">
                    {walletAddress}
                  </p>
                  <button
                    onClick={async () => {
                      if (walletAddress) {
                        await navigator.clipboard.writeText(walletAddress);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }
                    }}
                    className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}`}
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <Copy className={`h-4 w-4 ${isDark ? 'text-white/40' : 'text-gray-400'}`} />
                    )}
                  </button>
                </div>
                <p className={`text-xs mt-2 ${isDark ? 'text-white/30' : 'text-gray-400'}`}>Send SOL to this address to deposit</p>
              </div>

              {/* Withdraw Section */}
              <div className={`p-4 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                <p className={`text-sm mb-3 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>Withdraw SOL</p>

                <div className="space-y-3">
                  <div>
                    <label className={`text-xs mb-1 block ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Destination Address</label>
                    <input
                      type="text"
                      value={withdrawAddress}
                      onChange={(e) => setWithdrawAddress(e.target.value)}
                      placeholder="Solana wallet address..."
                      className={`w-full px-3 py-2 rounded-lg border outline-none focus:border-[#FF6B4A]/50 text-sm font-mono ${isDark ? 'bg-black/30 text-white border-white/10 placeholder:text-white/30' : 'bg-white text-gray-900 border-gray-200 placeholder:text-gray-400'}`}
                    />
                  </div>

                  <div>
                    <div className={`flex justify-between text-xs mb-1 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                      <label>Amount (SOL)</label>
                      <button
                        onClick={() => setWithdrawAmount(balance?.sol.uiBalance.toString() || "0")}
                        className="text-[#FF6B4A] hover:underline"
                      >
                        MAX
                      </button>
                    </div>
                    <input
                      type="number"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="0.0"
                      className={`w-full px-3 py-2 rounded-lg border outline-none focus:border-[#FF6B4A]/50 text-sm ${isDark ? 'bg-black/30 text-white border-white/10 placeholder:text-white/30' : 'bg-white text-gray-900 border-gray-200 placeholder:text-gray-400'}`}
                    />
                  </div>

                  {withdrawError && (
                    <p className="text-xs text-red-400 bg-red-500/10 p-2 rounded">{withdrawError}</p>
                  )}
                  {withdrawSuccess && (
                    <p className="text-xs text-green-400 bg-green-500/10 p-2 rounded">{withdrawSuccess}</p>
                  )}

                  <button
                    onClick={handleWithdraw}
                    disabled={!withdrawAddress || !withdrawAmount || withdrawing}
                    className={`w-full py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 ${
                      !withdrawAddress || !withdrawAmount || withdrawing
                        ? isDark ? "bg-white/10 text-white/40 cursor-not-allowed" : "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "bg-[#FF6B4A] text-white hover:bg-[#FF8F6B]"
                    }`}
                  >
                    {withdrawing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <ArrowUpRight className="h-4 w-4" />
                        Withdraw
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Portfolio & Explorer Links */}
              <div className="flex flex-col gap-2">
                <Link
                  href="/portfolio"
                  onClick={() => setShowWalletModal(false)}
                  className="flex items-center justify-center gap-2 text-sm py-2.5 rounded-lg transition-colors bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-medium"
                >
                  <PieChart className="h-4 w-4" />
                  View Portfolio
                </Link>
                {walletAddress && (
                  <a
                    href={`https://solscan.io/account/${walletAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center justify-center gap-2 text-sm transition-colors ${isDark ? 'text-white/40 hover:text-white' : 'text-gray-400 hover:text-gray-900'}`}
                  >
                    <ExternalLink className="h-4 w-4" />
                    View on Solscan
                  </a>
                )}
              </div>
            </div>

            <div className={`p-6 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
              <button
                onClick={() => setShowWalletModal(false)}
                className={`w-full font-medium py-2.5 rounded-lg transition-colors border ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10 text-white' : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-900'}`}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security Modal */}
      {showSecurityModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className={`absolute inset-0 backdrop-blur-sm ${isDark ? 'bg-black/80' : 'bg-black/50'}`} onClick={() => setShowSecurityModal(false)} />
          <div className={`relative w-full max-w-md border rounded-2xl shadow-2xl ${isDark ? 'bg-[#0f0f0f] border-white/10' : 'bg-white border-gray-200'}`}>
            <div className={`p-6 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
              <h2 className={`text-xl font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                <Shield className="h-5 w-5 text-[#FF6B4A]" />
                Security
              </h2>
            </div>

            <div className="p-6 space-y-4">
              {/* Wallet Info */}
              {walletAddress && (
                <div className={`p-4 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <Image
                      src="/solana-logo.png"
                      alt="Solana"
                      width={20}
                      height={20}
                      className="rounded-full"
                    />
                    <p className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Wallet Address</p>
                  </div>
                  <p className={`font-mono text-xs break-all select-all rounded-lg p-3 ${isDark ? 'text-white/60 bg-black/30' : 'text-gray-600 bg-gray-100'}`}>
                    {walletAddress}
                  </p>
                </div>
              )}

              {/* Private Key Section */}
              {currentUser && (
                <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                  <div className="flex items-center gap-3 mb-3">
                    <Key className="h-5 w-5 text-red-400" />
                    <p className="text-sm font-medium text-red-400">Private Key</p>
                  </div>
                  <p className={`text-xs mb-3 ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
                    Warning: Never share your private key with anyone. Anyone with your private key can access your funds.
                  </p>
                  {privateKeyLoading ? (
                    <div className={`flex items-center gap-2 text-xs ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading...
                    </div>
                  ) : privateKey ? (
                    <div className="space-y-2">
                      <p className={`font-mono text-xs break-all select-all rounded-lg p-3 ${isDark ? 'text-white/60 bg-black/30' : 'text-gray-600 bg-gray-100'}`}>
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
                    <p className={`text-xs italic ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
                      Failed to load private key. Please try again.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className={`p-6 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
              <button
                onClick={() => setShowSecurityModal(false)}
                className={`w-full font-medium py-2.5 rounded-lg transition-colors border ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10 text-white' : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-900'}`}
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
