/**
 * New Pump.fun pairs — from the shared API gRPC feed, with DexScreener fallback.
 */

import { NextRequest, NextResponse } from "next/server";
import { feedFetch } from "@/lib/feed";
import { fallbackNewPairs } from "@/lib/fallback";

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");

  const feed = await feedFetch(`/api/feed/new-pairs?limit=${limit}`);
  if (feed && Array.isArray(feed.data) && feed.data.length > 0) {
    return NextResponse.json({
      data: feed.data,
      sources: ["grpc"],
      realtime: true,
      solPrice: feed.solPrice ?? 0,
      tokenCount: feed.data.length,
    });
  }

  // Fallback: DexScreener latest pairs
  try {
    const tokens = await fallbackNewPairs(limit);
    return NextResponse.json({
      data: tokens,
      sources: ["dexscreener-fallback"],
      realtime: false,
      solPrice: 0,
      tokenCount: tokens.length,
    });
  } catch (error) {
    console.error("[pulse/new-pairs] Fallback failed:", error);
    return NextResponse.json({
      data: [],
      sources: [],
      realtime: false,
      solPrice: 0,
      tokenCount: 0,
    });
  }
}
