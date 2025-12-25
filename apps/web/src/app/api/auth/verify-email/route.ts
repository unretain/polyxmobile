import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export async function POST(request: NextRequest) {
  try {
    const { userId, code } = await request.json();

    console.log(`[verify-email] Request: userId=${userId}, code=${code}`);

    if (!userId || !code) {
      console.log(`[verify-email] Missing userId or code`);
      return NextResponse.json({ error: "User ID and code are required" }, { status: 400 });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      console.log(`[verify-email] User not found: ${userId}`);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    console.log(`[verify-email] User found: ${user.email}, verified: ${!!user.emailVerified}, storedCode: ${user.verificationCode}`);

    // Check if already verified
    if (user.emailVerified) {
      console.log(`[verify-email] Already verified`);
      return NextResponse.json({ success: true, alreadyVerified: true });
    }

    // Verify code using timing-safe comparison to prevent timing attacks
    const storedCode = user.verificationCode || "";
    const providedCode = String(code);

    // Pad codes to same length for timing-safe comparison
    const codeMatch = storedCode.length === providedCode.length &&
      crypto.timingSafeEqual(Buffer.from(storedCode), Buffer.from(providedCode));

    if (!codeMatch) {
      console.log(`[verify-email] Code mismatch for user: ${userId}`);
      return NextResponse.json({ error: "Invalid verification code" }, { status: 400 });
    }

    // Check expiry
    if (user.verificationExpiry && new Date() > user.verificationExpiry) {
      console.log(`[verify-email] Code expired at ${user.verificationExpiry}`);
      return NextResponse.json({ error: "Verification code has expired" }, { status: 400 });
    }

    // Mark as verified
    await prisma.user.update({
      where: { id: userId },
      data: {
        emailVerified: new Date(),
        verificationCode: null,
        verificationExpiry: null,
      },
    });

    console.log(`[verify-email] Successfully verified user: ${user.email}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[verify-email] Error:", error);
    return NextResponse.json({ error: "Failed to verify email" }, { status: 500 });
  }
}
