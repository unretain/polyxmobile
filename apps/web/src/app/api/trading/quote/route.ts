import { NextRequest, NextResponse } from "next/server";
import { getJupiterService, SOL_MINT } from "@/lib/jupiter";

// GET /api/trading/quote?inputMint=...&outputMint=...&amount=...&slippage=50
export async function GET(req: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = req.nextUrl;
    const inputMint = searchParams.get("inputMint") || SOL_MINT;
    const outputMint = searchParams.get("outputMint");
    const amount = searchParams.get("amount");
    const slippage = searchParams.get("slippage");

    console.log(`[QUOTE] Request: inputMint=${inputMint}, outputMint=${outputMint}, amount=${amount}`);

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

    console.log(`[QUOTE] Calling Jupiter API...`);
    const jupiter = getJupiterService();
    const quote = await jupiter.getQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps: slippage ? parseInt(slippage, 10) : 50, // Default 0.5%
    });

    console.log(`[QUOTE] Jupiter responded in ${Date.now() - startTime}ms`);

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
    const duration = Date.now() - startTime;
    console.error(`[QUOTE] Error after ${duration}ms:`, error);

    // More detailed error info
    const errorMessage = error instanceof Error ? error.message : "Failed to get quote";
    const errorDetails = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack?.split("\n").slice(0, 3).join("\n"),
    } : { raw: String(error) };

    console.error(`[QUOTE] Error details:`, JSON.stringify(errorDetails));

    return NextResponse.json(
      {
        error: errorMessage,
        debug: {
          duration,
          timestamp: new Date().toISOString(),
        }
      },
      { status: 500 }
    );
  }
}
