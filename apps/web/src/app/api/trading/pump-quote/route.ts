import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPumpFunService } from "@/lib/pumpfun";

const SOL_MINT = "So11111111111111111111111111111111111111112";

// GET /api/trading/pump-quote?inputMint=...&outputMint=...&amount=...
export async function GET(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const searchParams = req.nextUrl.searchParams;
    const inputMint = searchParams.get("inputMint");
    const outputMint = searchParams.get("outputMint");
    const amount = searchParams.get("amount");
    const slippage = parseInt(searchParams.get("slippage") || "100"); // Default 1%

    if (!inputMint || !outputMint || !amount) {
      return NextResponse.json(
        { error: "inputMint, outputMint, and amount are required" },
        { status: 400 }
      );
    }

    const pumpFun = getPumpFunService();

    // Determine if this is a buy or sell
    const isBuy = inputMint === SOL_MINT;
    const tokenMint = isBuy ? outputMint : inputMint;

    // Check if token is on bonding curve
    const isOnCurve = await pumpFun.isOnBondingCurve(tokenMint);
    if (!isOnCurve) {
      return NextResponse.json(
        { error: "Token is not on pump.fun bonding curve. Use Jupiter instead.", code: "NOT_ON_CURVE" },
        { status: 400 }
      );
    }

    // Get quote
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

    // Calculate min output with slippage
    const outAmountMin = (BigInt(quote.outAmount) * BigInt(10000 - slippage)) / BigInt(10000);

    return NextResponse.json({
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      outAmountMin: outAmountMin.toString(),
      priceImpactPct: quote.priceImpactPct,
      slippageBps: slippage,
      routePlan: [{ label: "Pump.fun", percent: 100 }],
      source: "pumpfun",
      bondingCurve: quote.bondingCurve,
    });
  } catch (error) {
    console.error("Pump quote error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get quote" },
      { status: 500 }
    );
  }
}
