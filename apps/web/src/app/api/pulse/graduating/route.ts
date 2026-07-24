/**
 * Graduating Pump.fun tokens via shared gRPC
 */

import { NextResponse } from "next/server";
import { initPulseGrpc, getGraduatingTokens, getSolPrice, isConnected } from "@/lib/pulse-grpc";
import { feedFetch } from "@/lib/feed";

export async function GET() {
  const feed = await feedFetch(`/api/feed/graduating?limit=20`);
  if (feed && Array.isArray(feed.data)) {
    return NextResponse.json({ data: feed.data, sources: ["grpc"], realtime: true, solPrice: feed.solPrice ?? 0 });
  }

  if (!isConnected()) {
    await initPulseGrpc();
  }

  const tokens = await getGraduatingTokens(20);

  return NextResponse.json({
    data: tokens,
    sources: ["grpc"],
    realtime: isConnected(),
    solPrice: getSolPrice(),
  });
}
