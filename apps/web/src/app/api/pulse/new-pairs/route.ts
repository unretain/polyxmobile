/**
 * New Pump.fun pairs — ONLY from the shared API gRPC feed. No fallback:
 * if the feed is down, we return nothing (so the UI reflects the real feed state).
 */

import { NextRequest, NextResponse } from "next/server";
import { feedFetch } from "@/lib/feed";

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");

  const feed = await feedFetch(`/api/feed/new-pairs?limit=${limit}`);
  const data = feed && Array.isArray(feed.data) ? feed.data : [];

  return NextResponse.json({
    data,
    sources: ["grpc"],
    realtime: !!feed,
    solPrice: feed?.solPrice ?? 0,
    tokenCount: data.length,
  });
}
