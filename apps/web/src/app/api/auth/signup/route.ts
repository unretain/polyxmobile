import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { generateWalletForUser } from "@/lib/wallet";

const WALLET_ENCRYPTION_SECRET = process.env.NEXTAUTH_SECRET || "fallback-secret";

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

    // Generate verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Generate wallet
    const { publicKey, encryptedPrivateKey } = generateWalletForUser(WALLET_ENCRYPTION_SECRET);

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

    return NextResponse.json({
      success: true,
      userId: user.id,
      verificationCode, // In production, don't return this - only send via email
    });
  } catch (error) {
    console.error("Error in signup:", error);
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}
