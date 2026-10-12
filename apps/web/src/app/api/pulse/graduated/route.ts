/**
 * Graduated Pump.fun tokens — from the shared API gRPC feed, with DexScreener fallback.
 */

import { NextResponse } from "next/server";
import { feedFetch } from "@/lib/feed";
import { fallbackGraduated } from "@/lib/fallback";

export async function GET() {
  const feed = await feedFetch(`/api/feed/graduated?limit=100`);
  if (feed && Array.isArray(feed.data) && feed.data.length > 0) {
    return NextResponse.json({ data: feed.data, sources: ["grpc"], realtime: true, solPrice: feed.solPrice ?? 0 });
  }

  // Fallback: DexScreener latest token profiles as "graduated"
  try {
    const tokens = await fallbackGraduated(50);
    return NextResponse.json({ data: tokens, sources: ["dexscreener-fallback"], realtime: false, solPrice: 0 });
  } catch (error) {
    console.error("[pulse/graduated] Fallback failed:", error);
    return NextResponse.json({ data: [], sources: [], realtime: false, solPrice: 0 });
  }
}
