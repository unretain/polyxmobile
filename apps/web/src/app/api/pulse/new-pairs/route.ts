/**
 * New Pump.fun pairs via shared gRPC
 */

import { NextRequest, NextResponse } from "next/server";
import { initPulseGrpc, getNewTokens, getSolPrice, isConnected, pulseState } from "@/lib/pulse-grpc";

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");

  // Initialize shared gRPC if needed
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
