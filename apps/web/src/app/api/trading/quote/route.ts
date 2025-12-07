import { NextRequest, NextResponse } from "next/server";
import { getJupiterService, SOL_MINT } from "@/lib/jupiter";

// GET /api/trading/quote?inputMint=...&outputMint=...&amount=...&slippage=50
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const inputMint = searchParams.get("inputMint") || SOL_MINT;
    const outputMint = searchParams.get("outputMint");
    const amount = searchParams.get("amount");
    const slippage = searchParams.get("slippage");

    if (!outputMint) {
      return NextResponse.json(
        { error: "outputMint is required" },
        { status: 400 }
      );
    }

    if (!amount) {
      return NextResponse.json(
        { error: "amount is required" },
        { status: 400 }
      );
    }

    // Validate amount is a valid number
    if (!/^\d+$/.test(amount)) {
      return NextResponse.json(
        { error: "amount must be a valid integer (in smallest units)" },
        { status: 400 }
      );
    }

    const jupiter = getJupiterService();
    const quote = await jupiter.getQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps: slippage ? parseInt(slippage, 10) : 50, // Default 0.5%
    });

    // Calculate price per token
    const inAmountNum = Number(quote.inAmount);
    const outAmountNum = Number(quote.outAmount);
    const pricePerToken = inAmountNum > 0 ? outAmountNum / inAmountNum : 0;

    return NextResponse.json({
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      outAmountMin: quote.otherAmountThreshold,
      priceImpactPct: parseFloat(quote.priceImpactPct),
      pricePerToken,
      slippageBps: quote.slippageBps,
      routePlan: quote.routePlan.map((step) => ({
        label: step.swapInfo.label,
        percent: step.percent,
      })),
      // Include full quote for swap execution
      _rawQuote: quote,
    });
  } catch (error) {
    console.error("Quote error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get quote" },
      { status: 500 }
    );
  }
}
