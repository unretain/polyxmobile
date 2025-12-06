"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Mail, Shield, Wallet, Check, ArrowLeft, Eye, EyeOff, AlertCircle, KeyRound } from "lucide-react";
import { signIn } from "next-auth/react";
import { useAuthStore } from "@/stores/authStore";
import QRCode from "qrcode";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: "signin" | "signup";
}

type SignUpStep = "form" | "verify-email" | "setup-2fa" | "verify-2fa" | "complete";
type SignInStep = "form" | "verify-2fa" | "forgot-password" | "verify-reset-code" | "new-password";

interface PendingUser {
  id: string;
  email: string;
  name?: string;
  walletAddress?: string;
  twoFactorEnabled: boolean;
}

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
  const [pendingUser, setPendingUser] = useState<PendingUser | null>(null);
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
      // Create user via API
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to create account");
        setIsSubmitting(false);
        return;
      }

      // Store pending user info
      setPendingUser({
        id: data.userId,
        email: email.toLowerCase().trim(),
        twoFactorEnabled: false,
      });
      setDisplayedCode(data.verificationCode);

      // Send verification email
      await sendVerificationEmail(email, data.verificationCode, "verification");

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

    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: pendingUser.id, code: verificationCode }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Verification failed");
        setIsSubmitting(false);
        return;
      }

      setSignUpStep("setup-2fa");
    } catch {
      setError("Verification failed. Please try again.");
    }
    setIsSubmitting(false);
  }

  async function handleResendCode() {
    if (!pendingUser) return;
    setIsSendingEmail(true);
    setError("");

    try {
      const response = await fetch("/api/auth/resend-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: pendingUser.id }),
      });

      const data = await response.json();

      if (response.ok) {
        setDisplayedCode(data.verificationCode);
        setVerificationCode("");
        await sendVerificationEmail(pendingUser.email, data.verificationCode, "verification");
      }
    } catch (err) {
      console.error("Failed to resend code:", err);
    }
    setIsSendingEmail(false);
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
      const response = await fetch("/api/auth/setup-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: pendingUser.id }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to set up 2FA");
        setIsSubmitting(false);
        return;
      }

      setTotpSecret(data.secret);

      const qrDataUrl = await QRCode.toDataURL(data.otpauthUrl, {
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
    completeSignUp();
  }

  async function handleVerify2FASetup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    if (!pendingUser) {
      setError("Session expired. Please start over.");
      setIsSubmitting(false);
      return;
    }

    if (totpCode.length !== 6) {
      setError("Please enter the 6-digit code from your authenticator app");
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: pendingUser.id, code: totpCode, enable: true }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Invalid code");
        setIsSubmitting(false);
        return;
      }

      // Update pending user state
      setPendingUser({ ...pendingUser, twoFactorEnabled: true });
      completeSignUp();
    } catch {
      setError("Verification failed. Please try again.");
    }
    setIsSubmitting(false);
  }

  async function completeSignUp() {
    if (!pendingUser) {
      setError("Session expired. Please start over.");
      return;
    }

    // Sign in with NextAuth
    const result = await signIn("credentials", {
      email: pendingUser.email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Failed to complete sign up. Please try signing in.");
      return;
    }

    // Set user in auth store
    setUser({
      id: pendingUser.id,
      email: pendingUser.email,
      name: pendingUser.name,
      wallet: pendingUser.walletAddress,
      twoFactorEnabled: pendingUser.twoFactorEnabled,
    });

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
      // Check credentials and 2FA status via API
      const response = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Sign in failed");
        setIsSubmitting(false);
        return;
      }

      // Handle email verification needed
      if (data.needsEmailVerification) {
        setPendingUser({
          id: data.userId,
          email: email.toLowerCase().trim(),
          twoFactorEnabled: false,
        });
        setDisplayedCode(data.verificationCode);
        setMode("signup");
        setSignUpStep("verify-email");
        await sendVerificationEmail(email, data.verificationCode, "verification");
        setIsSubmitting(false);
        return;
      }

      // Handle 2FA needed
      if (data.needs2FA) {
        setPendingUser({
          id: data.userId,
          email: email.toLowerCase().trim(),
          twoFactorEnabled: true,
        });
        setSignInStep("verify-2fa");
        setIsSubmitting(false);
        return;
      }

      // No 2FA, complete login
      await completeSignIn(data.user);
    } catch {
      setError("Sign in failed. Please try again.");
    }
    setIsSubmitting(false);
  }

  async function handleSignIn2FA(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    if (!pendingUser) {
      setError("Session expired. Please start over.");
      setIsSubmitting(false);
      return;
    }

    if (totpCode.length !== 6) {
      setError("Please enter the 6-digit code from your authenticator app");
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: pendingUser.id, code: totpCode }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Invalid code");
        setIsSubmitting(false);
        return;
      }

      // 2FA verified, complete sign in
      await completeSignIn({
        id: pendingUser.id,
        email: pendingUser.email,
        name: pendingUser.name,
        walletAddress: pendingUser.walletAddress,
        twoFactorEnabled: true,
      });
    } catch {
      setError("Verification failed. Please try again.");
    }
    setIsSubmitting(false);
  }

  async function completeSignIn(user: { id: string; email: string; name?: string; walletAddress?: string; twoFactorEnabled: boolean }) {
    // Sign in with NextAuth
    const result = await signIn("credentials", {
      email: user.email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Sign in failed. Please try again.");
      return;
    }

    setUser({
      id: user.id,
      email: user.email,
      name: user.name,
      wallet: user.walletAddress,
      twoFactorEnabled: user.twoFactorEnabled,
    });

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

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailToReset }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to send reset code");
        setIsSubmitting(false);
        return;
      }

      setResetEmail(emailToReset);
      await sendVerificationEmail(emailToReset, data.resetCode, "reset");
      setSignInStep("verify-reset-code");
    } catch {
      setError("Failed to send reset code. Please try again.");
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

    // Just move to new password step - actual verification happens on submit
    setSignInStep("new-password");
    setIsSubmitting(false);
  }

  async function handleResendResetCode() {
    if (!resetEmail) return;
    setIsSendingEmail(true);
    setError("");

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail }),
      });

      const data = await response.json();

      if (response.ok) {
        setResetCode("");
        await sendVerificationEmail(resetEmail, data.resetCode, "reset");
      }
    } catch (err) {
      console.error("Failed to resend code:", err);
    }
    setIsSendingEmail(false);
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

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail, code: resetCode, newPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to reset password");
        setIsSubmitting(false);
        return;
      }

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
    } catch {
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

        // For Phantom, we'll use a special email format and sign in directly
        // The backend handles wallet generation
        const phantomEmail = `${phantomPublicKey.slice(0, 8)}@phantom`;

        const result = await signIn("credentials", {
          email: phantomEmail,
          password: phantomPublicKey, // Use public key as password for Phantom users
          redirect: false,
        });

        if (result?.error) {
          setError("Failed to connect wallet");
          setIsSubmitting(false);
          return;
        }

        handleSuccess();
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
                  <img src="/google-logo.png" alt="Google" className="w-5 h-5" />
                  <span>Google</span>
                </button>
                <button
                  type="button"
                  onClick={handlePhantomConnect}
                  disabled={isSubmitting}
                  className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-4 py-3 text-white transition-colors disabled:opacity-50"
                >
                  <img src="/phantom-logo.png" alt="Phantom" className="w-5 h-5" />
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
                  <span className="text-white font-medium">{pendingUser?.email || email}</span>
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

        case "complete":
          return (
            <div className="space-y-4">
              <div className="text-center py-4">
                <Wallet className="w-16 h-16 text-[#FF6B4A] mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Account Created!</h3>
                <p className="text-white/60">
                  Your account and Solana wallet are ready
                </p>
              </div>

              <button
                onClick={handleSuccess}
                className="w-full bg-[#FF6B4A] hover:bg-[#FF8F6B] text-white font-semibold py-3 rounded-lg transition-colors"
              >
                Go to Dashboard
              </button>
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
                  <img src="/google-logo.png" alt="Google" className="w-5 h-5" />
                  <span>Google</span>
                </button>
                <button
                  type="button"
                  onClick={handlePhantomConnect}
                  disabled={isSubmitting}
                  className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-4 py-3 text-white transition-colors disabled:opacity-50"
                >
                  <img src="/phantom-logo.png" alt="Phantom" className="w-5 h-5" />
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
      if (signUpStep === "complete") return "Welcome!";
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
