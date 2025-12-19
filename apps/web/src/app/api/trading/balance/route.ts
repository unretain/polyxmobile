import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getJupiterService, SOL_MINT } from "@/lib/jupiter";
import { config } from "@/lib/config";
import { TradeStatus } from "@prisma/client";

// Cache TTL in milliseconds
const BALANCE_CACHE_TTL_MS = 10 * 1000; // 10 seconds

// Helper to check if cached balance is still valid
function isCacheValid(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() < BALANCE_CACHE_TTL_MS;
}

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

    // Get user wallet
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        walletAddress: true,
      },
    });

    if (!user?.walletAddress) {
      return NextResponse.json(
        { error: "No wallet found" },
        { status: 400 }
      );
    }

    const walletAddress = user.walletAddress;
    console.log("[balance] Fetching for wallet:", walletAddress.substring(0, 8) + "...");

    // Check for cached balances first
    const cachedBalances = await prisma.walletBalanceCache.findMany({
      where: { walletAddress },
    });

    let solBalance: number;
    let tokenAccounts: { mint: string; balance: string; decimals: number }[];
    let usedCache = false;

    // Check if we have valid cache
    const solCache = cachedBalances.find((c) => c.tokenAddress === "SOL");
    const tokenCaches = cachedBalances.filter((c) => c.tokenAddress !== "SOL");

    if (solCache && isCacheValid(solCache.updatedAt)) {
      // Use cached data
      solBalance = Number(solCache.balance);
      tokenAccounts = tokenCaches
        .filter((c) => isCacheValid(c.updatedAt))
        .map((c) => ({
          mint: c.tokenAddress,
          balance: c.balance,
          decimals: c.decimals,
        }));
      usedCache = true;
      console.log("[balance] Using cached balances (age:", Math.round((Date.now() - solCache.updatedAt.getTime()) / 1000), "s)");
    } else {
      // Fetch fresh data from RPC
      const jupiter = getJupiterService();
      const [freshSolBalance, freshTokenAccounts] = await Promise.all([
        jupiter.getSolBalance(walletAddress),
        jupiter.getTokenAccounts(walletAddress),
      ]);

      solBalance = freshSolBalance;
      tokenAccounts = freshTokenAccounts;

      console.log("[balance] Fresh RPC data - SOL:", solBalance / 1e9, "Token accounts:", tokenAccounts.length);

      // Cache the fresh balances in the background
      cacheBalances(walletAddress, solBalance, tokenAccounts).catch((e) =>
        console.warn("[balance] Failed to cache balances:", e)
      );
    }

    console.log("[balance] Success - SOL:", solBalance / 1e9, "Token accounts:", tokenAccounts.length, usedCache ? "(cached)" : "(fresh)");
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
      walletAddress: user.walletAddress,
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get balance" },
      { status: 500 }
    );
  }
}

// Helper to cache balances in the database
async function cacheBalances(
  walletAddress: string,
  solBalance: number,
  tokenAccounts: { mint: string; balance: string; decimals: number }[]
): Promise<void> {
  // Cache SOL balance
  await prisma.walletBalanceCache.upsert({
    where: {
      walletAddress_tokenAddress: {
        walletAddress,
        tokenAddress: "SOL",
      },
    },
    update: {
      balance: solBalance.toString(),
      decimals: 9,
    },
    create: {
      walletAddress,
      tokenAddress: "SOL",
      balance: solBalance.toString(),
      decimals: 9,
    },
  });

  // Cache token balances
  for (const token of tokenAccounts) {
    await prisma.walletBalanceCache.upsert({
      where: {
        walletAddress_tokenAddress: {
          walletAddress,
          tokenAddress: token.mint,
        },
      },
      update: {
        balance: token.balance,
        decimals: token.decimals,
      },
      create: {
        walletAddress,
        tokenAddress: token.mint,
        balance: token.balance,
        decimals: token.decimals,
      },
    });
  }

  // Clean up stale token caches (tokens no longer in wallet)
  const currentMints = new Set(["SOL", ...tokenAccounts.map((t) => t.mint)]);
  await prisma.walletBalanceCache.deleteMany({
    where: {
      walletAddress,
      tokenAddress: {
        notIn: Array.from(currentMints),
      },
    },
  });
}
