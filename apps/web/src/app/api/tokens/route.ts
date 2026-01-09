import { NextRequest, NextResponse } from "next/server";
import { fetchInternalApi } from "@/lib/config";

// Proxy to internal API - protects Birdeye API key
export async function GET(req: NextRequest) {
  try {
    const limit = req.nextUrl.searchParams.get("limit") || "100";

    const response = await fetchInternalApi(`/api/tokens?limit=${limit}`);

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch tokens" },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=30", // Cache for 30 seconds
      },
    });
  } catch (error) {
    console.error("[tokens] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
