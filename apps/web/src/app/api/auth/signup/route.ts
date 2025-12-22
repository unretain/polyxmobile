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

    // Send verification email FIRST before creating user
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("RESEND_API_KEY not configured");
      return NextResponse.json({ error: "Email service not configured" }, { status: 500 });
    }

    try {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || "Polyx <onboarding@resend.dev>",
          to: normalizedEmail,
          subject: "Verify your Polyx account",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Welcome to Polyx!</h2>
              <p>Your verification code is:</p>
              <div style="background: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0;">
                ${verificationCode}
              </div>
              <p>This code expires in 10 minutes.</p>
              <p>If you didn't create an account, you can ignore this email.</p>
            </div>
          `,
        }),
      });

      if (!emailRes.ok) {
        const errorData = await emailRes.json();
        console.error("Resend error:", errorData);
        return NextResponse.json({ error: "Failed to send verification email. Please try again." }, { status: 500 });
      }
    } catch (emailError) {
      console.error("Email send error:", emailError);
      return NextResponse.json({ error: "Failed to send verification email" }, { status: 500 });
    }

    // Only create user AFTER email sends successfully
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

    return NextResponse.json({
      success: true,
      userId: user.id,
      message: "Verification code sent to your email",
    });
  } catch (error) {
    console.error("Error in signup:", error);
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}
