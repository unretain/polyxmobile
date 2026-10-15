import { NextRequest, NextResponse } from "next/server";
import { feedFetch } from "@/lib/feed";
import { fallbackOHLCV } from "@/lib/fallback";

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const VALID_TIMEFRAMES = new Set(["1s", "1m", "1min", "5m", "5min", "15m", "1h", "4h", "1d", "1w", "1M"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  if (!address || !SOLANA_ADDRESS_REGEX.test(address)) {
    return NextResponse.json({ error: "Invalid token address" }, { status: 400 });
  }

  const timeframeParam = req.nextUrl.searchParams.get("timeframe") || "1h";
  const timeframe = VALID_TIMEFRAMES.has(timeframeParam) ? timeframeParam : "1h";
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam) : 100;

  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const queryParams = new URLSearchParams({ timeframe });
  if (fromParam && /^\d+$/.test(fromParam)) queryParams.set("from", fromParam);
  if (toParam && /^\d+$/.test(toParam)) queryParams.set("to", toParam);
  if (limitParam && /^\d+$/.test(limitParam)) queryParams.set("limit", limitParam);

  const feed = await feedFetch(`/api/tokens/${encodeURIComponent(address)}/ohlcv?${queryParams.toString()}`);
  if (feed) {
    return NextResponse.json(feed, {
      headers: { "Cache-Control": "public, max-age=10" },
    });
  }

  try {
    const candles = await fallbackOHLCV(address, timeframe, limit);
    return NextResponse.json(candles, {
      headers: { "Cache-Control": "public, max-age=15" },
    });
  } catch (error) {
    console.error(`[ohlcv/${address}] Fallback also failed:`, error);
    return NextResponse.json([], { status: 200 });
  }
}
