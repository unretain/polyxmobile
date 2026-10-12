import { NextRequest, NextResponse } from "next/server";
import { fetchInternalApi } from "@/lib/config";
import { fallbackTokenInfo } from "@/lib/fallback";

// Solana address validation
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Proxy to internal API - protects Birdeye API key
// Falls back to DexScreener when internal API is down
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  // Validate address format
  if (!address || !SOLANA_ADDRESS_REGEX.test(address)) {
    return NextResponse.json(
      { error: "Invalid token address" },
      { status: 400 }
    );
  }

  // Try internal API first
  try {
    const response = await fetchInternalApi(
      `/api/tokens/${encodeURIComponent(address)}`
    );

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data, {
        headers: { "Cache-Control": "public, max-age=10" },
      });
    }
  } catch (error) {
    console.warn(`[tokens/${address}] Internal API unavailable, using fallback`);
  }

  // Fallback: DexScreener token info
  try {
    const token = await fallbackTokenInfo(address);
    if (token) {
      return NextResponse.json(token, {
        headers: { "Cache-Control": "public, max-age=10" },
      });
    }
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  } catch (error) {
    console.error(`[tokens/${address}] Fallback also failed:`, error);
    return NextResponse.json(
      { error: "All data sources unavailable" },
      { status: 503 }
    );
  }
}
