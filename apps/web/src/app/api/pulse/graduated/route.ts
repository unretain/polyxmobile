/**
 * Graduated Pump.fun tokens via shared gRPC
 */

import { NextResponse } from "next/server";
import { initPulseGrpc, getGraduatedTokens, getSolPrice, isConnected } from "@/lib/pulse-grpc";

export async function GET() {
  // Initialize shared gRPC if needed
  if (!isConnected()) {
    await initPulseGrpc();
  }

  const tokens = await getGraduatedTokens(20);

  return NextResponse.json({
    data: tokens,
    sources: ["grpc"],
    realtime: isConnected(),
    solPrice: getSolPrice(),
  });
}
