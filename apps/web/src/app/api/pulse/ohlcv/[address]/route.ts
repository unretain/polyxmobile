import { NextRequest, NextResponse } from "next/server";
import { feedFetch } from "@/lib/feed";

// OHLCV comes ONLY from our own gRPC-built candles (live + on-demand RPC backfill).
// No third-party chart data. For a coin we've never seen live, the feed kicks off
// an RPC backfill and this returns [] until it lands (chart shows "no data yet").
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

  const feed = await feedFetch(`/api/feed/ohlcv/${address}?timeframe=${timeframe}`);
  if (feed && Array.isArray(feed.data)) {
    return NextResponse.json(
      { address, timeframe, data: feed.data, source: "grpc", backfilling: !!feed.backfilling },
      { headers: { "Cache-Control": "public, max-age=1" } }
    );
  }

  // Feed unreachable — return empty rather than falling back to a third party.
  return NextResponse.json({ address, timeframe, data: [], source: "grpc" });
}
