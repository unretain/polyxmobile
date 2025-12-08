import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPumpFunService } from "@/lib/pumpfun";
import { decryptPrivateKey } from "@/lib/wallet";
import { config } from "@/lib/config";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const SOL_MINT = "So11111111111111111111111111111111111111112";

// POST /api/trading/pump-swap
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

    const pumpFun = getPumpFunService();

    // Determine if this is a buy or sell
    const isBuy = inputMint === SOL_MINT;
    const tokenMint = isBuy ? outputMint : inputMint;

    // Verify token is on bonding curve
    const isOnCurve = await pumpFun.isOnBondingCurve(tokenMint);
    if (!isOnCurve) {
      return NextResponse.json(
        { error: "Token is not on pump.fun bonding curve. Use Jupiter instead." },
        { status: 400 }
      );
    }

    // Get quote for trade record
    let quote;
    if (isBuy) {
      quote = await pumpFun.getBuyQuote(tokenMint, BigInt(amount));
    } else {
      quote = await pumpFun.getSellQuote(tokenMint, BigInt(amount));
    }

    if (!quote) {
      return NextResponse.json(
        { error: "Failed to get quote" },
        { status: 500 }
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
        amountOut: quote.outAmount,
        amountOutMin: quote.outAmountMin,
        priceImpact: quote.priceImpactPct,
        status: "PENDING",
      },
    });

    try {
      // Decrypt private key
      const privateKeyBase58 = decryptPrivateKey(
        user.walletEncrypted,
        config.authSecret
      );
      secretKey = bs58.decode(privateKeyBase58);
      const keypair = Keypair.fromSecretKey(secretKey);

      // Update status to submitted
      await prisma.trade.update({
        where: { id: trade.id },
        data: { status: "SUBMITTED" },
      });

      // Execute swap
      let signature: string;
      if (isBuy) {
        signature = await pumpFun.executeBuy(
          tokenMint,
          keypair,
          BigInt(amount),
          slippageBps || 100
        );
      } else {
        signature = await pumpFun.executeSell(
          tokenMint,
          keypair,
          BigInt(amount),
          slippageBps || 100
        );
      }

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
        inputAmount: amount,
        outputAmount: quote.outAmount,
        explorerUrl: `https://solscan.io/tx/${signature}`,
        source: "pumpfun",
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
    console.error("Pump swap error:", error);
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
