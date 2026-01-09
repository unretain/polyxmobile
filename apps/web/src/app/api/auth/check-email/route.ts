import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists in database
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, passwordHash: true },
    });

    return NextResponse.json({
      exists: !!existingUser,
      hasPassword: !!existingUser?.passwordHash,
    });
  } catch (error) {
    console.error("Error checking email:", error);
    return NextResponse.json({ error: "Failed to check email" }, { status: 500 });
  }
}
