import { NextResponse } from "next/server";

// Return empty data - API service not available
// TODO: Re-enable when apps/api is deployed
export async function GET() {
  return NextResponse.json({
    data: [],
    total: 0,
    timestamp: Date.now(),
    sources: [],
    realtime: false,
  }, {
    headers: {
      "Cache-Control": "public, max-age=30",
    },
  });
}
