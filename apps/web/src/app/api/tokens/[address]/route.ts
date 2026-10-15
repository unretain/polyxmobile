import { NextRequest, NextResponse } from "next/server";
import { feedFetch } from "@/lib/feed";
import { fallbackTokenInfo } from "@/lib/fallback";

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  if (!address || !SOLANA_ADDRESS_REGEX.test(address)) {
    return NextResponse.json({ error: "Invalid token address" }, { status: 400 });
  }

  const feed = await feedFetch(`/api/tokens/${encodeURIComponent(address)}`);
  if (feed) {
    return NextResponse.json(feed, {
      headers: { "Cache-Control": "public, max-age=10" },
    });
  }

  try {
    const token = await fallbackTokenInfo(address);
    if (token) {
      return NextResponse.json(token, {
        headers: { "Cache-Control": "public, max-age=10" },
      });
    }
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  } catch (error) {
    console.error(`[tokens/${address}] Fallback also failed:`, error);
    return NextResponse.json({ error: "All data sources unavailable" }, { status: 503 });
  }
}
