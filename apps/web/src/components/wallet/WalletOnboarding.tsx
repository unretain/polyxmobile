"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, Eye, EyeOff, ChevronRight, Shield, AlertTriangle, Download, Plus } from "lucide-react";
import { useMobileWalletStore } from "@/stores/mobileWalletStore";
import { generateWalletWithMnemonic, formatMnemonicForDisplay, deriveKeypairFromMnemonic, validateMnemonic } from "@/lib/mobileWallet";

interface WalletOnboardingProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = "signup" | "verify-email" | "skip-warn" | "choose" | "create-intro" | "show-phrase" | "verify" | "complete" | "import";

// First-launch email decision ("skipped" or the verified address). Once made,
// reopening onboarding (e.g. Add wallet) starts at the wallet step directly.
const EMAIL_DECISION_KEY = "polyx-email-decision";
const EMAIL_KEY = "polyx-email";
const EMAIL_PROOF_KEY = "polyx-email-proof";
const emailDecisionMade = () => {
  try { return !!localStorage.getItem(EMAIL_DECISION_KEY); } catch { return true; }
};

export function WalletOnboarding({ isOpen, onClose }: WalletOnboardingProps) {
  const router = useRouter();
  const { setWallet, setPendingMnemonic, pendingMnemonic, confirmBackup, storeMnemonic } = useMobileWalletStore();

  const [step, setStep] = useState<Step>(() => (emailDecisionMade() ? "choose" : "signup"));
  const [words, setWords] = useState<string[]>([]);
  const [publicKey, setPublicKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [showPhrase, setShowPhrase] = useState(false);
  const [verifyIndexes, setVerifyIndexes] = useState<number[]>([]);
  const [verifyInputs, setVerifyInputs] = useState<string[]>(["", "", ""]);
  const [verifyError, setVerifyError] = useState("");
  // Email sign-up flow (Resend code), optional, with an explicit skip warning.
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailToken, setEmailToken] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState("");

  const sendCode = async () => {
    const addr = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { setEmailError("Enter a valid email."); return; }
    setEmailBusy(true); setEmailError("");
    try {
      const r = await fetch("/api/auth/email/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: addr }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not send the code.");
      setEmailToken(j.token);
      setEmailCode("");
      setStep("verify-email");
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : "Could not send the code.");
    } finally { setEmailBusy(false); }
  };

  const verifyEmailCode = async () => {
    setEmailBusy(true); setEmailError("");
    try {
      const r = await fetch("/api/auth/email/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: emailCode.trim(), token: emailToken }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Wrong code.");
      try {
        localStorage.setItem(EMAIL_KEY, email.trim());
        localStorage.setItem(EMAIL_PROOF_KEY, j.proof);
        localStorage.setItem(EMAIL_DECISION_KEY, email.trim());
      } catch {}
      setStep("choose");
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : "Wrong code.");
    } finally { setEmailBusy(false); }
  };

  // Import wallet state
  const [importPhrase, setImportPhrase] = useState("");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);

  // Register wallet with backend (encrypted storage)
  const registerWallet = async (pk: string) => {
    try {
      await fetch("/api/wallet/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: pk,
          email: (typeof localStorage !== "undefined" && localStorage.getItem(EMAIL_KEY)) || undefined,
          emailProof: (typeof localStorage !== "undefined" && localStorage.getItem(EMAIL_PROOF_KEY)) || undefined,
        }),
      });
    } catch {
      // Silent fail - wallet still works locally
      console.error("Failed to register wallet with backend");
    }
  };

  // Generate wallet when creating new
  const handleCreateNew = async () => {
    const { mnemonic, publicKey: pk } = generateWalletWithMnemonic();
    setPendingMnemonic(mnemonic);
    setWords(formatMnemonicForDisplay(mnemonic));
    setPublicKey(pk);

    // Store wallet (without backup confirmation yet)
    setWallet({
      publicKey: pk,
      hasBackedUp: false,
      createdAt: Date.now(),
    });
    // Persist the encrypted key NOW so signing works even if backup is skipped.
    storeMnemonic(mnemonic);

    // Register with backend (public key only, the seed phrase never leaves the device)
    registerWallet(pk);

    setStep("create-intro");
  };


  // Generate random verify indexes when moving to verify step
  useEffect(() => {
    if (step === "verify" && words.length > 0) {
      const indexes: number[] = [];
      while (indexes.length < 3) {
        const rand = Math.floor(Math.random() * 12);
        if (!indexes.includes(rand)) indexes.push(rand);
      }
      setVerifyIndexes(indexes.sort((a, b) => a - b));
      setVerifyInputs(["", "", ""]);
      setVerifyError("");
    }
  }, [step, words]);

  // Load pending mnemonic if exists
  useEffect(() => {
    if (pendingMnemonic && step === "choose") {
      setWords(formatMnemonicForDisplay(pendingMnemonic));
      setStep("show-phrase");
    }
  }, [pendingMnemonic, step]);

  // Cleanup sensitive data on unmount
  useEffect(() => {
    return () => {
      setWords([]);
      setImportPhrase("");
    };
  }, []);

  if (!isOpen) return null;

  const handleCopy = async (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (pendingMnemonic) {
      try {
        // Try modern clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(pendingMnemonic);
        } else {
          // Fallback for older browsers/iOS
          const textArea = document.createElement('textarea');
          textArea.value = pendingMnemonic;
          textArea.style.position = 'fixed';
          textArea.style.left = '-9999px';
          textArea.style.top = '-9999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }
        setCopied(true);
        // Clear clipboard after 30 seconds for security
        setTimeout(async () => {
          try {
            if (navigator.clipboard && navigator.clipboard.readText) {
              const current = await navigator.clipboard.readText();
              if (current === pendingMnemonic) {
                await navigator.clipboard.writeText("");
              }
            }
          } catch {
            // Clipboard access may be denied - that's ok
          }
        }, 30000);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Copy failed:', err);
        // Still show copied feedback even if fallback was used
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  const handleVerify = () => {
    const correct = verifyIndexes.every(
      (wordIndex, i) => verifyInputs[i].toLowerCase().trim() === words[wordIndex].toLowerCase()
    );

    if (correct) {
      confirmBackup();
      setStep("complete");
    } else {
      setVerifyError("Words don't match. Please try again.");
    }
  };

  const handleComplete = () => {
    // Clear sensitive data from memory before closing
    setWords([]);
    setPendingMnemonic("");
    onClose();
    router.push("/pulse");
  };

  const handleSkipVerify = () => {
    // Clear sensitive data from memory
    setWords([]);
    setPendingMnemonic("");
    // Allow skip but mark as not backed up
    onClose();
    router.push("/pulse");
  };

  const handleImportWallet = async () => {
    setImportError("");
    setImporting(true);

    try {
      const phrase = importPhrase.trim().toLowerCase();

      // Validate mnemonic
      if (!validateMnemonic(phrase)) {
        setImportError("Invalid recovery phrase. Please check and try again.");
        setImporting(false);
        return;
      }

      // Derive keypair from mnemonic
      const { publicKey: pk } = deriveKeypairFromMnemonic(phrase);

      // Set pending mnemonic so it gets encrypted on confirmBackup
      setPendingMnemonic(phrase);

      // Store wallet (will be updated with encrypted mnemonic on confirmBackup)
      setWallet({
        publicKey: pk,
        hasBackedUp: true, // Assume they have it backed up since they're importing
        createdAt: Date.now(),
      });
      // Persist the encrypted key immediately so signing works right away.
      storeMnemonic(phrase);

      // Call confirmBackup to encrypt and store the mnemonic
      confirmBackup();

      // Register with backend (public key only, the seed phrase never leaves the device)
      registerWallet(pk);

      // Clear sensitive data from state immediately after use
      setImportPhrase("");

      setPublicKey(pk);
      setStep("complete");
    } catch (err) {
      setImportError("Failed to import wallet. Please check your recovery phrase.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#0a0a0a]">
      {/* Full-page onboarding, the app IS this flow until a wallet exists */}
      <div className="relative mx-auto w-full max-w-md min-h-dvh flex flex-col justify-center">
        {/* Content - pt-safe accounts for iOS notch/status bar */}
        <div className="p-6 pt-16 sm:pt-6" style={{ paddingTop: 'max(4rem, env(safe-area-inset-top, 1rem) + 1rem)' }}>
          {/* Choose: Create or Import */}
          {step === "signup" && (
            <div className="flex min-h-[70vh] flex-col justify-center space-y-8">
              <div className="text-center">
                <h1 className="text-5xl font-bold tracking-tight mb-3">
                  <span className="text-white">[poly</span>
                  <span className="text-[#FF6B4A]">x</span>
                  <span className="text-white">]</span>
                </h1>
                <p className="text-white/50">Live Solana memecoin trading</p>
              </div>

              <div className="space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") sendCode(); }}
                  placeholder="you@email.com"
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder-white/30 outline-none focus:border-[#FF6B4A]/50 transition-colors"
                />
                {emailError && <p className="text-sm text-down">{emailError}</p>}
                <button
                  onClick={sendCode}
                  disabled={emailBusy}
                  type="button"
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-4 rounded-xl transition-colors disabled:opacity-50 touch-manipulation"
                >
                  {emailBusy ? "Sending code..." : "Continue with email"}
                </button>
                <button
                  onClick={() => setStep("skip-warn")}
                  type="button"
                  className="w-full text-white/40 hover:text-white/70 text-sm py-2 transition-colors touch-manipulation"
                >
                  Skip for now
                </button>
              </div>
            </div>
          )}

          {step === "verify-email" && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-white mb-3">Check your inbox</h2>
                <p className="text-white/60 text-sm">
                  We sent a 6-digit code to <span className="text-white">{email.trim()}</span>
                </p>
              </div>
              <div className="space-y-3">
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => { if (e.key === "Enter" && emailCode.length === 6) verifyEmailCode(); }}
                  placeholder="000000"
                  autoFocus
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white text-center text-2xl font-mono tracking-[0.5em] placeholder-white/20 outline-none focus:border-[#FF6B4A]/50 transition-colors"
                />
                {emailError && <p className="text-sm text-down text-center">{emailError}</p>}
                <button
                  onClick={verifyEmailCode}
                  disabled={emailBusy || emailCode.length !== 6}
                  type="button"
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-4 rounded-xl transition-colors disabled:opacity-50 touch-manipulation"
                >
                  {emailBusy ? "Verifying..." : "Verify"}
                </button>
                <div className="flex items-center justify-center gap-4 text-sm">
                  <button onClick={sendCode} disabled={emailBusy} type="button" className="text-white/40 hover:text-white/70 transition-colors">
                    Resend code
                  </button>
                  <button onClick={() => { setStep("signup"); setEmailError(""); }} type="button" className="text-white/40 hover:text-white/70 transition-colors">
                    Change email
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === "skip-warn" && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-down/15 flex items-center justify-center mx-auto mb-6">
                  <AlertTriangle className="w-10 h-10 text-down" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-3">No email, no safety net</h2>
                <p className="text-white/60 text-sm leading-relaxed">
                  Without an email, your 12-word recovery phrase is the <span className="text-white font-semibold">only</span> way
                  into this wallet. Lose the phrase and the wallet is gone. Nobody can recover it, including us.
                </p>
              </div>
              <div className="space-y-3">
                <button
                  onClick={() => {
                    try { localStorage.setItem(EMAIL_DECISION_KEY, "skipped"); } catch {}
                    setStep("choose");
                  }}
                  type="button"
                  className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold py-4 rounded-xl transition-colors touch-manipulation"
                >
                  I understand
                </button>
                <button
                  onClick={() => { setStep("signup"); setEmailError(""); }}
                  type="button"
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-4 rounded-xl transition-colors touch-manipulation"
                >
                  Go back
                </button>
              </div>
            </div>
          )}

          {step === "choose" && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-[#FF6B4A]/20 flex items-center justify-center mx-auto mb-6">
                  <Shield className="w-10 h-10 text-[#FF6B4A]" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-3">Welcome to Polyx</h2>
                <p className="text-white/60">
                  Create a new wallet or import an existing one to get started.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={handleCreateNew}
                  onTouchEnd={(e) => { e.preventDefault(); handleCreateNew(); }}
                  type="button"
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] active:bg-[#FF8F6B] text-white font-semibold py-4 rounded-xl transition-colors flex items-center justify-center gap-3 cursor-pointer touch-manipulation"
                >
                  <Plus className="w-5 h-5" />
                  Create New Wallet
                </button>

                <button
                  onClick={() => setStep("import")}
                  onTouchEnd={(e) => { e.preventDefault(); setStep("import"); }}
                  type="button"
                  className="w-full bg-white/5 hover:bg-white/10 active:bg-white/20 border border-white/10 text-white font-semibold py-4 rounded-xl transition-colors flex items-center justify-center gap-3 cursor-pointer touch-manipulation"
                >
                  <Download className="w-5 h-5" />
                  Import Existing Wallet
                </button>

              </div>
            </div>
          )}

          {/* Import Wallet */}
          {step === "import" && (
            <div className="space-y-5">
              <div className="text-center mb-2">
                <h2 className="text-xl font-bold text-white mb-2">Import Wallet</h2>
                <p className="text-sm text-white/60">
                  Enter your 12-word recovery phrase to restore your wallet.
                </p>
              </div>

              <div className="bg-[#FF6B4A]/10 border border-[#FF6B4A]/30 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-[#FF6B4A] flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-white/60">
                      Make sure no one is watching. Your recovery phrase gives full access to your wallet.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm text-white/60 mb-2">
                  Recovery Phrase
                </label>
                <textarea
                  value={importPhrase}
                  onChange={(e) => {
                    setImportPhrase(e.target.value);
                    setImportError("");
                  }}
                  placeholder="Enter your 12 words separated by spaces..."
                  rows={4}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#FF6B4A]/50 transition-colors font-mono text-sm resize-none"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>

              {importError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                  <p className="text-sm text-red-400">{importError}</p>
                </div>
              )}

              <div className="pt-2 space-y-3">
                <button
                  onClick={handleImportWallet}
                  disabled={!importPhrase.trim() || importing}
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-4 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {importing ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      Import Wallet
                      <ChevronRight className="w-5 h-5" />
                    </>
                  )}
                </button>

                <button
                  onClick={() => setStep("choose")}
                  className="w-full text-white/40 hover:text-white/60 py-2 text-sm transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {/* Create Intro */}
          {step === "create-intro" && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-[#FF6B4A]/20 flex items-center justify-center mx-auto mb-6">
                  <Shield className="w-10 h-10 text-[#FF6B4A]" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-3">Your Wallet is Ready</h2>
                <p className="text-white/60">
                  Save your recovery phrase to keep your funds safe.
                </p>
              </div>

              <div className="bg-[#FF6B4A]/10 border border-[#FF6B4A]/30 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-[#FF6B4A] flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-white font-medium mb-1">Important</p>
                    <p className="text-sm text-white/60">
                      Your recovery phrase is the only way to restore your wallet. Never share it with anyone.
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setStep("show-phrase")}
                className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-4 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                View Recovery Phrase
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {step === "show-phrase" && (
            <div className="space-y-5">
              <div className="text-center mb-2">
                <h2 className="text-xl font-bold text-white mb-2">Your Recovery Phrase</h2>
                <p className="text-sm text-white/60">
                  Write these 12 words down in order and store them safely.
                </p>
              </div>

              {/* Security Warning */}
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400">
                    Never share your recovery phrase. Anyone with these words can steal your funds.
                  </p>
                </div>
              </div>

              {/* Phrase Grid */}
              <div className="relative">
                <div className={`grid grid-cols-3 gap-2 ${!showPhrase ? "blur-md select-none" : ""}`}>
                  {words.map((word, i) => (
                    <div
                      key={i}
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-center"
                    >
                      <span className="text-white/40 text-xs mr-1">{i + 1}.</span>
                      <span className="text-white font-mono">{word}</span>
                    </div>
                  ))}
                </div>

                {!showPhrase && (
                  <button
                    onClick={() => setShowPhrase(true)}
                    className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-xl"
                  >
                    <div className="bg-white/10 backdrop-blur-sm rounded-full px-4 py-2 flex items-center gap-2 text-white">
                      <Eye className="w-5 h-5" />
                      <span>Tap to reveal</span>
                    </div>
                  </button>
                )}
              </div>

              {showPhrase && (
                <>
                  {/* Copy button */}
                  <button
                    onClick={handleCopy}
                    onTouchEnd={handleCopy}
                    type="button"
                    className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 active:bg-white/20 border border-white/10 rounded-xl py-3 text-white transition-colors cursor-pointer touch-manipulation"
                  >
                    {copied ? (
                      <>
                        <Check className="w-5 h-5 text-green-400" />
                        <span className="text-green-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-5 h-5" />
                        <span>Copy to clipboard</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setShowPhrase(false)}
                    className="w-full flex items-center justify-center gap-2 text-white/40 hover:text-white/60 py-2 transition-colors"
                  >
                    <EyeOff className="w-4 h-4" />
                    <span className="text-sm">Hide phrase</span>
                  </button>
                </>
              )}

              <div className="pt-2 space-y-3">
                <button
                  onClick={() => setStep("verify")}
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-4 rounded-xl transition-colors"
                >
                  I&apos;ve Saved It
                </button>

                <button
                  onClick={handleSkipVerify}
                  className="w-full text-white/40 hover:text-white/60 py-2 text-sm transition-colors"
                >
                  Skip for now (not recommended)
                </button>
              </div>
            </div>
          )}

          {step === "verify" && (
            <div className="space-y-5">
              <div className="text-center mb-2">
                <h2 className="text-xl font-bold text-white mb-2">Verify Your Phrase</h2>
                <p className="text-sm text-white/60">
                  Enter the following words from your recovery phrase.
                </p>
              </div>

              <div className="space-y-3">
                {verifyIndexes.map((wordIndex, i) => (
                  <div key={wordIndex}>
                    <label className="block text-sm text-white/60 mb-1.5">
                      Word #{wordIndex + 1}
                    </label>
                    <input
                      type="text"
                      value={verifyInputs[i]}
                      onChange={(e) => {
                        const newInputs = [...verifyInputs];
                        newInputs[i] = e.target.value;
                        setVerifyInputs(newInputs);
                        setVerifyError("");
                      }}
                      placeholder={`Enter word ${wordIndex + 1}`}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#FF6B4A]/50 transition-colors font-mono"
                      autoComplete="off"
                      autoCapitalize="none"
                    />
                  </div>
                ))}
              </div>

              {verifyError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                  <p className="text-sm text-red-400">{verifyError}</p>
                </div>
              )}

              <div className="pt-2 space-y-3">
                <button
                  onClick={handleVerify}
                  disabled={verifyInputs.some((v) => !v.trim())}
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-4 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Verify
                </button>

                <button
                  onClick={() => setStep("show-phrase")}
                  className="w-full text-white/40 hover:text-white/60 py-2 text-sm transition-colors"
                >
                  Go back and view phrase
                </button>
              </div>
            </div>
          )}

          {step === "complete" && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
                  <Check className="w-10 h-10 text-green-500" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-3">You&apos;re All Set!</h2>
                <p className="text-white/60">
                  Your wallet is ready. Start trading on Solana.
                </p>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-xs text-white/40 mb-1">Your wallet address</p>
                <p className="text-sm text-white font-mono break-all">{publicKey}</p>
              </div>

              <button
                onClick={handleComplete}
                className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-4 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                Start Trading
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
