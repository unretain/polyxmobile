import { NextRequest, NextResponse } from "next/server";

// Return empty data - API service not available
// TODO: Re-enable when apps/api is deployed
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const timeframe = req.nextUrl.searchParams.get("timeframe") || "1min";

  return NextResponse.json({
    address,
    timeframe,
    data: [],
    timestamp: Date.now(),
    source: "disabled",
    realtime: false,
  }, {
    headers: {
      "Cache-Control": "public, max-age=30",
    },
  });
}
