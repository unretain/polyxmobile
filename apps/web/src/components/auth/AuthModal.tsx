"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Mail, Shield, Wallet, Check, ArrowLeft, Eye, EyeOff, AlertCircle, KeyRound } from "lucide-react";
import { signIn } from "next-auth/react";
import { useAuthStore } from "@/stores/authStore";
import {
  createUser,
  getUserByEmail,
  verifyEmail,
  verifyPassword,
  enableTwoFactor,
  setUserWallet,
  resendVerificationCode,
  encryptSecretKey,
  generatePasswordResetCode,
  verifyResetCode,
  resetPassword,
  type StoredUser,
} from "@/lib/userDb";
import { generateTOTPSecret, verifyTOTPToken } from "@/lib/totp";
import { generateSolanaWallet, shortenAddress } from "@/lib/wallet";
import QRCode from "qrcode";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: "signin" | "signup";
}

type SignUpStep = "form" | "verify-email" | "setup-2fa" | "verify-2fa" | "generate-wallet";
type SignInStep = "form" | "verify-2fa" | "forgot-password" | "verify-reset-code" | "new-password";

export function AuthModal({ isOpen, onClose, mode: initialMode = "signin" }: AuthModalProps) {
  const router = useRouter();
  const { setUser } = useAuthStore();
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [signUpStep, setSignUpStep] = useState<SignUpStep>("form");
  const [signInStep, setSignInStep] = useState<SignInStep>("form");

  // Form fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Verification
  const [verificationCode, setVerificationCode] = useState("");
  const [displayedCode, setDisplayedCode] = useState("");

  // Password Reset
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");

  // 2FA
  const [totpCode, setTotpCode] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpQrUrl, setTotpQrUrl] = useState("");

  // State
  const [pendingUser, setPendingUser] = useState<StoredUser | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState("");

  // Helper to send verification email
  async function sendVerificationEmail(toEmail: string, code: string, type: "verification" | "login" | "reset" = "verification") {
    setIsSendingEmail(true);
    try {
      const response = await fetch("/api/email/send-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: toEmail, code, type }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to send email");
      }

      setEmailSent(true);
      return true;
    } catch (err) {
      console.error("Email send error:", err);
      // Don't block the flow if email fails - user can resend
      return false;
    } finally {
      setIsSendingEmail(false);
    }
  }

  // Reset everything when modal opens/closes or mode changes
  useEffect(() => {
    if (isOpen) {
      resetAll();
    }
  }, [isOpen]);

  useEffect(() => {
    setMode(initialMode);
    resetAll();
  }, [initialMode]);

  if (!isOpen) return null;

  function resetAll() {
    setSignUpStep("form");
    setSignInStep("form");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setVerificationCode("");
    setDisplayedCode("");
    setTotpCode("");
    setTotpSecret("");
    setTotpQrUrl("");
    setPendingUser(null);
    setIsSendingEmail(false);
    setEmailSent(false);
    setError("");
    // Password reset fields
    setResetCode("");
    setNewPassword("");
    setConfirmNewPassword("");
    setResetEmail("");
  }

  function handleSuccess() {
    onClose();
    router.push("/dashboard");
  }

  function switchMode(newMode: "signin" | "signup") {
    setMode(newMode);
    resetAll();
  }

  // ==================== SIGN UP HANDLERS ====================

  async function handleSignUpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    // Validation
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      setIsSubmitting(false);
      return;
    }

    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters");
      setIsSubmitting(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      setIsSubmitting(false);
      return;
    }

    try {
      // Check if user already exists
      const existing = getUserByEmail(email);
      if (existing) {
        setError("An account with this email already exists. Please sign in instead.");
        setIsSubmitting(false);
        return;
      }

      // Create the user
      const { user, verificationCode: code } = await createUser(email, password);
      setPendingUser(user);
      setDisplayedCode(code);

      // Send verification email
      await sendVerificationEmail(email, code, "verification");

      setSignUpStep("verify-email");
    } catch {
      setError("Failed to create account. Please try again.");
    }
    setIsSubmitting(false);
  }

  async function handleVerifyEmail(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    if (!pendingUser) {
      setError("Session expired. Please start over.");
      setIsSubmitting(false);
      return;
    }

    if (verificationCode.length !== 6) {
      setError("Please enter the 6-digit verification code");
      setIsSubmitting(false);
      return;
    }

    const verified = verifyEmail(pendingUser.id, verificationCode);
    if (verified) {
      const user = getUserByEmail(pendingUser.email);
      if (user) setPendingUser(user);
      setSignUpStep("setup-2fa");
    } else {
      setError("Invalid or expired verification code");
    }
    setIsSubmitting(false);
  }

  async function handleResendCode() {
    if (!pendingUser) return;
    setIsSendingEmail(true);
    const code = resendVerificationCode(pendingUser.id);
    if (code) {
      setDisplayedCode(code);
      setVerificationCode("");
      setError("");
      await sendVerificationEmail(pendingUser.email, code, "verification");
    }
  }

  async function handleEnable2FA() {
    setError("");
    setIsSubmitting(true);

    if (!pendingUser) {
      setError("Session expired. Please start over.");
      setIsSubmitting(false);
      return;
    }

    try {
      const { secret, otpauthUrl } = generateTOTPSecret(pendingUser.email);
      setTotpSecret(secret);

      const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
        width: 200,
        margin: 2,
        color: { dark: "#FFFFFF", light: "#00000000" },
      });
      setTotpQrUrl(qrDataUrl);
      setSignUpStep("verify-2fa");
    } catch {
      setError("Failed to set up 2FA. Please try again.");
    }
    setIsSubmitting(false);
  }

  function handleSkip2FA() {
    setSignUpStep("generate-wallet");
  }

  async function handleVerify2FASetup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    if (!pendingUser || !totpSecret) {
      setError("Session expired. Please start over.");
      setIsSubmitting(false);
      return;
    }

    if (totpCode.length !== 6) {
      setError("Please enter the 6-digit code from your authenticator app");
      setIsSubmitting(false);
      return;
    }

    const valid = verifyTOTPToken(totpCode, totpSecret);
    if (valid) {
      enableTwoFactor(pendingUser.id, totpSecret);
      const user = getUserByEmail(pendingUser.email);
      if (user) setPendingUser(user);
      setSignUpStep("generate-wallet");
    } else {
      setError("Invalid code. Please check your authenticator app and try again.");
    }
    setIsSubmitting(false);
  }

  function handleGenerateWalletAndComplete() {
    if (!pendingUser) {
      setError("Session expired. Please start over.");
      return;
    }

    // Generate wallet
    const wallet = generateSolanaWallet();

    // For Phantom users, use their passwordHash as encryption key (it's the phantom pubkey hash)
    // For email users, use their actual password
    const isPhantomUser = pendingUser.email.endsWith("@phantom");
    const encryptionKey = isPhantomUser ? pendingUser.passwordHash : password;

    // Store encrypted wallet
    const encrypted = encryptSecretKey(wallet.secretKey, encryptionKey);
    setUserWallet(pendingUser.id, wallet.publicKey, encrypted);

    // Set user in auth store and complete
    setUser({
      id: pendingUser.id,
      email: pendingUser.email,
      name: pendingUser.name,
      wallet: wallet.publicKey,
      twoFactorEnabled: pendingUser.twoFactorEnabled,
    });

    // Also sign in with NextAuth for session (skip for Phantom users)
    if (!isPhantomUser) {
      signIn("credentials", { email: pendingUser.email, password, redirect: false }).catch(() => {});
    }

    handleSuccess();
  }

  // ==================== SIGN IN HANDLERS ====================

  async function handleSignInSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    if (!email) {
      setError("Please enter your email address");
      setIsSubmitting(false);
      return;
    }

    if (!password) {
      setError("Please enter your password");
      setIsSubmitting(false);
      return;
    }

    try {
      const user = getUserByEmail(email);
      if (!user) {
        setError("No account found with this email. Please sign up first.");
        setIsSubmitting(false);
        return;
      }

      const validPassword = await verifyPassword(password, user.passwordHash);
      if (!validPassword) {
        setError("Incorrect password. Please try again.");
        setIsSubmitting(false);
        return;
      }

      if (!user.emailVerified) {
        // Email not verified - send to verification
        const code = resendVerificationCode(user.id);
        if (code) {
          setPendingUser(user);
          setDisplayedCode(code);
          setMode("signup");
          setSignUpStep("verify-email");
          setIsSubmitting(false);
          return;
        }
      }

      setPendingUser(user);

      // Check if 2FA is enabled
      if (user.twoFactorEnabled && user.twoFactorSecret) {
        setTotpSecret(user.twoFactorSecret);
        setSignInStep("verify-2fa");
      } else {
        // Complete login directly
        completeSignIn(user);
      }
    } catch {
      setError("Sign in failed. Please try again.");
    }
    setIsSubmitting(false);
  }

  async function handleSignIn2FA(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    if (!pendingUser || !totpSecret) {
      setError("Session expired. Please start over.");
      setIsSubmitting(false);
      return;
    }

    if (totpCode.length !== 6) {
      setError("Please enter the 6-digit code from your authenticator app");
      setIsSubmitting(false);
      return;
    }

    const valid = verifyTOTPToken(totpCode, totpSecret);
    if (valid) {
      completeSignIn(pendingUser);
    } else {
      setError("Invalid 2FA code. Please try again.");
    }
    setIsSubmitting(false);
  }

  function completeSignIn(user: StoredUser) {
    setUser({
      id: user.id,
      email: user.email,
      name: user.name,
      wallet: user.wallet?.publicKey,
      twoFactorEnabled: user.twoFactorEnabled,
    });

    signIn("credentials", { email: user.email, password, redirect: false }).catch(() => {});
    handleSuccess();
  }

  // ==================== PASSWORD RESET HANDLERS ====================

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    const emailToReset = resetEmail || email;
    if (!emailToReset || !emailToReset.includes("@")) {
      setError("Please enter a valid email address");
      setIsSubmitting(false);
      return;
    }

    const user = getUserByEmail(emailToReset);
    if (!user) {
      setError("No account found with this email address");
      setIsSubmitting(false);
      return;
    }

    if (user.email.endsWith("@phantom")) {
      setError("Phantom wallet accounts cannot reset password");
      setIsSubmitting(false);
      return;
    }

    const code = generatePasswordResetCode(emailToReset);
    if (code) {
      setResetEmail(emailToReset);
      await sendVerificationEmail(emailToReset, code, "reset");
      setSignInStep("verify-reset-code");
    } else {
      setError("Failed to generate reset code. Please try again.");
    }
    setIsSubmitting(false);
  }

  async function handleVerifyResetCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    if (resetCode.length !== 6) {
      setError("Please enter the 6-digit code");
      setIsSubmitting(false);
      return;
    }

    const valid = verifyResetCode(resetEmail, resetCode);
    if (valid) {
      setSignInStep("new-password");
    } else {
      setError("Invalid or expired code. Please try again.");
    }
    setIsSubmitting(false);
  }

  async function handleResendResetCode() {
    if (!resetEmail) return;
    setIsSendingEmail(true);
    const code = generatePasswordResetCode(resetEmail);
    if (code) {
      setResetCode("");
      setError("");
      await sendVerificationEmail(resetEmail, code, "reset");
    }
  }

  async function handleSetNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    if (!newPassword || newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      setIsSubmitting(false);
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setError("Passwords do not match");
      setIsSubmitting(false);
      return;
    }

    const success = await resetPassword(resetEmail, resetCode, newPassword);
    if (success) {
      // Reset was successful, go back to sign in
      setSignInStep("form");
      setEmail(resetEmail);
      setPassword("");
      setResetCode("");
      setNewPassword("");
      setConfirmNewPassword("");
      setResetEmail("");
      setError("");
      // Show success message briefly
      setEmailSent(true);
      setTimeout(() => setEmailSent(false), 3000);
    } else {
      setError("Failed to reset password. Please try again.");
    }
    setIsSubmitting(false);
  }

  // ==================== SOCIAL AUTH HANDLERS ====================

  async function handleGoogleSignIn() {
    setError("");
    setIsSubmitting(true);
    try {
      await signIn("google", { callbackUrl: "/dashboard" });
    } catch {
      setError("Google sign-in failed. Please try again.");
      setIsSubmitting(false);
    }
  }

  async function handlePhantomConnect() {
    setError("");
    setIsSubmitting(true);

    const phantom = (window as unknown as { phantom?: { solana?: { connect: () => Promise<{ publicKey: { toString: () => string } }> } } }).phantom?.solana;

    if (phantom) {
      try {
        const response = await phantom.connect();
        const phantomPublicKey = response.publicKey.toString();

        // Check if this Phantom user already exists with a wallet
        const phantomEmail = `${shortenAddress(phantomPublicKey)}@phantom`;
        const existingUser = getUserByEmail(phantomEmail);

        if (existingUser && existingUser.wallet?.publicKey) {
          // User already has a generated wallet, log them in
          setUser({
            id: existingUser.id,
            email: existingUser.email,
            name: existingUser.name,
            wallet: existingUser.wallet.publicKey,
            twoFactorEnabled: existingUser.twoFactorEnabled,
          });
          handleSuccess();
        } else {
          // New Phantom user - create user and generate wallet immediately
          let user = existingUser;

          if (!user) {
            const result = await createUser(phantomEmail, phantomPublicKey, true);
            user = result.user;
          }

          // Generate a new wallet for the user
          const wallet = generateSolanaWallet();

          // Use the phantom pubkey hash as encryption key
          const encrypted = encryptSecretKey(wallet.secretKey, user.passwordHash);
          setUserWallet(user.id, wallet.publicKey, encrypted);

          // Set user in auth store and complete
          setUser({
            id: user.id,
            email: user.email,
            name: user.name,
            wallet: wallet.publicKey,
            twoFactorEnabled: user.twoFactorEnabled,
          });

          handleSuccess();
        }
      } catch (err: unknown) {
        const error = err as { code?: number };
        if (error.code === 4001) {
          setError("Connection rejected by user");
        } else {
          setError("Failed to connect Phantom wallet");
        }
      }
    } else {
      window.open("https://phantom.app/", "_blank");
      setError("Phantom wallet not installed. Please install it first.");
    }
    setIsSubmitting(false);
  }

  // ==================== RENDER CONTENT ====================

  function renderContent() {
    // SIGN UP FLOW
    if (mode === "signup") {
      switch (signUpStep) {
        case "form":
          return (
            <form onSubmit={handleSignUpSubmit} className="space-y-4" autoComplete="off" data-form-type="other">
              <div>
                <label className="block text-sm text-white/60 mb-2">Email</label>
                <input
                  type="text"
                  inputMode="email"
                  name="polyx-signup-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#FF6B4A]/50 transition-colors"
                  autoComplete="off"
                  data-lpignore="true"
                  data-form-type="other"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm text-white/60 mb-2">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    name="polyx-signup-pass"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 pr-12 text-white placeholder-white/30 outline-none focus:border-[#FF6B4A]/50 transition-colors"
                    autoComplete="off"
                    data-lpignore="true"
                    data-form-type="other"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm text-white/60 mb-2">Confirm Password</label>
                <input
                  type={showPassword ? "text" : "password"}
                  name="polyx-signup-pass-confirm"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#FF6B4A]/50 transition-colors"
                  autoComplete="off"
                  data-lpignore="true"
                  data-form-type="other"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
              >
                {isSubmitting ? "Creating Account..." : "Create Account"}
              </button>

              <div className="flex items-center gap-4 text-white/40 text-sm">
                <div className="flex-1 h-px bg-white/10" />
                <span>or continue with</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isSubmitting}
                  className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-4 py-3 text-white transition-colors disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  <span>Google</span>
                </button>
                <button
                  type="button"
                  onClick={handlePhantomConnect}
                  disabled={isSubmitting}
                  className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-4 py-3 text-white transition-colors disabled:opacity-50"
                >
                  <div className="w-5 h-5 bg-[#AB9FF2] rounded flex items-center justify-center">
                    <svg viewBox="0 0 34 34" className="w-3 h-3" fill="white">
                      <circle cx="14" cy="15" r="2"/>
                      <circle cx="22" cy="15" r="2"/>
                    </svg>
                  </div>
                  <span>Phantom</span>
                </button>
              </div>
            </form>
          );

        case "verify-email":
          return (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setSignUpStep("form")}
                className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <div className="text-center py-4">
                <Mail className="w-16 h-16 text-[#FF6B4A] mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Check your email</h3>
                <p className="text-white/60">
                  We sent a verification code to<br />
                  <span className="text-white font-medium">{email}</span>
                </p>
              </div>

              {emailSent && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-center">
                  <p className="text-sm text-green-400 flex items-center justify-center gap-2">
                    <Check className="w-4 h-4" />
                    Email sent! Check your inbox
                  </p>
                </div>
              )}

              {isSendingEmail && (
                <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-center">
                  <p className="text-sm text-white/60 flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/20 border-t-[#FF6B4A] rounded-full animate-spin" />
                    Sending email...
                  </p>
                </div>
              )}

              <form onSubmit={handleVerifyEmail} className="space-y-4">
                <input
                  type="text"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 text-center text-3xl font-mono tracking-[0.3em] text-white placeholder-white/20 outline-none focus:border-[#FF6B4A]/50 transition-colors"
                  maxLength={6}
                  autoFocus
                />

                <button
                  type="submit"
                  disabled={isSubmitting || verificationCode.length !== 6}
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? "Verifying..." : "Verify Email"}
                </button>
              </form>

              <button
                onClick={handleResendCode}
                disabled={isSendingEmail}
                className="w-full text-sm text-white/50 hover:text-white transition-colors py-2 disabled:opacity-50"
              >
                {isSendingEmail ? "Sending..." : (
                  <>Didn&apos;t receive the code? <span className="text-[#FF6B4A]">Resend</span></>
                )}
              </button>
            </div>
          );

        case "setup-2fa":
          return (
            <div className="space-y-4">
              <div className="text-center py-4">
                <Shield className="w-16 h-16 text-[#FF6B4A] mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Secure your account</h3>
                <p className="text-white/60">
                  Add two-factor authentication for extra security
                </p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={handleEnable2FA}
                  disabled={isSubmitting}
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? "Setting up..." : "Enable 2FA (Recommended)"}
                </button>

                <button
                  onClick={handleSkip2FA}
                  className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 font-medium py-3 rounded-lg transition-colors"
                >
                  Skip for now
                </button>
              </div>

              <p className="text-xs text-white/40 text-center">
                You can enable 2FA later in your account settings
              </p>
            </div>
          );

        case "verify-2fa":
          return (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setSignUpStep("setup-2fa")}
                className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <div className="text-center">
                <h3 className="text-lg font-semibold text-white mb-2">Scan QR Code</h3>
                <p className="text-sm text-white/60 mb-4">
                  Open your authenticator app and scan this code
                </p>

                {totpQrUrl && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 inline-block mb-4">
                    <img src={totpQrUrl} alt="2FA QR Code" className="w-48 h-48 mx-auto" />
                  </div>
                )}

                <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 mb-4">
                  <p className="text-xs text-white/50 mb-1">Or enter this code manually:</p>
                  <p className="font-mono text-sm text-white break-all select-all">{totpSecret}</p>
                </div>
              </div>

              <form onSubmit={handleVerify2FASetup} className="space-y-4">
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 text-center text-3xl font-mono tracking-[0.3em] text-white placeholder-white/20 outline-none focus:border-[#FF6B4A]/50 transition-colors"
                  maxLength={6}
                  autoFocus
                />

                <button
                  type="submit"
                  disabled={isSubmitting || totpCode.length !== 6}
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? "Verifying..." : "Verify & Enable 2FA"}
                </button>
              </form>
            </div>
          );

        case "generate-wallet":
          return (
            <div className="space-y-4">
              <div className="text-center py-4">
                <Wallet className="w-16 h-16 text-[#FF6B4A] mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Create your wallet</h3>
                <p className="text-white/60">
                  We&apos;ll generate a secure Solana wallet for your account
                </p>
              </div>

              <button
                onClick={handleGenerateWalletAndComplete}
                className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-3 rounded-lg transition-colors"
              >
                Complete Sign Up
              </button>

              <div className="bg-white/5 border border-white/10 rounded-lg p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 text-white/40 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-white/50">
                  Your wallet&apos;s private key will be encrypted and stored securely. You can access it anytime from your account settings.
                </p>
              </div>
            </div>
          );
      }
    }

    // SIGN IN FLOW
    if (mode === "signin") {
      switch (signInStep) {
        case "form":
          return (
            <form onSubmit={handleSignInSubmit} className="space-y-4" autoComplete="off" data-form-type="other">
              <div>
                <label className="block text-sm text-white/60 mb-2">Email</label>
                <input
                  type="text"
                  inputMode="email"
                  name="polyx-signin-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#FF6B4A]/50 transition-colors"
                  autoComplete="off"
                  data-lpignore="true"
                  data-form-type="other"
                  autoFocus
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm text-white/60">Password</label>
                  <button
                    type="button"
                    onClick={() => setSignInStep("forgot-password")}
                    className="text-sm text-[#FF6B4A] hover:text-[#FF8F6B] transition-colors"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    name="polyx-signin-pass"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 pr-12 text-white placeholder-white/30 outline-none focus:border-[#FF6B4A]/50 transition-colors"
                    autoComplete="off"
                    data-lpignore="true"
                    data-form-type="other"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {emailSent && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-center">
                  <p className="text-sm text-green-400 flex items-center justify-center gap-2">
                    <Check className="w-4 h-4" />
                    Password reset successful! Sign in with your new password.
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
              >
                {isSubmitting ? "Signing in..." : "Sign In"}
              </button>

              <div className="flex items-center gap-4 text-white/40 text-sm">
                <div className="flex-1 h-px bg-white/10" />
                <span>or continue with</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isSubmitting}
                  className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-4 py-3 text-white transition-colors disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  <span>Google</span>
                </button>
                <button
                  type="button"
                  onClick={handlePhantomConnect}
                  disabled={isSubmitting}
                  className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-4 py-3 text-white transition-colors disabled:opacity-50"
                >
                  <div className="w-5 h-5 bg-[#AB9FF2] rounded flex items-center justify-center">
                    <svg viewBox="0 0 34 34" className="w-3 h-3" fill="white">
                      <circle cx="14" cy="15" r="2"/>
                      <circle cx="22" cy="15" r="2"/>
                    </svg>
                  </div>
                  <span>Phantom</span>
                </button>
              </div>
            </form>
          );

        case "verify-2fa":
          return (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setSignInStep("form")}
                className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <div className="text-center py-4">
                <Shield className="w-16 h-16 text-[#FF6B4A] mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Two-Factor Authentication</h3>
                <p className="text-white/60">Enter the 6-digit code from your authenticator app</p>
              </div>

              <form onSubmit={handleSignIn2FA} className="space-y-4">
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 text-center text-3xl font-mono tracking-[0.3em] text-white placeholder-white/20 outline-none focus:border-[#FF6B4A]/50 transition-colors"
                  maxLength={6}
                  autoFocus
                />

                <button
                  type="submit"
                  disabled={isSubmitting || totpCode.length !== 6}
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? "Verifying..." : "Verify & Sign In"}
                </button>
              </form>
            </div>
          );

        case "forgot-password":
          return (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setSignInStep("form")}
                className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Sign In
              </button>

              <div className="text-center py-4">
                <KeyRound className="w-16 h-16 text-[#FF6B4A] mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Reset Password</h3>
                <p className="text-white/60">Enter your email address and we&apos;ll send you a code to reset your password</p>
              </div>

              <form onSubmit={handleForgotPassword} className="space-y-4" autoComplete="off">
                <div>
                  <label className="block text-sm text-white/60 mb-2">Email</label>
                  <input
                    type="text"
                    inputMode="email"
                    name="polyx-reset-email"
                    value={resetEmail || email}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#FF6B4A]/50 transition-colors"
                    autoComplete="off"
                    data-lpignore="true"
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? "Sending..." : "Send Reset Code"}
                </button>
              </form>
            </div>
          );

        case "verify-reset-code":
          return (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setSignInStep("forgot-password")}
                className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <div className="text-center py-4">
                <Mail className="w-16 h-16 text-[#FF6B4A] mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Check your email</h3>
                <p className="text-white/60">
                  We sent a reset code to<br />
                  <span className="text-white font-medium">{resetEmail}</span>
                </p>
              </div>

              {emailSent && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-center">
                  <p className="text-sm text-green-400 flex items-center justify-center gap-2">
                    <Check className="w-4 h-4" />
                    Email sent! Check your inbox
                  </p>
                </div>
              )}

              {isSendingEmail && (
                <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-center">
                  <p className="text-sm text-white/60 flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/20 border-t-[#FF6B4A] rounded-full animate-spin" />
                    Sending email...
                  </p>
                </div>
              )}

              <form onSubmit={handleVerifyResetCode} className="space-y-4">
                <input
                  type="text"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 text-center text-3xl font-mono tracking-[0.3em] text-white placeholder-white/20 outline-none focus:border-[#FF6B4A]/50 transition-colors"
                  maxLength={6}
                  autoFocus
                />

                <button
                  type="submit"
                  disabled={isSubmitting || resetCode.length !== 6}
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? "Verifying..." : "Verify Code"}
                </button>
              </form>

              <button
                onClick={handleResendResetCode}
                disabled={isSendingEmail}
                className="w-full text-sm text-white/50 hover:text-white transition-colors py-2 disabled:opacity-50"
              >
                {isSendingEmail ? "Sending..." : (
                  <>Didn&apos;t receive the code? <span className="text-[#FF6B4A]">Resend</span></>
                )}
              </button>
            </div>
          );

        case "new-password":
          return (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setSignInStep("verify-reset-code")}
                className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <div className="text-center py-4">
                <KeyRound className="w-16 h-16 text-[#FF6B4A] mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Create new password</h3>
                <p className="text-white/60">Enter your new password below</p>
              </div>

              <form onSubmit={handleSetNewPassword} className="space-y-4" autoComplete="off">
                <div>
                  <label className="block text-sm text-white/60 mb-2">New Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      name="polyx-new-pass"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 pr-12 text-white placeholder-white/30 outline-none focus:border-[#FF6B4A]/50 transition-colors"
                      autoComplete="off"
                      data-lpignore="true"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-white/60 mb-2">Confirm New Password</label>
                  <input
                    type={showPassword ? "text" : "password"}
                    name="polyx-new-pass-confirm"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Confirm your password"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#FF6B4A]/50 transition-colors"
                    autoComplete="off"
                    data-lpignore="true"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? "Resetting..." : "Reset Password"}
                </button>
              </form>
            </div>
          );
      }
    }

    return null;
  }

  // ==================== MAIN RENDER ====================

  const getTitle = () => {
    if (mode === "signup") {
      if (signUpStep === "form") return "Create Account";
      if (signUpStep === "verify-email") return "Verify Email";
      if (signUpStep === "setup-2fa" || signUpStep === "verify-2fa") return "Two-Factor Authentication";
      if (signUpStep === "generate-wallet") return "Your Wallet";
    }
    if (mode === "signin") {
      if (signInStep === "form") return "Welcome Back";
      if (signInStep === "verify-2fa") return "Two-Factor Authentication";
      if (signInStep === "forgot-password") return "Reset Password";
      if (signInStep === "verify-reset-code") return "Verify Code";
      if (signInStep === "new-password") return "New Password";
    }
    return "Authentication";
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-[#0f0f0f] border border-white/10 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors z-10"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="p-6 pb-2 text-center border-b border-white/10">
          <h2 className="text-2xl font-bold text-white">{getTitle()}</h2>
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="flex items-start gap-3 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3 mb-4">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {renderContent()}
        </div>

        {/* Footer - Mode Toggle */}
        {((mode === "signup" && signUpStep === "form") || (mode === "signin" && signInStep === "form")) && (
          <div className="p-6 pt-2 text-center border-t border-white/10">
            <p className="text-sm text-white/50">
              {mode === "signin" ? (
                <>
                  Don&apos;t have an account?{" "}
                  <button onClick={() => switchMode("signup")} className="text-[#FF6B4A] hover:text-[#FF8F6B] font-medium transition-colors">
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button onClick={() => switchMode("signin")} className="text-[#FF6B4A] hover:text-[#FF8F6B] font-medium transition-colors">
                    Sign in
                  </button>
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
