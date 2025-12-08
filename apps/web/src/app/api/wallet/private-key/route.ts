import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptPrivateKey } from "@/lib/wallet";
import { config } from "@/lib/config";

// GET /api/wallet/private-key
// Returns the user's private key (base58 encoded)
// SECURITY: This requires authentication and should only be called from trusted UI
export async function GET(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Get user with encrypted wallet
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        walletAddress: true,
        walletEncrypted: true,
      },
    });

    if (!user?.walletAddress || !user?.walletEncrypted) {
      return NextResponse.json(
        { error: "No wallet found for this account" },
        { status: 404 }
      );
    }

    // Decrypt private key
    const privateKey = decryptPrivateKey(
      user.walletEncrypted,
      config.authSecret
    );

    return NextResponse.json({
      walletAddress: user.walletAddress,
      privateKey,
    });
  } catch (error) {
    console.error("Error retrieving private key:", error);
    return NextResponse.json(
      { error: "Failed to retrieve private key" },
      { status: 500 }
    );
  }
}
