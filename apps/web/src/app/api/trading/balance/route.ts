import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getJupiterService, SOL_MINT } from "@/lib/jupiter";
import { config } from "@/lib/config";
import { TradeStatus } from "@prisma/client";

// GET /api/trading/balance
export async function GET(req: NextRequest) {
  try {
    console.log("[balance] Request received");
    console.log("[balance] RPC URL:", config.solanaRpcUrl ? config.solanaRpcUrl.substring(0, 30) + "..." : "NOT SET - using public");

    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Get user wallet - first try by session ID
    let user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        walletAddress: true,
        email: true,
      },
    });

    console.log("[balance] User lookup by ID:", {
      sessionUserId: session.user.id,
      sessionEmail: session.user.email,
      found: !!user,
      hasWallet: !!user?.walletAddress,
      userEmail: user?.email,
    });

    // If not found by ID, try by email (session might have stale ID)
    if (!user && session.user.email) {
      console.log("[balance] Trying lookup by email:", session.user.email);
      user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: {
          id: true,
          walletAddress: true,
          email: true,
        },
      });
      console.log("[balance] User lookup by email:", {
        found: !!user,
        hasWallet: !!user?.walletAddress,
        userId: user?.id,
      });
    }

    if (!user) {
      // List all users for debugging
      const allUsers = await prisma.user.findMany({
        select: { id: true, email: true, walletAddress: true },
        take: 10,
      });
      console.error("[balance] User not found. Session:", {
        id: session.user.id,
        email: session.user.email,
      });
      console.error("[balance] Available users:", allUsers.map(u => ({
        id: u.id,
        email: u.email,
        wallet: u.walletAddress?.substring(0, 8) + "...",
      })));
      return NextResponse.json(
        { error: "User not found", debug: { sessionId: session.user.id, sessionEmail: session.user.email } },
        { status: 404 }
      );
    }

    const walletAddress = user.walletAddress;
    if (!walletAddress) {
      console.error("[balance] User exists but has no wallet:", user.id, user.email);
      return NextResponse.json(
        { error: "No wallet found for user", debug: { userId: user.id, email: user.email } },
        { status: 400 }
      );
    }
    console.log("[balance] Fetching for wallet:", walletAddress.substring(0, 8) + "...");

    // Always fetch fresh data from RPC - no caching for trading balances
    const jupiter = getJupiterService();
    const [solBalance, tokenAccounts] = await Promise.all([
      jupiter.getSolBalance(walletAddress),
      jupiter.getTokenAccounts(walletAddress),
    ]);

    console.log("[balance] Fresh RPC data - SOL:", solBalance / 1e9, "Token accounts:", tokenAccounts.length);
    // Log all token accounts for debugging
    tokenAccounts.forEach((t, i) => {
      console.log(`[balance] Token ${i}: mint=${t.mint.substring(0, 8)}... balance=${t.balance} decimals=${t.decimals}`);
    });

    // Format SOL balance
    const solUiBalance = solBalance / 1e9; // Convert lamports to SOL

    // Format token balances (before prices)
    let tokensWithBalance = tokenAccounts
      .filter((t) => Number(t.balance) > 0) // Only tokens with balance
      .map((t) => ({
        mint: t.mint,
        balance: t.balance,
        uiBalance: Number(t.balance) / Math.pow(10, t.decimals),
        decimals: t.decimals,
      }));
    console.log("[balance] Tokens with balance from RPC:", tokensWithBalance.length);

    // FALLBACK: If RPC returns no tokens, calculate from trade history
    if (tokensWithBalance.length === 0) {
      console.log("[balance] No tokens from RPC, falling back to trade history...");

      const trades = await prisma.trade.findMany({
        where: {
          userId: session.user.id,
          status: TradeStatus.SUCCESS,
        },
        orderBy: { confirmedAt: "asc" },
      });

      // Calculate token balances from trade history
      const tokenBalances = new Map<string, { balance: number; symbol: string }>();

      for (const trade of trades) {
        const isBuy = trade.inputMint === SOL_MINT;
        const tokenMint = isBuy ? trade.outputMint : trade.inputMint;
        const tokenSymbol = isBuy ? trade.outputSymbol : trade.inputSymbol;

        // Most pump.fun tokens have 6 decimals
        const tokenAmount = isBuy
          ? Number(trade.amountOut) / 1e6
          : Number(trade.amountIn) / 1e6;

        const current = tokenBalances.get(tokenMint) || { balance: 0, symbol: tokenSymbol };

        if (isBuy) {
          current.balance += tokenAmount;
        } else {
          current.balance -= tokenAmount;
        }

        tokenBalances.set(tokenMint, current);
      }

      // Convert to tokens array, only including positive balances
      tokensWithBalance = Array.from(tokenBalances.entries())
        .filter(([, data]) => data.balance > 0.000001)
        .map(([mint, data]) => ({
          mint,
          balance: Math.floor(data.balance * 1e6).toString(), // Convert back to raw amount
          uiBalance: data.balance,
          decimals: 6, // Assume 6 decimals for pump.fun tokens
        }));

      console.log("[balance] Tokens from trade history:", tokensWithBalance.length);
      tokensWithBalance.forEach((t, i) => {
        console.log(`[balance] Trade history token ${i}: mint=${t.mint.substring(0, 8)}... uiBalance=${t.uiBalance}`);
      });
    }

    // Get SOL price from database cache (updated by /api/prices/update)
    let solPriceUsd: number | null = null;
    const priceCache = await prisma.priceCache.findUnique({
      where: { symbol: "SOL" },
    });

    if (priceCache) {
      // Check if price is stale (older than 5 minutes)
      const ageMs = Date.now() - priceCache.updatedAt.getTime();
      const isStale = ageMs > 5 * 60 * 1000;
      solPriceUsd = priceCache.priceUsd;
      console.log("[balance] SOL price from DB:", solPriceUsd, isStale ? "(stale)" : "");
    } else {
      console.warn("[balance] No SOL price in database - call /api/prices/update first");
    }

    // Get token prices from Jupiter (for non-SOL tokens only)
    let prices = new Map<string, number>();
    const tokenMints = tokensWithBalance.map((t) => t.mint);
    if (tokenMints.length > 0) {
      try {
        const jupiterForPrices = getJupiterService();
        prices = await jupiterForPrices.getTokenPrices(tokenMints);
        console.log("[balance] Token prices from Jupiter:", prices.size);
      } catch (e) {
        console.warn("[balance] Jupiter token price API failed:", e);
      }
    }

    // Calculate token values with prices
    const tokens = tokensWithBalance.map((t) => {
      const priceUsd = prices.get(t.mint) || null;
      return {
        ...t,
        priceUsd,
        valueUsd: priceUsd ? t.uiBalance * priceUsd : null,
      };
    });

    // Calculate total value
    const solValueUsd = solPriceUsd ? solUiBalance * solPriceUsd : null;
    const tokensValueUsd = tokens.reduce((sum, t) => sum + (t.valueUsd || 0), 0);
    const totalValueUsd = solValueUsd !== null ? solValueUsd + tokensValueUsd : null;

    return NextResponse.json({
      walletAddress,
      sol: {
        mint: SOL_MINT,
        balance: solBalance.toString(),
        uiBalance: solUiBalance,
        decimals: 9,
        priceUsd: solPriceUsd,
        valueUsd: solValueUsd,
      },
      tokens,
      totalValueUsd,
    });
  } catch (error) {
    console.error("Balance error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to get balance";
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error("Balance error stack:", errorStack);
    return NextResponse.json(
      {
        error: errorMessage,
        // Include debug info in non-production
        ...(process.env.NODE_ENV !== "production" && { stack: errorStack }),
      },
      { status: 500 }
    );
  }
}
