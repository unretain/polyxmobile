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

  const feed = await feedFetch(`/api/tokens/${encodeURIComponent(address)}/supply`);
  if (feed) {
    return NextResponse.json(feed, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  return NextResponse.json({ error: "Supply data unavailable" }, { status: 503 });
}
