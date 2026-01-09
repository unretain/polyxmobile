import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getJupiterService, JupiterQuote } from "@/lib/jupiter";
import { decryptPrivateKey } from "@/lib/wallet";
import { config } from "@/lib/config";
import bs58 from "bs58";

// POST /api/trading/swap
export async function POST(req: NextRequest) {
  let secretKey: Uint8Array | null = null;

  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { inputMint, outputMint, amount, slippageBps, inputSymbol, outputSymbol } = body;

    if (!inputMint || !outputMint || !amount) {
      return NextResponse.json(
        { error: "inputMint, outputMint, and amount are required" },
        { status: 400 }
      );
    }

    // Get user with wallet
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        walletAddress: true,
        walletEncrypted: true,
      },
    });

    if (!user?.walletAddress || !user?.walletEncrypted) {
      return NextResponse.json(
        { error: "No wallet found. Please set up your wallet first." },
        { status: 400 }
      );
    }

    // Create pending trade record
    const trade = await prisma.trade.create({
      data: {
        userId: user.id,
        inputMint,
        inputSymbol: inputSymbol || "UNKNOWN",
        outputMint,
        outputSymbol: outputSymbol || "UNKNOWN",
        amountIn: amount,
        amountOut: "0",
        amountOutMin: "0",
        status: "PENDING",
      },
    });

    try {
      const jupiter = getJupiterService();

      // Get fresh quote
      const quote = await jupiter.getQuote({
        inputMint,
        outputMint,
        amount,
        slippageBps: slippageBps || 50,
      });

      // Update trade with quote details
      await prisma.trade.update({
        where: { id: trade.id },
        data: {
          amountOut: quote.outAmount,
          amountOutMin: quote.otherAmountThreshold,
          priceImpact: parseFloat(quote.priceImpactPct),
        },
      });

      // Get swap transaction
      const transaction = await jupiter.getSwapTransaction(
        quote as JupiterQuote,
        user.walletAddress
      );

      // Decrypt private key
      const privateKeyBase58 = decryptPrivateKey(
        user.walletEncrypted,
        config.authSecret
      );
      secretKey = bs58.decode(privateKeyBase58);

      // Update status to submitted
      await prisma.trade.update({
        where: { id: trade.id },
        data: { status: "SUBMITTED" },
      });

      // Execute swap
      const signature = await jupiter.executeSwap(transaction, secretKey);

      // Update trade with success
      await prisma.trade.update({
        where: { id: trade.id },
        data: {
          status: "SUCCESS",
          txSignature: signature,
          confirmedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        tradeId: trade.id,
        txSignature: signature,
        inputAmount: quote.inAmount,
        outputAmount: quote.outAmount,
        explorerUrl: `https://solscan.io/tx/${signature}`,
      });
    } catch (swapError) {
      // Update trade with error
      await prisma.trade.update({
        where: { id: trade.id },
        data: {
          status: "FAILED",
          errorMessage: swapError instanceof Error ? swapError.message : "Unknown error",
        },
      });

      throw swapError;
    }
  } catch (error) {
    console.error("Swap error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Swap failed" },
      { status: 500 }
    );
  } finally {
    // CRITICAL: Clear secret key from memory
    if (secretKey) {
      secretKey.fill(0);
    }
  }
}
