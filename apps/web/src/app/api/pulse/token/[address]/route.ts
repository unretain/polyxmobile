/**
 * Single token — ONLY from the shared API gRPC feed. No Dexscreener / web-side
 * gRPC / internal-API fallback: if the token isn't in the live feed, 404.
 */

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

  const feed = await feedFetch(`/api/feed/token/${address}`);
  if (feed && feed.address) {
    return NextResponse.json(feed, { headers: { "Cache-Control": "public, max-age=2" } });
  }

  return NextResponse.json({ error: "Token not found in feed" }, { status: 404 });
}
