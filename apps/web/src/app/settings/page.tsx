"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Mail, KeyRound, Users, Sun, Moon, ChevronRight, Fuel } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { EmailAuthModal } from "@/components/auth/EmailAuthModal";
import { getPriorityFeeSol, setPriorityFeeSol } from "@/lib/mobileSwap";
import { shortenAddress } from "@/lib/wallet";

const TIP_PRESETS = [0, 0.0001, 0.001];

export default function SettingsPage() {
  const { isDark, toggleTheme } = useThemeStore();
  const { wallet, accounts } = useMobileWalletStore();

  const [email, setEmail] = useState<string | null>(null);
  const [emailAuthOpen, setEmailAuthOpen] = useState(false);
  const [tip, setTip] = useState(0.0001);

  useEffect(() => {
    try {
      const e = localStorage.getItem("polyx-email");
      setEmail(e && e.includes("@") ? e : null);
    } catch {}
    setTip(getPriorityFeeSol());
  }, [emailAuthOpen]);

  const card = `rounded-2xl border ${isDark ? "bg-white/[0.04] border-white/10" : "bg-white border-black/10"}`;
  const label = `text-[11px] font-semibold uppercase tracking-[0.14em] ${isDark ? "text-white/50" : "text-black/50"}`;
  const rowText = isDark ? "text-white/80" : "text-black/80";
  const subText = isDark ? "text-white/40" : "text-black/40";

  return (
    <div className={`mx-auto max-w-md space-y-4 ${isDark ? "text-white" : "text-gray-900"}`}>
      <h1 className="text-lg md:text-2xl font-bold px-1 pt-1">Settings</h1>

      {/* Account */}
      <div className={`${card} p-4 space-y-3`}>
        <p className={label}>Account</p>
        {email ? (
          <div className="flex items-center gap-3 px-1">
            <Mail className="h-4 w-4 text-[#FF6B4A]" />
            <span className={`text-sm truncate ${rowText}`}>{email}</span>
            <button
              onClick={() => setEmailAuthOpen(true)}
              className={`ml-auto text-xs ${subText} hover:text-[#FF6B4A] transition-colors`}
            >
              Change
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEmailAuthOpen(true)}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border transition-colors ${
              isDark ? "border-white/10 hover:bg-white/5" : "border-black/10 hover:bg-black/5"
            }`}
          >
            <Mail className="h-4 w-4 text-[#FF6B4A]" />
            <span className={`text-sm ${rowText}`}>Sign in with email</span>
            <ChevronRight className={`ml-auto h-4 w-4 ${subText}`} />
          </button>
        )}
      </div>

      {/* Wallet */}
      <div className={`${card} p-4 space-y-2`}>
        <p className={label}>Wallet</p>
        <Link
          href="/wallet"
          className={`flex items-center gap-3 px-3 py-3 rounded-xl border transition-colors ${
            isDark ? "border-white/10 hover:bg-white/5" : "border-black/10 hover:bg-black/5"
          }`}
        >
          <KeyRound className="h-4 w-4 text-[#FF6B4A]" />
          <div className="flex-1 min-w-0">
            <p className={`text-sm ${rowText}`}>Export phrase, add or switch wallets</p>
            {wallet && (
              <p className={`text-xs font-mono ${subText}`}>
                {shortenAddress(wallet.publicKey, 6)}
                {accounts.length > 1 && ` · ${accounts.length} wallets`}
              </p>
            )}
          </div>
          <ChevronRight className={`h-4 w-4 ${subText}`} />
        </Link>
        {accounts.length > 1 && (
          <p className={`px-1 text-xs ${subText} flex items-center gap-1.5`}>
            <Users className="h-3 w-3" /> Switching lives on the Wallet page, under Account
          </p>
        )}
      </div>

      {/* Trading */}
      <div className={`${card} p-4 space-y-3`}>
        <p className={label}>Trading</p>
        <div className="flex items-center gap-2 px-1">
          <Fuel className={`h-4 w-4 ${subText}`} />
          <span className={`text-sm ${rowText}`}>Tip / priority fee</span>
          <div className="ml-auto flex items-center gap-1.5">
            {TIP_PRESETS.map((v) => (
              <button
                key={v}
                onClick={() => { setTip(v); setPriorityFeeSol(v); }}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  tip === v
                    ? "border-[#FF6B4A]/40 text-[#FF6B4A] bg-[#FF6B4A]/10"
                    : isDark ? "border-white/10 text-white/40" : "border-black/10 text-black/40"
                }`}
              >
                {v === 0 ? "0" : v}
              </button>
            ))}
          </div>
        </div>
        <p className={`px-1 text-xs ${subText}`}>Applied to every swap and launch. 0 means exactly 0.</p>
      </div>

      {/* Appearance */}
      <div className={`${card} p-4 space-y-2`}>
        <p className={label}>Appearance</p>
        <button
          onClick={toggleTheme}
          className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border transition-colors ${
            isDark ? "border-white/10 hover:bg-white/5" : "border-black/10 hover:bg-black/5"
          }`}
        >
          {isDark ? <Moon className="h-4 w-4 text-[#FF6B4A]" /> : <Sun className="h-4 w-4 text-[#FF6B4A]" />}
          <span className={`text-sm ${rowText}`}>{isDark ? "Dark" : "Light"} theme</span>
          <span className={`ml-auto text-xs ${subText}`}>Tap to switch</span>
        </button>
      </div>

      <EmailAuthModal isOpen={emailAuthOpen} onClose={() => setEmailAuthOpen(false)} />
    </div>
  );
}
