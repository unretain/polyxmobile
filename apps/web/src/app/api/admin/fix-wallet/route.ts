import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateWalletForUser, restoreWalletFromSecret, encryptPrivateKey } from "@/lib/wallet";

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

    if (action === "restore") {
      // Restore wallet from private key
      const { privateKey } = body;

      if (!privateKey) {
        return NextResponse.json({
          error: "privateKey is required for restore action",
        }, { status: 400 });
      }

      try {
        // Validate and get public key from private key
        const wallet = restoreWalletFromSecret(privateKey);
        const encryptedPrivateKey = encryptPrivateKey(privateKey, WALLET_SECRET);

        await prisma.user.update({
          where: { id: user.id },
          data: {
            walletAddress: wallet.publicKey,
            walletEncrypted: encryptedPrivateKey,
          },
        });

        return NextResponse.json({
          success: true,
          message: "Wallet restored from private key",
          walletAddress: wallet.publicKey,
        });
      } catch (err) {
        return NextResponse.json({
          error: "Invalid private key",
          details: err instanceof Error ? err.message : "Unknown error",
        }, { status: 400 });
      }
    }

    if (action === "fix-all") {
      // Generate wallets for ALL users who don't have one
      const usersWithoutWallets = await prisma.user.findMany({
        where: {
          OR: [
            { walletAddress: null },
            { walletEncrypted: null },
          ],
        },
        select: { id: true, email: true },
      });

      const results: { email: string; wallet: string }[] = [];

      for (const u of usersWithoutWallets) {
        try {
          const { publicKey, encryptedPrivateKey } = generateWalletForUser(WALLET_SECRET);
          await prisma.user.update({
            where: { id: u.id },
            data: {
              walletAddress: publicKey,
              walletEncrypted: encryptedPrivateKey,
            },
          });
          results.push({ email: u.email, wallet: publicKey });
        } catch (err) {
          console.error(`Failed to generate wallet for ${u.email}:`, err);
        }
      }

      return NextResponse.json({
        success: true,
        message: `Generated wallets for ${results.length} users`,
        results,
      });
    }

    // Default: just return status
    return NextResponse.json({
      message: "Wallet status check",
      status,
      actions: {
        regenerate: "POST with { action: 'regenerate' } - only works if no wallet exists",
        forceRegenerate: "POST with { action: 'force-regenerate' } - WARNING: creates new wallet, loses old one!",
        restore: "POST with { action: 'restore', privateKey: '...' } - restore from private key",
        fixAll: "POST with { action: 'fix-all' } - generate wallets for all users without one",
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
