import { NextRequest, NextResponse } from "next/server";

// Return empty data - API service not available
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  return NextResponse.json({
    address,
    stats: { totalHolders: 0, holderChange: {} },
    topHolders: [],
    timestamp: Date.now(),
    source: "disabled",
  }, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
