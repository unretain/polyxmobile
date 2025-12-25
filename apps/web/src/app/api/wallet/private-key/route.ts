import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptPrivateKey } from "@/lib/wallet";
import { config } from "@/lib/config";

// GET /api/wallet/private-key
// Returns the user's private key (base58 encoded)
// SECURITY: This is a highly sensitive endpoint
export async function GET() {
  try {
    // Check encryption key is configured
    if (!config.authSecret) {
      console.error("[private-key] AUTH_SECRET not configured");
      console.error("[private-key] AUTH_SECRET env:", !!process.env.AUTH_SECRET);
      console.error("[private-key] NEXTAUTH_SECRET env:", !!process.env.NEXTAUTH_SECRET);
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    // Log that we have a secret (not the value!)
    console.log("[private-key] Auth secret configured, length:", config.authSecret.length);

    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Get user with encrypted wallet and 2FA status
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        walletAddress: true,
        walletEncrypted: true,
        twoFactorEnabled: true,
      },
    });

    if (!user?.walletAddress || !user?.walletEncrypted) {
      return NextResponse.json(
        { error: "No wallet found for this account" },
        { status: 404 }
      );
    }

    // SECURITY: Log access for audit trail
    if (user.twoFactorEnabled) {
      console.warn(`[private-key] 2FA user ${user.id} accessed private key`);
    }

    // Validate encrypted data format (should be iv:authTag:encrypted)
    const parts = user.walletEncrypted.split(":");
    if (parts.length !== 3) {
      console.error(`[private-key] Invalid encrypted format for user ${user.id}: expected 3 parts, got ${parts.length}`);
      return NextResponse.json(
        { error: "Wallet data corrupted" },
        { status: 500 }
      );
    }

    // Decrypt private key
    const privateKey = decryptPrivateKey(
      user.walletEncrypted,
      config.authSecret
    );

    // Audit log (without logging the actual key)
    console.log(`[private-key] User ${user.id} retrieved their private key`);

    return NextResponse.json({
      walletAddress: user.walletAddress,
      privateKey,
    });
  } catch (error) {
    // Log error type for debugging (not the full error which could contain key material)
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[private-key] Decryption failed: ${errorMsg}`);
    return NextResponse.json(
      { error: "Failed to retrieve private key" },
      { status: 500 }
    );
  }
}
