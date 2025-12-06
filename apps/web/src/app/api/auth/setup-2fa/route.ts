import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

// Generate a random base32 secret for TOTP
function generateTOTPSecret(): string {
  const buffer = crypto.randomBytes(20);
  const base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let secret = "";
  for (let i = 0; i < buffer.length; i++) {
    secret += base32chars[buffer[i] % 32];
  }
  return secret;
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

    // Generate TOTP secret
    const secret = generateTOTPSecret();

    // Store secret (but don't enable 2FA yet - need to verify first)
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: secret,
        twoFactorEnabled: false,
      },
    });

    // Generate otpauth URL for QR code
    const otpauthUrl = `otpauth://totp/Polyx:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Polyx&algorithm=SHA1&digits=6&period=30`;

    return NextResponse.json({
      success: true,
      secret,
      otpauthUrl,
    });
  } catch (error) {
    console.error("Error setting up 2FA:", error);
    return NextResponse.json({ error: "Failed to setup 2FA" }, { status: 500 });
  }
}
