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

    const response = await fetchInternalApi(
      `/api/pulse/token/${encodeURIComponent(address)}`
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch pulse token data" },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=5",
      },
    });
  } catch (error) {
    console.error("[pulse/token] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
