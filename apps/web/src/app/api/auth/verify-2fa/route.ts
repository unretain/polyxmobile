import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

// SECURITY: Get encryption key from environment
const ENCRYPTION_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;

if (!ENCRYPTION_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("AUTH_SECRET or NEXTAUTH_SECRET must be set in production");
}

const ENCRYPTION_KEY = ENCRYPTION_SECRET
  ? crypto.createHash("sha256").update(ENCRYPTION_SECRET).digest()
  : crypto.createHash("sha256").update("dev-only-secret").digest();

// Decrypt 2FA secret from storage
function decrypt2FASecret(encryptedData: string): string | null {
  try {
    // Check if it's the new encrypted format (iv:authTag:encrypted)
    if (encryptedData.includes(":")) {
      const [ivHex, authTagHex, encrypted] = encryptedData.split(":");
      const iv = Buffer.from(ivHex, "hex");
      const authTag = Buffer.from(authTagHex, "hex");
      const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    }
    // Legacy: unencrypted secret (migration path)
    return encryptedData;
  } catch {
    return null;
  }
}

// TOTP implementation
function verifyTOTP(secret: string, code: string, window: number = 1): boolean {
  const timeStep = 30;
  const currentTime = Math.floor(Date.now() / 1000 / timeStep);

  // Check current time and ±window steps
  for (let i = -window; i <= window; i++) {
    const time = currentTime + i;
    const timeBuffer = Buffer.alloc(8);
    timeBuffer.writeBigInt64BE(BigInt(time));

    // Decode base32 secret
    const base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const char of secret.toUpperCase()) {
      const val = base32chars.indexOf(char);
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, "0");
    }
    const secretBytes = Buffer.alloc(Math.floor(bits.length / 8));
    for (let j = 0; j < secretBytes.length; j++) {
      secretBytes[j] = parseInt(bits.slice(j * 8, (j + 1) * 8), 2);
    }

    const hmac = crypto.createHmac("sha1", secretBytes);
    hmac.update(timeBuffer);
    const hash = hmac.digest();

    const offset = hash[hash.length - 1] & 0x0f;
    const generatedCode =
      ((hash[offset] & 0x7f) << 24) |
      ((hash[offset + 1] & 0xff) << 16) |
      ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff);

    const expectedCode = (generatedCode % 1000000).toString().padStart(6, "0");

    // Use timing-safe comparison
    if (expectedCode.length === code.length &&
        crypto.timingSafeEqual(Buffer.from(expectedCode), Buffer.from(code))) {
      return true;
    }
  }

  return false;
}

export async function POST(request: NextRequest) {
  try {
    const { userId, code, enable } = await request.json();

    if (!userId || !code) {
      return NextResponse.json({ error: "User ID and code are required" }, { status: 400 });
    }

    // Validate code format
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "Code must be 6 digits" }, { status: 400 });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!user.twoFactorSecret) {
      return NextResponse.json({ error: "2FA not set up" }, { status: 400 });
    }

    // Decrypt the stored secret
    const decryptedSecret = decrypt2FASecret(user.twoFactorSecret);
    if (!decryptedSecret) {
      return NextResponse.json({ error: "Failed to decrypt 2FA secret" }, { status: 500 });
    }

    // Verify the code
    const isValid = verifyTOTP(decryptedSecret, code);

    if (!isValid) {
      return NextResponse.json({ error: "Invalid 2FA code" }, { status: 400 });
    }

    // If enabling 2FA, update the flag
    if (enable) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: true,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error verifying 2FA:", error);
    return NextResponse.json({ error: "Failed to verify 2FA" }, { status: 500 });
  }
}
