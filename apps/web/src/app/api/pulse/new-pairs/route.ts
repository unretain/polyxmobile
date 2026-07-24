/**
 * New Pump.fun pairs via shared gRPC
 */

import { NextRequest, NextResponse } from "next/server";
import { initPulseGrpc, getNewTokens, getSolPrice, isConnected, pulseState } from "@/lib/pulse-grpc";
import { feedFetch } from "@/lib/feed";

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");

  // Prefer the shared ClickHouse feed (same data for everyone, survives restarts).
  const feed = await feedFetch(`/api/feed/new-pairs?limit=${limit}`);
  if (feed && Array.isArray(feed.data)) {
    return NextResponse.json({
      data: feed.data,
      sources: ["grpc"],
      realtime: true,
      solPrice: feed.solPrice ?? 0,
      tokenCount: feed.data.length,
    });
  }

  // Fallback: this instance's in-memory gRPC feed.
  if (!isConnected()) {
    await initPulseGrpc();
  }

  const tokens = await getNewTokens(limit);

  return NextResponse.json({
    data: tokens,
    sources: ["grpc"],
    realtime: isConnected(),
    solPrice: getSolPrice(),
    tokenCount: pulseState.newTokens.size,
  });
}
