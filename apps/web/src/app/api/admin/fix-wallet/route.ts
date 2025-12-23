import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateWalletForUser } from "@/lib/wallet";

// Get wallet encryption secret
const WALLET_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "dev-only-secret";

// POST /api/admin/fix-wallet
// This endpoint checks the user's wallet status and can regenerate if needed
export async function POST(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Get user by ID first
    let user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        walletAddress: true,
        walletEncrypted: true,
      },
    });

    // Fallback to email
    if (!user && session.user.email) {
      user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: {
          id: true,
          email: true,
          walletAddress: true,
          walletEncrypted: true,
        },
      });
    }

    if (!user) {
      return NextResponse.json({
        error: "User not found",
        session: {
          id: session.user.id,
          email: session.user.email,
        },
      }, { status: 404 });
    }

    // Check current wallet status
    const status = {
      userId: user.id,
      email: user.email,
      hasWalletAddress: !!user.walletAddress,
      hasEncryptedKey: !!user.walletEncrypted,
      walletAddress: user.walletAddress,
    };

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    if (action === "regenerate") {
      // Only regenerate if user explicitly requests it
      if (user.walletAddress) {
        return NextResponse.json({
          error: "User already has a wallet. Use action='force-regenerate' to override.",
          status,
        }, { status: 400 });
      }

      // Generate new wallet
      const { publicKey, encryptedPrivateKey } = generateWalletForUser(WALLET_SECRET);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          walletAddress: publicKey,
          walletEncrypted: encryptedPrivateKey,
        },
      });

      return NextResponse.json({
        success: true,
        message: "Wallet generated",
        newWalletAddress: publicKey,
        previousStatus: status,
      });
    }

    if (action === "force-regenerate") {
      // WARNING: This will create a NEW wallet, losing access to the old one!
      const oldWallet = user.walletAddress;

      const { publicKey, encryptedPrivateKey } = generateWalletForUser(WALLET_SECRET);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          walletAddress: publicKey,
          walletEncrypted: encryptedPrivateKey,
        },
      });

      return NextResponse.json({
        success: true,
        message: "Wallet force-regenerated (old wallet access lost!)",
        oldWalletAddress: oldWallet,
        newWalletAddress: publicKey,
      });
    }

    // Default: just return status
    return NextResponse.json({
      message: "Wallet status check",
      status,
      actions: {
        regenerate: "POST with { action: 'regenerate' } - only works if no wallet exists",
        forceRegenerate: "POST with { action: 'force-regenerate' } - WARNING: creates new wallet, loses old one!",
      },
    });

  } catch (error) {
    console.error("Fix wallet error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fix wallet" },
      { status: 500 }
    );
  }
}

// GET - just check status
export async function GET(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Get user
    let user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user && session.user.email) {
      user = await prisma.user.findUnique({
        where: { email: session.user.email },
      });
    }

    if (!user) {
      // List all users
      const allUsers = await prisma.user.findMany({
        select: { id: true, email: true, walletAddress: true },
      });

      return NextResponse.json({
        error: "User not found",
        session: {
          id: session.user.id,
          email: session.user.email,
        },
        allUsersInDb: allUsers.map(u => ({
          id: u.id,
          email: u.email,
          wallet: u.walletAddress?.substring(0, 12) + "...",
        })),
      }, { status: 404 });
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        walletAddress: user.walletAddress,
        hasEncryptedKey: !!user.walletEncrypted,
        createdAt: user.createdAt,
      },
      session: {
        id: session.user.id,
        email: session.user.email,
      },
    });

  } catch (error) {
    console.error("Fix wallet GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to check wallet" },
      { status: 500 }
    );
  }
}
