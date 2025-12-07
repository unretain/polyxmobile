import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// Generate cryptographically secure 6-digit code
function generateSecureCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return NextResponse.json({ error: "No account found with this email" }, { status: 404 });
    }

    if (!user.passwordHash) {
      return NextResponse.json({ error: "This account uses Google sign-in. Please sign in with Google." }, { status: 400 });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }

    // Check if email is verified
    if (!user.emailVerified) {
      // Generate new verification code
      const verificationCode = generateSecureCode();
      const verificationExpiry = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          verificationCode,
          verificationExpiry,
        },
      });

      // TODO: Send verification email via Resend
      return NextResponse.json({
        success: false,
        needsEmailVerification: true,
        userId: user.id,
        message: "Verification code sent to your email",
        // SECURITY: Never return verification code in production API response
      });
    }

    // Check if 2FA is enabled
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      return NextResponse.json({
        success: false,
        needs2FA: true,
        userId: user.id,
      });
    }

    // User is fully authenticated (no 2FA)
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        walletAddress: user.walletAddress,
        twoFactorEnabled: user.twoFactorEnabled,
      },
    });
  } catch (error) {
    console.error("Error during sign-in:", error);
    return NextResponse.json({ error: "Sign-in failed" }, { status: 500 });
  }
}
