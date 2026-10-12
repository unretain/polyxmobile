import { NextRequest, NextResponse } from "next/server";
import { fetchInternalApi } from "@/lib/config";
import { fallbackTrendingTokens } from "@/lib/fallback";

// Proxy to internal API - protects Birdeye API key
// Falls back to DexScreener when internal API is down
export async function GET(req: NextRequest) {
  try {
    const limit = req.nextUrl.searchParams.get("limit") || "100";

    const response = await fetchInternalApi(`/api/tokens?limit=${limit}`);

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data, {
        headers: { "Cache-Control": "public, max-age=30" },
      });
    }
  } catch (error) {
    console.warn("[tokens] Internal API unavailable, using fallback");
  }

  // Fallback: DexScreener trending tokens
  try {
    const tokens = await fallbackTrendingTokens(parseInt(req.nextUrl.searchParams.get("limit") || "100"));
    return NextResponse.json(
      { data: tokens, source: "dexscreener-fallback" },
      { headers: { "Cache-Control": "public, max-age=30" } }
    );
  } catch (error) {
    console.error("[tokens] Fallback also failed:", error);
    return NextResponse.json(
      { error: "All data sources unavailable", data: [] },
      { status: 503 }
    );
  }
}
