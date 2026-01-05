import { NextRequest, NextResponse } from "next/server";
import { fetchInternalApi } from "@/lib/config";

// Solana address validation
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Valid timeframes - support both formats (1m/1min, 5m/5min)
const VALID_TIMEFRAMES = new Set(["1s", "1m", "1min", "5m", "5min", "15m", "1h", "4h", "1d", "1w", "1M"]);

// Proxy to internal API - protects Birdeye API key
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    // Validate address format
    if (!address || !SOLANA_ADDRESS_REGEX.test(address)) {
      return NextResponse.json(
        { error: "Invalid token address" },
        { status: 400 }
      );
    }

    // Parse and validate query params
    const timeframeParam = req.nextUrl.searchParams.get("timeframe") || "1h";
    const timeframe = VALID_TIMEFRAMES.has(timeframeParam) ? timeframeParam : "1h";

    const fromParam = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");
    const limitParam = req.nextUrl.searchParams.get("limit");

    // Build query string
    const queryParams = new URLSearchParams({ timeframe });
    if (fromParam && /^\d+$/.test(fromParam)) queryParams.set("from", fromParam);
    if (toParam && /^\d+$/.test(toParam)) queryParams.set("to", toParam);
    if (limitParam && /^\d+$/.test(limitParam)) queryParams.set("limit", limitParam);

    const response = await fetchInternalApi(
      `/api/tokens/${encodeURIComponent(address)}/ohlcv?${queryParams.toString()}`
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch OHLCV data" },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=10",
      },
    });
  } catch (error) {
    console.error("[tokens/ohlcv] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
