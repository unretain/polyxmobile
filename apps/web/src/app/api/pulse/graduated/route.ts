/**
 * Graduated Pump.fun tokens — ONLY from the shared API gRPC feed. No fallback.
 */

import { NextResponse } from "next/server";
import { feedFetch } from "@/lib/feed";

export async function GET() {
  const feed = await feedFetch(// 20 filled barely half a column and cut off anything older.
    `/api/feed/graduated?limit=100`);
  const data = feed && Array.isArray(feed.data) ? feed.data : [];
  return NextResponse.json({ data, sources: ["grpc"], realtime: !!feed, solPrice: feed?.solPrice ?? 0 });
}
