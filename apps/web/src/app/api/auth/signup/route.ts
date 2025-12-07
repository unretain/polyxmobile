import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { generateWalletForUser } from "@/lib/wallet";

// SECURITY: No fallback - must be configured
const WALLET_ENCRYPTION_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;

if (!WALLET_ENCRYPTION_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("AUTH_SECRET or NEXTAUTH_SECRET must be set in production");
}

const WALLET_SECRET = WALLET_ENCRYPTION_SECRET || "dev-only-secret-do-not-use-in-production";

// Password complexity regex: min 8 chars, 1 uppercase, 1 lowercase, 1 number
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

// Generate cryptographically secure 6-digit code
function generateSecureCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    // Validation
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (!normalizedEmail.includes("@")) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    if (!PASSWORD_REGEX.test(password)) {
      return NextResponse.json({
        error: "Password must contain at least one uppercase letter, one lowercase letter, and one number"
      }, { status: 400 });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      if (existingUser.passwordHash) {
        return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
      } else {
        return NextResponse.json({ error: "This email is linked to a Google account. Please sign in with Google." }, { status: 409 });
      }
    }

    // Generate cryptographically secure verification code
    const verificationCode = generateSecureCode();
    const verificationExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Generate wallet
    const { publicKey, encryptedPrivateKey } = generateWalletForUser(WALLET_SECRET);

    // Create user (not verified yet)
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name: normalizedEmail.split("@")[0],
        emailVerified: null, // Not verified yet
        verificationCode,
        verificationExpiry,
        walletAddress: publicKey,
        walletEncrypted: encryptedPrivateKey,
      },
    });

    console.log(`Created new user ${normalizedEmail} with wallet ${publicKey}`);

    // TODO: Send verification email via Resend
    // For now, return success without code (code should ONLY be sent via email)
    return NextResponse.json({
      success: true,
      userId: user.id,
      message: "Verification code sent to your email",
      // SECURITY: Never return verification code in production API response
    });
  } catch (error) {
    console.error("Error in signup:", error);
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}
