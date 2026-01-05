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

type Step = "choose" | "create-intro" | "show-phrase" | "verify" | "complete" | "import";

export function WalletOnboarding({ isOpen, onClose }: WalletOnboardingProps) {
  const router = useRouter();
  const { setWallet, setPendingMnemonic, pendingMnemonic, confirmBackup } = useMobileWalletStore();

  const [step, setStep] = useState<Step>("choose");
  const [words, setWords] = useState<string[]>([]);
  const [publicKey, setPublicKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [showPhrase, setShowPhrase] = useState(false);
  const [verifyIndexes, setVerifyIndexes] = useState<number[]>([]);
  const [verifyInputs, setVerifyInputs] = useState<string[]>(["", "", ""]);
  const [verifyError, setVerifyError] = useState("");

  // Import wallet state
  const [importPhrase, setImportPhrase] = useState("");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);

  // Generate wallet when creating new
  const handleCreateNew = () => {
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

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (pendingMnemonic) {
      await navigator.clipboard.writeText(pendingMnemonic);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
    onClose();
    router.push("/pulse");
  };

  const handleSkipVerify = () => {
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

      // Store wallet
      setWallet({
        publicKey: pk,
        hasBackedUp: true, // Assume they have it backed up since they're importing
        createdAt: Date.now(),
      });

      setPublicKey(pk);
      setStep("complete");
    } catch (err) {
      setImportError("Failed to import wallet. Please check your recovery phrase.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" />

      {/* Modal - Full screen on mobile, centered on desktop */}
      <div className="relative w-full sm:max-w-md bg-[#0a0a0a] sm:rounded-2xl sm:border sm:border-white/10 min-h-screen sm:min-h-0 sm:max-h-[90vh] overflow-y-auto">
        {/* Content */}
        <div className="p-6 pt-12 sm:pt-6">
          {/* Choose: Create or Import */}
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
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-4 rounded-xl transition-colors flex items-center justify-center gap-3"
                >
                  <Plus className="w-5 h-5" />
                  Create New Wallet
                </button>

                <button
                  onClick={() => setStep("import")}
                  className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold py-4 rounded-xl transition-colors flex items-center justify-center gap-3"
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
                    className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl py-3 text-white transition-colors"
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
