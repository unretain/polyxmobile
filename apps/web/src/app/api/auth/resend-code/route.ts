import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

    // Generate new code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Update user
    await prisma.user.update({
      where: { id: userId },
      data: {
        verificationCode,
        verificationExpiry,
      },
    });

    return NextResponse.json({
      success: true,
      verificationCode, // In production, don't return this - only send via email
    });
  } catch (error) {
    console.error("Error resending code:", error);
    return NextResponse.json({ error: "Failed to resend code" }, { status: 500 });
  }
}
