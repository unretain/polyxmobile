import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getJupiterService, SOL_MINT } from "@/lib/jupiter";
import { TradeStatus } from "@prisma/client";

// GET /api/trading/balance
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Get user wallet
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { walletAddress: true },
    });

    if (!user?.walletAddress) {
      return NextResponse.json({ error: "No wallet found" }, { status: 400 });
    }

    const walletAddress = user.walletAddress;

    // Fetch balance data from RPC
    const jupiter = getJupiterService();
    const [solBalance, tokenAccounts] = await Promise.all([
      jupiter.getSolBalance(walletAddress),
      jupiter.getTokenAccounts(walletAddress),
    ]);

    // Format SOL balance
    const solUiBalance = solBalance / 1e9; // Convert lamports to SOL

    // Format token balances
    let tokensWithBalance = tokenAccounts
      .filter((t) => Number(t.balance) > 0)
      .map((t) => ({
        mint: t.mint,
        balance: t.balance,
        uiBalance: Number(t.balance) / Math.pow(10, t.decimals),
        decimals: t.decimals,
      }));

    // FALLBACK: If RPC returns no tokens, calculate from trade history
    if (tokensWithBalance.length === 0) {
      const trades = await prisma.trade.findMany({
        where: { userId: session.user.id, status: TradeStatus.SUCCESS },
        orderBy: { confirmedAt: "asc" },
      });

      const tokenBalances = new Map<string, { balance: number; symbol: string }>();
      for (const trade of trades) {
        const isBuy = trade.inputMint === SOL_MINT;
        const tokenMint = isBuy ? trade.outputMint : trade.inputMint;
        const tokenSymbol = isBuy ? trade.outputSymbol : trade.inputSymbol;
        const tokenAmount = isBuy ? Number(trade.amountOut) / 1e6 : Number(trade.amountIn) / 1e6;
        const current = tokenBalances.get(tokenMint) || { balance: 0, symbol: tokenSymbol };
        current.balance += isBuy ? tokenAmount : -tokenAmount;
        tokenBalances.set(tokenMint, current);
      }

      tokensWithBalance = Array.from(tokenBalances.entries())
        .filter(([, data]) => data.balance > 0.000001)
        .map(([mint, data]) => ({
          mint,
          balance: Math.floor(data.balance * 1e6).toString(),
          uiBalance: data.balance,
          decimals: 6,
        }));
    }

    // Get SOL price from database cache
    const priceCache = await prisma.priceCache.findUnique({ where: { symbol: "SOL" } });
    const solPriceUsd = priceCache?.priceUsd ?? null;

    // Get token prices from Jupiter
    let prices = new Map<string, number>();
    const tokenMints = tokensWithBalance.map((t) => t.mint);
    if (tokenMints.length > 0) {
      try {
        prices = await getJupiterService().getTokenPrices(tokenMints);
      } catch {
        // Silently fail - prices are optional
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
    return NextResponse.json({ error: "Failed to get balance" }, { status: 500 });
  }
}
