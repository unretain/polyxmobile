import { NextRequest, NextResponse } from "next/server";
import { feedFetch } from "@/lib/feed";
import { fallbackTrendingTokens } from "@/lib/fallback";

export async function GET(req: NextRequest) {
  const limit = req.nextUrl.searchParams.get("limit") || "100";

  const feed = await feedFetch(`/api/tokens?limit=${limit}`);
  if (feed) {
    return NextResponse.json(feed, {
      headers: { "Cache-Control": "public, max-age=30" },
    });
  }

  try {
    const tokens = await fallbackTrendingTokens(parseInt(limit));
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
