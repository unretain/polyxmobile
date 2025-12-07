import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

// Generate cryptographically secure 6-digit code
function generateSecureCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if already verified
    if (user.emailVerified) {
      return NextResponse.json({ error: "Email is already verified" }, { status: 400 });
    }

    // Generate new cryptographically secure code
    const verificationCode = generateSecureCode();
    const verificationExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Update user
    await prisma.user.update({
      where: { id: userId },
      data: {
        verificationCode,
        verificationExpiry,
      },
    });

    // TODO: Send verification email via Resend
    return NextResponse.json({
      success: true,
      message: "Verification code sent to your email",
      // SECURITY: Never return verification code in production API response
    });
  } catch (error) {
    console.error("Error resending code:", error);
    return NextResponse.json({ error: "Failed to resend code" }, { status: 500 });
  }
}
