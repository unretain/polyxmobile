import { NextRequest, NextResponse } from "next/server";
import { fetchInternalApi } from "@/lib/config";

// Proxy to internal API - protects Moralis API key
export async function GET(req: NextRequest) {
  try {
    const limit = req.nextUrl.searchParams.get("limit") || "50";
    const source = req.nextUrl.searchParams.get("source") || "all";

    const response = await fetchInternalApi(
      `/api/pulse/new-pairs?limit=${limit}&source=${source}`
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch new pairs" },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=5", // Cache for 5 seconds
      },
    });
  } catch (error) {
    console.error("[pulse/new-pairs] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
