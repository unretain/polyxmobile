"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Nfc,
  Plus,
  Scan,
  Send,
  QrCode,
  ArrowLeft,
  Check,
  Copy,
  AlertTriangle,
  Wallet,
  Lock,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { useColdStickStore } from "@/stores/coldStickStore";
import {
  generateKeypair,
  encryptSecretKey,
  decryptSecretKey,
  createNfcPayload,
  keypairFromSecretKey,
  wipeArray,
  ColdStickPayload,
  SavedColdStick,
} from "@/lib/coldstick";
import { startNfcScan, writeNfcTag, isNfcAvailable } from "@/lib/nfcService";
import { shortenAddress } from "@/lib/utils";
import { Connection, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram } from "@solana/web3.js";
import QRCode from "qrcode";

// Solana RPC — go through our same-origin proxy (/api/rpc) so the request is
// forwarded server-side to a working RPC. Hitting a public RPC directly from the
// WKWebView rate-limits / CORS-fails (broken balance + "failed to get blockhash").
function getRpcUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/rpc`;
  }
  return "https://solana-rpc.publicnode.com";
}

type Step = "home" | "create" | "create-passphrase" | "create-write" | "create-done" | "scan" | "wallet-view" | "send" | "receive";

export default function ThreeXWalletPage() {
  const router = useRouter();
  const { isDark } = useThemeStore();
  const {
    wallets,
    activeWallet,
    isScanning,
    isWriting,
    error,
    addWallet,
    removeWallet,
    setActiveWallet,
    setScanning,
    setWriting,
    setError,
  } = useColdStickStore();

  const [step, setStep] = useState<Step>("home");
  const [nfcAvailable, setNfcAvailable] = useState<boolean | null>(null);

  // Holds the teardown fn for an in-flight NFC scan so leaving the screen (back
  // button / cancel) actually closes the session instead of leaving it hanging.
  const scanCleanupRef = useRef<null | (() => void | Promise<void>)>(null);

  // Create wallet state
  const [pendingKeypair, setPendingKeypair] = useState<{ publicKey: string; secretKey: Uint8Array } | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [walletLabel, setWalletLabel] = useState("");
  const [passphraseError, setPassphraseError] = useState("");
  const [pendingPayload, setPendingPayload] = useState<ColdStickPayload | null>(null);

  // Wallet view state
  const [scannedPayload, setScannedPayload] = useState<ColdStickPayload | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);

  // Send state
  const [sendPassphrase, setSendPassphrase] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [txSignature, setTxSignature] = useState("");
  const [sendError, setSendError] = useState("");

  // Confirmation modal state
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);

  // Check NFC availability on mount
  useEffect(() => {
    isNfcAvailable().then(setNfcAvailable);
  }, []);

  // Fetch balance when viewing wallet
  const fetchBalance = useCallback(async (publicKey: string) => {
    setLoadingBalance(true);
    try {
      const connection = new Connection(getRpcUrl());
      const pubkey = new PublicKey(publicKey);
      const balance = await connection.getBalance(pubkey);
      setWalletBalance(balance / LAMPORTS_PER_SOL);
    } catch (err) {
      console.error("Failed to fetch balance:", err);
      setWalletBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  }, []);

  // Generate QR code
  const generateQR = useCallback(async (publicKey: string) => {
    try {
      const url = await QRCode.toDataURL(publicKey, {
        width: 200,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });
      setQrCodeUrl(url);
    } catch (err) {
      console.error("Failed to generate QR:", err);
    }
  }, []);

  // Handle create new wallet
  const handleCreateNew = () => {
    // If user already has wallets, show confirmation first
    if (wallets.length > 0) {
      setShowCreateConfirm(true);
      return;
    }
    proceedWithCreate();
  };

  // Actually create the wallet after confirmation
  const proceedWithCreate = () => {
    setShowCreateConfirm(false);
    const keypair = generateKeypair();
    setPendingKeypair(keypair);
    setStep("create-passphrase");
  };

  // Handle passphrase confirmation
  const handleConfirmPassphrase = async () => {
    if (passphrase.length < 6) {
      setPassphraseError("Passphrase must be at least 6 characters");
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setPassphraseError("Passphrases do not match");
      return;
    }
    if (!pendingKeypair) return;

    try {
      const { encrypted, salt, iv } = await encryptSecretKey(
        pendingKeypair.secretKey,
        passphrase
      );

      const payload = createNfcPayload(
        pendingKeypair.publicKey,
        encrypted,
        salt,
        iv,
        walletLabel || undefined
      );

      setPendingPayload(payload);
      wipeArray(pendingKeypair.secretKey);
      setStep("create-write");
    } catch (err) {
      setPassphraseError("Failed to encrypt wallet");
      console.error(err);
    }
  };

  // Handle writing to NFC tag
  const handleWriteNfc = async () => {
    if (!pendingPayload) return;

    setWriting(true);
    setError(null);

    const cleanup = await writeNfcTag(
      pendingPayload,
      () => {
        const savedWallet: SavedColdStick = {
          id: crypto.randomUUID(),
          publicKey: pendingPayload.pub,
          label: walletLabel || `3x Wallet ${wallets.length + 1}`,
          createdAt: Date.now(),
        };
        addWallet(savedWallet);
        setWriting(false);
        setStep("create-done");
      },
      (err) => {
        setError(err);
        setWriting(false);
      }
    );

    return cleanup;
  };

  // Handle scan wallet
  const handleScanWallet = async () => {
    setScanning(true);
    setError(null);
    setStep("scan");

    scanCleanupRef.current = await startNfcScan(
      (payload, rawData) => {
        setScanning(false);
        if (payload) {
          setScannedPayload(payload);
          fetchBalance(payload.pub);
          generateQR(payload.pub);

          const saved = wallets.find((w) => w.publicKey === payload.pub);
          if (saved) {
            setActiveWallet(saved);
          } else {
            setActiveWallet({
              id: crypto.randomUUID(),
              publicKey: payload.pub,
              label: payload.label || "Unknown Wallet",
              createdAt: payload.ts,
            });
          }

          setStep("wallet-view");
        } else {
          setError("This NFC tag is not a valid 3x Wallet");
          setStep("home");
        }
      },
      (err) => {
        setScanning(false);
        scanCleanupRef.current = null;
        // A user-cancelled scan isn't a real error — don't flash a red banner.
        setError(err === "Scan cancelled" ? null : err);
        setStep("home");
      }
    );
  };

  // Handle send transaction
  const handleSend = async () => {
    if (!scannedPayload || !recipient || !amount) return;

    setSending(true);
    setSendError("");
    setTxSignature("");

    // Decrypt separately: an AES-GCM failure here is (almost always) a wrong
    // passphrase, so surface that clearly instead of a cryptic crypto error.
    let secretKey: Uint8Array;
    try {
      secretKey = await decryptSecretKey(
        scannedPayload.enc,
        scannedPayload.salt,
        scannedPayload.iv,
        sendPassphrase
      );
    } catch {
      setSendError("Incorrect passphrase");
      setSending(false);
      return;
    }

    try {
      const keypair = keypairFromSecretKey(secretKey);

      const connection = new Connection(getRpcUrl());
      const recipientPubkey = new PublicKey(recipient);
      const lamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: recipientPubkey,
          lamports,
        })
      );

      transaction.feePayer = keypair.publicKey;
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.sign(keypair);

      wipeArray(secretKey);

      const signature = await connection.sendRawTransaction(transaction.serialize());
      setTxSignature(signature);
      fetchBalance(scannedPayload.pub);
    } catch (err: any) {
      console.error("Send failed:", err);
      setSendError(err.message || "Failed to send transaction");
    } finally {
      setSending(false);
      setSendPassphrase("");
    }
  };

  // Copy address
  const copyAddress = async (address: string) => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Reset state
  const resetState = () => {
    setPendingKeypair(null);
    setPassphrase("");
    setConfirmPassphrase("");
    setWalletLabel("");
    setPassphraseError("");
    setPendingPayload(null);
    setScannedPayload(null);
    setWalletBalance(null);
    setSendPassphrase("");
    setRecipient("");
    setAmount("");
    setTxSignature("");
    setSendError("");
    setError(null);
  };

  const goHome = () => {
    // Close any in-flight NFC scan session before leaving the screen.
    if (scanCleanupRef.current) {
      try {
        void scanCleanupRef.current();
      } catch {
        // best-effort teardown
      }
      scanCleanupRef.current = null;
    }
    resetState();
    setStep("home");
  };

  const bgClass = isDark ? "bg-[#0a0a0a] text-white" : "bg-[#f5f5f5] text-gray-900";
  const cardClass = isDark ? "bg-white/5 border-white/10" : "bg-white border-gray-200";
  const inputClass = isDark
    ? "bg-white/5 border-white/10 text-white placeholder-white/40"
    : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400";

  return (
    <div className={`min-h-screen ${bgClass}`}>
      {/* Header */}
      <div className="sticky top-0 z-50 backdrop-blur-xl border-b border-white/10 bg-black/50">
        <div className="flex items-center justify-between px-4 py-3">
          {step !== "home" ? (
            <button
              onClick={goHome}
              className="p-2 -ml-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={() => router.back()}
              className="p-2 -ml-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <h1 className="font-semibold">3x Wallet</h1>
          <div className="w-9" />
        </div>
      </div>

      <div className="p-4 max-w-md mx-auto space-y-6">
        {/* Error display */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          </div>
        )}

        {/* NFC not available warning */}
        {nfcAvailable === false && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
              <p className="text-sm text-yellow-400">
                NFC is not available on this device. 3x Wallet requires NFC hardware.
              </p>
            </div>
          </div>
        )}

        {/* Create confirmation modal */}
        {showCreateConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className={`w-full max-w-sm rounded-2xl border p-6 ${cardClass}`}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                </div>
                <h3 className="font-semibold text-lg">Create New Wallet?</h3>
              </div>
              <p className={`text-sm mb-6 ${isDark ? "text-white/60" : "text-gray-600"}`}>
                You already have {wallets.length} wallet{wallets.length > 1 ? "s" : ""} saved. Creating a new wallet will generate a new address. Make sure you don't overwrite an existing NFC tag that has funds.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCreateConfirm(false)}
                  className={`flex-1 py-3 rounded-xl font-medium border ${cardClass}`}
                >
                  Cancel
                </button>
                <button
                  onClick={proceedWithCreate}
                  className="flex-1 py-3 rounded-xl font-medium bg-[#FF6B4A] text-white"
                >
                  Create New
                </button>
              </div>
            </div>
          </div>
        )}

        {/* HOME */}
        {step === "home" && (
          <>
            <div className="text-center py-6">
              <div className="w-20 h-20 rounded-full bg-[#FF6B4A]/20 flex items-center justify-center mx-auto mb-4">
                <Nfc className="w-10 h-10 text-[#FF6B4A]" />
              </div>
              <h2 className="text-2xl font-bold mb-2">3x Wallet</h2>
              <p className={`text-sm ${isDark ? "text-white/60" : "text-gray-500"}`}>
                Access your Polyx 3x cold storage wallet
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleCreateNew}
                disabled={nfcAvailable === false}
                className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] disabled:opacity-50 text-white font-semibold py-4 rounded-xl transition-colors flex items-center justify-center gap-3"
              >
                <Plus className="w-5 h-5" />
                Create New Wallet
              </button>

              <button
                onClick={handleScanWallet}
                disabled={nfcAvailable === false}
                className={`w-full border font-semibold py-4 rounded-xl transition-colors flex items-center justify-center gap-3 ${cardClass} hover:bg-white/10 disabled:opacity-50`}
              >
                <Scan className="w-5 h-5" />
                Scan Wallet
              </button>
            </div>

            {wallets.length > 0 && (
              <div className="pt-4">
                <h3 className={`text-sm font-medium mb-3 ${isDark ? "text-white/60" : "text-gray-500"}`}>
                  Your Wallets
                </h3>
                <div className="space-y-2">
                  {wallets.map((wallet) => (
                    <div
                      key={wallet.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border ${cardClass}`}
                    >
                      <div className="w-10 h-10 rounded-full bg-[#FF6B4A]/20 flex items-center justify-center">
                        <Wallet className="w-5 h-5 text-[#FF6B4A]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{wallet.label}</p>
                        <p className={`text-xs ${isDark ? "text-white/40" : "text-gray-500"}`}>
                          {shortenAddress(wallet.publicKey)}
                        </p>
                      </div>
                      <button
                        onClick={() => removeWallet(wallet.id)}
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={`rounded-xl border p-4 ${cardClass}`}>
              <h3 className="font-medium mb-2">How it works</h3>
              <ul className={`text-sm space-y-2 ${isDark ? "text-white/60" : "text-gray-500"}`}>
                <li className="flex items-start gap-2">
                  <span className="text-[#FF6B4A]">1.</span>
                  Create a wallet - generates a Solana keypair
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#FF6B4A]">2.</span>
                  Set a passphrase to encrypt your private key
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#FF6B4A]">3.</span>
                  Write to any NFC sticker - your cold wallet
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#FF6B4A]">4.</span>
                  Scan to view balance or sign transactions
                </li>
              </ul>
            </div>
          </>
        )}

        {/* CREATE - PASSPHRASE */}
        {step === "create-passphrase" && pendingKeypair && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-[#FF6B4A]/20 flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8 text-[#FF6B4A]" />
              </div>
              <h2 className="text-xl font-bold mb-2">Set Passphrase</h2>
              <p className={`text-sm ${isDark ? "text-white/60" : "text-gray-500"}`}>
                This passphrase encrypts your private key
              </p>
            </div>

            <div className={`rounded-xl border p-4 ${cardClass}`}>
              <p className={`text-xs mb-1 ${isDark ? "text-white/40" : "text-gray-500"}`}>
                Your new wallet address
              </p>
              <p className="font-mono text-sm break-all">{pendingKeypair.publicKey}</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className={`block text-sm mb-2 ${isDark ? "text-white/60" : "text-gray-500"}`}>
                  Wallet Label (optional)
                </label>
                <input
                  type="text"
                  value={walletLabel}
                  onChange={(e) => setWalletLabel(e.target.value)}
                  placeholder="e.g., Savings, Trading..."
                  className={`w-full rounded-xl border px-4 py-3 outline-none focus:border-[#FF6B4A]/50 ${inputClass}`}
                />
              </div>

              <div>
                <label className={`block text-sm mb-2 ${isDark ? "text-white/60" : "text-gray-500"}`}>
                  Passphrase
                </label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => {
                    setPassphrase(e.target.value);
                    setPassphraseError("");
                  }}
                  placeholder="At least 6 characters"
                  className={`w-full rounded-xl border px-4 py-3 outline-none focus:border-[#FF6B4A]/50 ${inputClass}`}
                />
              </div>

              <div>
                <label className={`block text-sm mb-2 ${isDark ? "text-white/60" : "text-gray-500"}`}>
                  Confirm Passphrase
                </label>
                <input
                  type="password"
                  value={confirmPassphrase}
                  onChange={(e) => {
                    setConfirmPassphrase(e.target.value);
                    setPassphraseError("");
                  }}
                  placeholder="Re-enter passphrase"
                  className={`w-full rounded-xl border px-4 py-3 outline-none focus:border-[#FF6B4A]/50 ${inputClass}`}
                />
              </div>

              {passphraseError && (
                <p className="text-sm text-red-400">{passphraseError}</p>
              )}
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                <p className="text-sm text-yellow-400">
                  Remember this passphrase! Without it, you cannot access your funds.
                </p>
              </div>
            </div>

            <button
              onClick={handleConfirmPassphrase}
              disabled={!passphrase || !confirmPassphrase}
              className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] disabled:opacity-50 text-white font-semibold py-4 rounded-xl transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {/* CREATE - WRITE NFC */}
        {step === "create-write" && pendingPayload && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-[#FF6B4A]/20 flex items-center justify-center mx-auto mb-4">
                <Nfc className="w-8 h-8 text-[#FF6B4A]" />
              </div>
              <h2 className="text-xl font-bold mb-2">Write to NFC</h2>
              <p className={`text-sm ${isDark ? "text-white/60" : "text-gray-500"}`}>
                Tap your NFC sticker to write your encrypted wallet
              </p>
            </div>

            {isWriting ? (
              <div className="flex flex-col items-center py-8">
                <div className="w-16 h-16 border-4 border-[#FF6B4A]/30 border-t-[#FF6B4A] rounded-full animate-spin mb-4" />
                <p className={isDark ? "text-white/60" : "text-gray-500"}>
                  Hold your NFC sticker near the phone...
                </p>
              </div>
            ) : (
              <button
                onClick={handleWriteNfc}
                className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-4 rounded-xl transition-colors flex items-center justify-center gap-3"
              >
                <Nfc className="w-5 h-5" />
                Tap to Write
              </button>
            )}

            <div className={`rounded-xl border p-4 ${cardClass}`}>
              <p className={`text-xs mb-1 ${isDark ? "text-white/40" : "text-gray-500"}`}>
                Wallet address
              </p>
              <p className="font-mono text-sm break-all">{pendingPayload.pub}</p>
            </div>
          </div>
        )}

        {/* CREATE - DONE */}
        {step === "create-done" && (
          <div className="space-y-6">
            <div className="text-center py-4">
              <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                <Check className="w-10 h-10 text-green-500" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Wallet Created!</h2>
              <p className={`text-sm ${isDark ? "text-white/60" : "text-gray-500"}`}>
                Your wallet is now stored on your NFC sticker
              </p>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                <div>
                  <p className="text-sm text-yellow-400 font-medium mb-1">
                    Keep this sticker safe!
                  </p>
                  <p className="text-xs text-yellow-400/80">
                    This NFC sticker is the only copy of your encrypted wallet. If lost, your funds cannot be recovered.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={goHome}
              className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-4 rounded-xl transition-colors"
            >
              Done
            </button>
          </div>
        )}

        {/* SCANNING */}
        {step === "scan" && isScanning && (
          <div className="flex flex-col items-center py-16">
            <div className="w-20 h-20 border-4 border-[#FF6B4A]/30 border-t-[#FF6B4A] rounded-full animate-spin mb-6" />
            <h2 className="text-xl font-bold mb-2">Scanning...</h2>
            <p className={isDark ? "text-white/60" : "text-gray-500"}>
              Hold your NFC sticker near the phone
            </p>
          </div>
        )}

        {/* WALLET VIEW */}
        {step === "wallet-view" && scannedPayload && (
          <div className="space-y-6">
            <div className={`rounded-xl border p-6 text-center ${cardClass}`}>
              <p className={`text-sm mb-2 ${isDark ? "text-white/40" : "text-gray-500"}`}>
                {activeWallet?.label || "3x Wallet"}
              </p>
              {loadingBalance ? (
                <div className="h-10 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-[#FF6B4A]/30 border-t-[#FF6B4A] rounded-full animate-spin" />
                </div>
              ) : (
                <p className="text-3xl font-bold">
                  {walletBalance !== null ? `${walletBalance.toFixed(4)} SOL` : "---"}
                </p>
              )}
            </div>

            <div className={`rounded-xl border p-4 ${cardClass}`}>
              <div className="flex items-center justify-between mb-3">
                <p className={`text-sm ${isDark ? "text-white/40" : "text-gray-500"}`}>Address</p>
                <button
                  onClick={() => copyAddress(scannedPayload.pub)}
                  className="flex items-center gap-1 text-[#FF6B4A] text-sm"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="font-mono text-sm break-all mb-4">{scannedPayload.pub}</p>
              {qrCodeUrl && (
                <div className="flex justify-center">
                  <img src={qrCodeUrl} alt="QR Code" className="rounded-lg" />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setStep("send")}
                className="bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-4 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <Send className="w-5 h-5" />
                Send
              </button>
              <button
                onClick={() => setStep("receive")}
                className={`border font-semibold py-4 rounded-xl transition-colors flex items-center justify-center gap-2 ${cardClass} hover:bg-white/10`}
              >
                <QrCode className="w-5 h-5" />
                Receive
              </button>
            </div>
          </div>
        )}

        {/* SEND */}
        {step === "send" && scannedPayload && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-bold mb-2">Send SOL</h2>
              <p className={`text-sm ${isDark ? "text-white/60" : "text-gray-500"}`}>
                Enter your passphrase to unlock the wallet
              </p>
            </div>

            {txSignature ? (
              <div className="space-y-4">
                <div className="text-center py-4">
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                    <Check className="w-8 h-8 text-green-500" />
                  </div>
                  <p className="font-medium">Transaction Sent!</p>
                </div>
                <a
                  href={`https://solscan.io/tx/${txSignature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 text-[#FF6B4A] text-sm"
                >
                  View on Solscan <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  onClick={() => setStep("wallet-view")}
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-4 rounded-xl transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <label className={`block text-sm mb-2 ${isDark ? "text-white/60" : "text-gray-500"}`}>
                      Recipient Address
                    </label>
                    <input
                      type="text"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="Solana address..."
                      className={`w-full rounded-xl border px-4 py-3 outline-none focus:border-[#FF6B4A]/50 font-mono text-sm ${inputClass}`}
                    />
                  </div>

                  <div>
                    <label className={`block text-sm mb-2 ${isDark ? "text-white/60" : "text-gray-500"}`}>
                      Amount (SOL)
                    </label>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      step="0.0001"
                      className={`w-full rounded-xl border px-4 py-3 outline-none focus:border-[#FF6B4A]/50 ${inputClass}`}
                    />
                    {walletBalance !== null && (
                      <p className={`text-xs mt-1 ${isDark ? "text-white/40" : "text-gray-500"}`}>
                        Available: {walletBalance.toFixed(4)} SOL
                      </p>
                    )}
                  </div>

                  <div>
                    <label className={`block text-sm mb-2 ${isDark ? "text-white/60" : "text-gray-500"}`}>
                      Passphrase
                    </label>
                    <input
                      type="password"
                      value={sendPassphrase}
                      onChange={(e) => setSendPassphrase(e.target.value)}
                      placeholder="Enter your passphrase"
                      className={`w-full rounded-xl border px-4 py-3 outline-none focus:border-[#FF6B4A]/50 ${inputClass}`}
                    />
                  </div>

                  {sendError && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                      <p className="text-sm text-red-400">{sendError}</p>
                    </div>
                  )}
                </div>

                <button
                  onClick={handleSend}
                  disabled={!recipient || !amount || !sendPassphrase || sending}
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] disabled:opacity-50 text-white font-semibold py-4 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {sending ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      Send SOL
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        )}

        {/* RECEIVE */}
        {step === "receive" && scannedPayload && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-bold mb-2">Receive SOL</h2>
              <p className={`text-sm ${isDark ? "text-white/60" : "text-gray-500"}`}>
                Share this address or QR code to receive funds
              </p>
            </div>

            <div className={`rounded-xl border p-6 text-center ${cardClass}`}>
              {qrCodeUrl && (
                <div className="flex justify-center mb-4">
                  <img src={qrCodeUrl} alt="QR Code" className="rounded-lg" width={200} />
                </div>
              )}
              <p className="font-mono text-sm break-all mb-4">{scannedPayload.pub}</p>
              <button
                onClick={() => copyAddress(scannedPayload.pub)}
                className="bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold px-6 py-3 rounded-xl transition-colors inline-flex items-center gap-2"
              >
                {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                {copied ? "Copied!" : "Copy Address"}
              </button>
            </div>

            <button
              onClick={() => setStep("wallet-view")}
              className={`w-full border font-semibold py-4 rounded-xl transition-colors ${cardClass} hover:bg-white/10`}
            >
              Back to Wallet
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
