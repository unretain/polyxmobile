"use client";

import { useState } from "react";
import { X, Mail } from "lucide-react";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { useToast } from "@/components/ui/Toast";

/**
 * Sign in / sign up with email AFTER onboarding (for users who skipped).
 * Same Resend code flow as first launch; on success the verified email is
 * stored locally and linked to the current wallet server-side.
 */
export function EmailAuthModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { wallet } = useMobileWalletStore();
  const { showToast } = useToast();
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const send = async () => {
    const addr = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { setError("Enter a valid email."); return; }
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/auth/email/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: addr }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not send the code.");
      setToken(j.token); setCode(""); setStage("code");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send the code."); }
    finally { setBusy(false); }
  };

  const verify = async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/auth/email/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim(), token }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Wrong code.");
      try {
        localStorage.setItem("polyx-email", email.trim());
        localStorage.setItem("polyx-email-proof", j.proof);
        localStorage.setItem("polyx-email-decision", email.trim());
      } catch {}
      // Link it to the current wallet server-side (best-effort).
      if (wallet?.publicKey) {
        fetch("/api/wallet/register", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicKey: wallet.publicKey, email: email.trim(), emailProof: j.proof }),
        }).catch(() => {});
      }
      showToast("Email verified — receipts and account recovery are set up", "success");
      onClose();
      setStage("email");
    } catch (e) { setError(e instanceof Error ? e.message : "Wrong code."); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl border border-white/10 bg-[#111] shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-[#FF6B4A]" />
            <h2 className="text-lg font-semibold text-white">Sign in with email</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 text-white/60">
            <X className="h-5 w-5" />
          </button>
        </div>

        {stage === "email" ? (
          <>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder="you@email.com"
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#FF6B4A]/50 transition-colors"
            />
            {error && <p className="text-sm text-down">{error}</p>}
            <button
              onClick={send}
              disabled={busy}
              className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50"
            >
              {busy ? "Sending..." : "Send code"}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-white/50">Code sent to <span className="text-white">{email.trim()}</span></p>
            <input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6) verify(); }}
              placeholder="000000"
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-center text-xl font-mono tracking-[0.4em] placeholder-white/20 outline-none focus:border-[#FF6B4A]/50 transition-colors"
            />
            {error && <p className="text-sm text-down text-center">{error}</p>}
            <button
              onClick={verify}
              disabled={busy || code.length !== 6}
              className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50"
            >
              {busy ? "Verifying..." : "Verify"}
            </button>
            <div className="flex justify-center gap-4 text-sm">
              <button onClick={send} disabled={busy} className="text-white/40 hover:text-white/70">Resend</button>
              <button onClick={() => { setStage("email"); setError(""); }} className="text-white/40 hover:text-white/70">Change email</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
