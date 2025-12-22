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

    console.log(`[signin] Attempt for email: ${email}`);

    if (!email || !password) {
      console.log(`[signin] Missing email or password`);
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log(`[signin] Normalized email: ${normalizedEmail}`);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      console.log(`[signin] No user found for email: ${normalizedEmail}`);
      return NextResponse.json({ error: "No account found with this email" }, { status: 404 });
    }

    console.log(`[signin] User found: ${user.id}, emailVerified: ${!!user.emailVerified}, 2FA: ${user.twoFactorEnabled}`);

    if (!user.passwordHash) {
      console.log(`[signin] User has no password (OAuth-only account)`);
      return NextResponse.json({ error: "This account uses Google sign-in. Please sign in with Google." }, { status: 400 });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      console.log(`[signin] Invalid password for user: ${user.id}`);
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }

    console.log(`[signin] Password valid for user: ${user.id}`);

    // Check if email is verified
    if (!user.emailVerified) {
      console.log(`[signin] Email not verified for user: ${user.id}, generating new code`);
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

      console.log(`[signin] Generated verification code for user: ${user.id}`);

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
      console.log(`[signin] 2FA required for user: ${user.id}`);
      return NextResponse.json({
        success: false,
        needs2FA: true,
        userId: user.id,
      });
    }

    // User is fully authenticated (no 2FA)
    console.log(`[signin] Success! User ${user.id} authenticated (no 2FA required)`);
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
    console.error("[signin] Error during sign-in:", error);
    return NextResponse.json({ error: "Sign-in failed" }, { status: 500 });
  }
}
