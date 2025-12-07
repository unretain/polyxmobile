import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TradeStatus } from "@prisma/client";

// GET /api/trading/history
export async function GET(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const { searchParams } = req.nextUrl;
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");
    const statusParam = searchParams.get("status"); // Optional filter

    const where: { userId: string; status?: TradeStatus } = {
      userId: session.user.id,
    };

    if (statusParam) {
      const upperStatus = statusParam.toUpperCase() as TradeStatus;
      if (Object.values(TradeStatus).includes(upperStatus)) {
        where.status = upperStatus;
      }
    }

    const [trades, total] = await Promise.all([
      prisma.trade.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          inputMint: true,
          inputSymbol: true,
          outputMint: true,
          outputSymbol: true,
          amountIn: true,
          amountOut: true,
          priceImpact: true,
          txSignature: true,
          status: true,
          errorMessage: true,
          platformFee: true,
          createdAt: true,
          confirmedAt: true,
        },
      }),
      prisma.trade.count({ where }),
    ]);

    return NextResponse.json({
      trades: trades.map((t) => ({
        ...t,
        explorerUrl: t.txSignature ? `https://solscan.io/tx/${t.txSignature}` : null,
      })),
      total,
      limit,
      offset,
      hasMore: offset + trades.length < total,
    });
  } catch (error) {
    console.error("History error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get history" },
      { status: 500 }
    );
  }
}
