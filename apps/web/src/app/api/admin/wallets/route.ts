import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptWalletAddress } from "@/lib/mobileWallet";

// Use AUTH_SECRET for encryption/decryption
const ENCRYPTION_KEY = process.env.AUTH_SECRET!;

// Admin secret for accessing this endpoint (use AUTH_SECRET)
const ADMIN_SECRET = process.env.AUTH_SECRET;

/**
 * GET /api/admin/wallets
 * List all mobile wallets (decrypted) - ADMIN ONLY
 *
 * Headers required:
 * - x-admin-secret: Your ADMIN_SECRET from env
 */
export async function GET(request: Request) {
  try {
    // Check admin authorization
    const adminSecret = request.headers.get("x-admin-secret");

    if (!ADMIN_SECRET || adminSecret !== ADMIN_SECRET) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get all mobile users
    const mobileUsers = await prisma.mobileUser.findMany({
      orderBy: { createdAt: "desc" },
      take: 100, // Limit to 100 for safety
    });

    // Decrypt wallet addresses
    const decryptedUsers = await Promise.all(
      mobileUsers.map(async (user) => {
        try {
          const publicKey = await decryptWalletAddress(
            user.encryptedPublicKey,
            ENCRYPTION_KEY
          );
          return {
            id: user.id,
            publicKey,
            deviceId: user.deviceId,
            displayName: user.displayName,
            lastActiveAt: user.lastActiveAt,
            createdAt: user.createdAt,
          };
        } catch {
          return {
            id: user.id,
            publicKey: "[decryption failed]",
            deviceId: user.deviceId,
            displayName: user.displayName,
            lastActiveAt: user.lastActiveAt,
            createdAt: user.createdAt,
          };
        }
      })
    );

    return NextResponse.json({
      total: mobileUsers.length,
      users: decryptedUsers,
    });
  } catch (error) {
    console.error("Error fetching mobile wallets:", error);
    return NextResponse.json(
      { error: "Failed to fetch wallets" },
      { status: 500 }
    );
  }
}
