import { NextRequest, NextResponse } from "next/server";
import { fetchInternalApi } from "@/lib/config";

// Solana address validation
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Proxy to internal API - protects Moralis API key
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

    // Get query params
    const limitParam = req.nextUrl.searchParams.get("limit");
    const queryParams = new URLSearchParams();
    if (limitParam && /^\d+$/.test(limitParam)) {
      queryParams.set("limit", limitParam);
    }

    const queryString = queryParams.toString();
    const url = `/api/pulse/trades/${encodeURIComponent(address)}${queryString ? `?${queryString}` : ""}`;

    const response = await fetchInternalApi(url);

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch trades" },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=2",
      },
    });
  } catch (error) {
    console.error("[pulse/trades] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
