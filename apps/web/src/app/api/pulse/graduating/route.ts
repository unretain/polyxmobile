/**
 * Graduating Pump.fun tokens — from the shared API gRPC feed, with DexScreener fallback.
 */

import { NextResponse } from "next/server";
import { feedFetch } from "@/lib/feed";
import { fallbackGraduating } from "@/lib/fallback";

export async function GET() {
  const feed = await feedFetch(`/api/feed/graduating?limit=20`);
  if (feed && Array.isArray(feed.data) && feed.data.length > 0) {
    return NextResponse.json({ data: feed.data, sources: ["grpc"], realtime: true, solPrice: feed.solPrice ?? 0 });
  }

  // Fallback: DexScreener trending tokens as "graduating"
  try {
    const tokens = await fallbackGraduating(20);
    return NextResponse.json({ data: tokens, sources: ["dexscreener-fallback"], realtime: false, solPrice: 0 });
  } catch (error) {
    console.error("[pulse/graduating] Fallback failed:", error);
    return NextResponse.json({ data: [], sources: [], realtime: false, solPrice: 0 });
  }
}
