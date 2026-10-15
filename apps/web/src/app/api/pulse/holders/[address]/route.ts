import { NextRequest, NextResponse } from "next/server";
import { feedFetch } from "@/lib/feed";

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  if (!address || !SOLANA_ADDRESS_REGEX.test(address)) {
    return NextResponse.json({ error: "Invalid token address" }, { status: 400 });
  }

  const feed = await feedFetch(`/api/pulse/holders/${encodeURIComponent(address)}`);
  if (feed) {
    return NextResponse.json(feed, {
      headers: { "Cache-Control": "public, max-age=30" },
    });
  }

  return NextResponse.json({ error: "Holder data unavailable" }, { status: 503 });
}
