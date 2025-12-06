import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

// Generate reset code
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
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

    // Generate 6-digit reset code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store reset code in verification fields
    await prisma.user.update({
      where: { id: user.id },
      data: {
        verificationCode: resetCode,
        verificationExpiry: resetExpiry,
      },
    });

    return NextResponse.json({
      success: true,
      resetCode, // In production, send via email only
    });
  } catch (error) {
    console.error("Error generating reset code:", error);
    return NextResponse.json({ error: "Failed to generate reset code" }, { status: 500 });
  }
}

// Verify reset code and set new password
export async function PUT(request: NextRequest) {
  try {
    const { email, code, newPassword } = await request.json();

    if (!email || !code || !newPassword) {
      return NextResponse.json({ error: "Email, code, and new password are required" }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Verify reset code
    if (user.verificationCode !== code) {
      return NextResponse.json({ error: "Invalid reset code" }, { status: 400 });
    }

    if (user.verificationExpiry && new Date() > user.verificationExpiry) {
      return NextResponse.json({ error: "Reset code has expired" }, { status: 400 });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update password and clear reset code
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        verificationCode: null,
        verificationExpiry: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error resetting password:", error);
    return NextResponse.json({ error: "Failed to reset password" }, { status: 500 });
  }
}
