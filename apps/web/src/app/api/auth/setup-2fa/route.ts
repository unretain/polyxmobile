import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

// SECURITY: Lazy evaluation to avoid build-time errors
function getEncryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET or NEXTAUTH_SECRET must be set in production");
  }
  return crypto.createHash("sha256").update(secret || "dev-only-secret").digest();
}

// Encrypt 2FA secret before storing
function encrypt2FASecret(secret: string): string {
  const ENCRYPTION_KEY = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(secret, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

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

    // Encrypt secret before storing
    const encryptedSecret = encrypt2FASecret(secret);

    // Store encrypted secret (but don't enable 2FA yet - need to verify first)
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: encryptedSecret,
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
