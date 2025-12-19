// Background price updater - runs every 30 seconds to keep SOL price fresh
import { prisma } from "@/lib/prisma";

const UPDATE_INTERVAL_MS = 30_000; // 30 seconds
let intervalId: NodeJS.Timeout | null = null;

async function updateSolPrice(): Promise<void> {
  try {
    let solPrice: number | null = null;

    // Try Jupiter Price API first
    try {
      const jupRes = await fetch(
        "https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112",
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (jupRes.ok) {
        const data = await jupRes.json();
        solPrice = data.data?.["So11111111111111111111111111111111111111112"]?.price
          ? parseFloat(data.data["So11111111111111111111111111111111111111112"].price)
          : null;
      }
    } catch {
      // Jupiter failed, try fallback
    }

    // Fallback to CoinGecko
    if (!solPrice) {
      try {
        const cgRes = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
          {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10000),
          }
        );

        if (cgRes.ok) {
          const data = await cgRes.json();
          solPrice = data.solana?.usd || null;
        }
      } catch {
        // CoinGecko also failed
      }
    }

    if (solPrice) {
      await prisma.priceCache.upsert({
        where: { symbol: "SOL" },
        update: { priceUsd: solPrice },
        create: { symbol: "SOL", priceUsd: solPrice },
      });
      console.log(`[price-updater] SOL price updated: $${solPrice}`);
    } else {
      console.warn("[price-updater] Failed to fetch SOL price from all sources");
    }
  } catch (error) {
    console.error("[price-updater] Error:", error);
  }
}

export function startPriceUpdater(): void {
  if (intervalId) {
    console.log("[price-updater] Already running");
    return;
  }

  console.log("[price-updater] Starting background price updater (30s interval)");

  // Update immediately on startup
  updateSolPrice();

  // Then update every 30 seconds
  intervalId = setInterval(updateSolPrice, UPDATE_INTERVAL_MS);
}

export function stopPriceUpdater(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[price-updater] Stopped");
  }
}
