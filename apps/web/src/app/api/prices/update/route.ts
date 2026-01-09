import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/prices/update - Update cached prices (call from cron or manually)
// GET also works for easy testing
export async function GET(req: NextRequest) {
  return updatePrices();
}

export async function POST(req: NextRequest) {
  return updatePrices();
}

async function updatePrices() {
  try {
    console.log("[prices/update] Fetching SOL price...");

    let solPrice: number | null = null;

    // Try Jupiter Price API first
    try {
      const jupRes = await fetch("https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112", {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (jupRes.ok) {
        const data = await jupRes.json();
        solPrice = data.data?.["So11111111111111111111111111111111111111112"]?.price
          ? parseFloat(data.data["So11111111111111111111111111111111111111112"].price)
          : null;
        console.log("[prices/update] Jupiter SOL price:", solPrice);
      }
    } catch (e) {
      console.warn("[prices/update] Jupiter failed:", e);
    }

    // Fallback to CoinGecko
    if (!solPrice) {
      try {
        const cgRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", {
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(10000),
        });

        if (cgRes.ok) {
          const data = await cgRes.json();
          solPrice = data.solana?.usd || null;
          console.log("[prices/update] CoinGecko SOL price:", solPrice);
        }
      } catch (e) {
        console.warn("[prices/update] CoinGecko failed:", e);
      }
    }

    if (!solPrice) {
      return NextResponse.json(
        { error: "Failed to fetch SOL price from all sources" },
        { status: 503 }
      );
    }

    // Upsert into database
    const cached = await prisma.priceCache.upsert({
      where: { symbol: "SOL" },
      update: { priceUsd: solPrice },
      create: { symbol: "SOL", priceUsd: solPrice },
    });

    console.log("[prices/update] Cached SOL price:", cached.priceUsd);

    return NextResponse.json({
      success: true,
      symbol: "SOL",
      priceUsd: cached.priceUsd,
      updatedAt: cached.updatedAt,
    });
  } catch (error) {
    console.error("[prices/update] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update prices" },
      { status: 500 }
    );
  }
}
