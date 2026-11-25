import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptWalletAddress } from "@/lib/mobileWallet";

// Use AUTH_SECRET for encryption
const ENCRYPTION_KEY = process.env.AUTH_SECRET!;

/**
 * POST /api/wallet/register
 * Register a mobile wallet (encrypted in database)
 */
export async function POST(request: Request) {
  try {
    const { publicKey, deviceId, email } = await request.json();
    const safeEmail = typeof email === "string" && /^[^s@]+@[^s@]+.[^s@]+$/.test(email) ? email.slice(0, 254) : undefined;

    if (!publicKey) {
      return NextResponse.json(
        { error: "Public key is required" },
        { status: 400 }
      );
    }

    // Encrypt the public key before storing
    const encryptedPublicKey = await encryptWalletAddress(publicKey, ENCRYPTION_KEY);

    // Upsert - create if not exists, update lastActiveAt if exists
    const mobileUser = await prisma.mobileUser.upsert({
      where: { encryptedPublicKey },
      create: {
        encryptedPublicKey,
        deviceId,
        email: safeEmail,
        lastActiveAt: new Date(),
      },
      update: {
        lastActiveAt: new Date(),
        deviceId: deviceId || undefined,
        email: safeEmail,
      },
    });

    return NextResponse.json({
      success: true,
      userId: mobileUser.id,
      createdAt: mobileUser.createdAt,
    });
  } catch (error) {
    console.error("Error registering mobile wallet:", error);
    return NextResponse.json(
      { error: "Failed to register wallet" },
      { status: 500 }
    );
  }
}
