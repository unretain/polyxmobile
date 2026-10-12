import { NextRequest, NextResponse } from "next/server";
import { feedFetch } from "@/lib/feed";
import { fallbackOHLCV } from "@/lib/fallback";

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const timeframe = req.nextUrl.searchParams.get("timeframe") || "1m";

  if (!address || !SOLANA_ADDRESS_REGEX.test(address)) {
    return NextResponse.json({ error: "Invalid token address", data: [] }, { status: 400 });
  }

  // Try internal feed first
  const feed = await feedFetch(`/api/feed/ohlcv/${address}?timeframe=${timeframe}`);
  if (feed && Array.isArray(feed.data) && feed.data.length > 0) {
    return NextResponse.json(
      { address, timeframe, data: feed.data, source: "grpc", backfilling: !!feed.backfilling },
      { headers: { "Cache-Control": "public, max-age=1" } }
    );
  }

  // Fallback: GeckoTerminal OHLCV
  try {
    const candles = await fallbackOHLCV(address, timeframe, 100);
    if (candles.length > 0) {
      return NextResponse.json(
        { address, timeframe, data: candles, source: "geckoterminal-fallback" },
        { headers: { "Cache-Control": "public, max-age=15" } }
      );
    }
  } catch (error) {
    console.warn(`[pulse/ohlcv/${address}] Fallback failed:`, error);
  }

  return NextResponse.json({ address, timeframe, data: [], source: "none" });
}
