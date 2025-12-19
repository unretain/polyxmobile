import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getJupiterService, SOL_MINT } from "@/lib/jupiter";
import { config } from "@/lib/config";

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

    console.log("[balance] Fetching for wallet:", user.walletAddress.substring(0, 8) + "...");
    const jupiter = getJupiterService();

    // Get SOL balance and token accounts in parallel
    const [solBalance, tokenAccounts] = await Promise.all([
      jupiter.getSolBalance(user.walletAddress),
      jupiter.getTokenAccounts(user.walletAddress),
    ]);
    console.log("[balance] Success - SOL:", solBalance / 1e9, "Tokens:", tokenAccounts.length);

    // Format SOL balance
    const solUiBalance = solBalance / 1e9; // Convert lamports to SOL

    // Format token balances (before prices)
    const tokensWithBalance = tokenAccounts
      .filter((t) => Number(t.balance) > 0) // Only tokens with balance
      .map((t) => ({
        mint: t.mint,
        balance: t.balance,
        uiBalance: Number(t.balance) / Math.pow(10, t.decimals),
        decimals: t.decimals,
      }));

    // Get prices for SOL and all tokens with balance
    const mintsToPrice = [SOL_MINT, ...tokensWithBalance.map((t) => t.mint)];
    const prices = await jupiter.getTokenPrices(mintsToPrice);
    let solPriceUsd = prices.get(SOL_MINT) || null;

    // Fallback: fetch SOL price from CoinGecko if Jupiter failed
    if (!solPriceUsd) {
      try {
        const cgRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", {
          signal: AbortSignal.timeout(5000),
        });
        if (cgRes.ok) {
          const cgData = await cgRes.json();
          solPriceUsd = cgData.solana?.usd || null;
          console.log("[balance] SOL price from CoinGecko:", solPriceUsd);
        }
      } catch (e) {
        console.warn("[balance] CoinGecko fallback failed:", e);
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
