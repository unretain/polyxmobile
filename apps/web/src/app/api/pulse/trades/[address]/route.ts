import { NextRequest, NextResponse } from "next/server";
import { fetchInternalApi } from "@/lib/config";
import { feedFetch } from "@/lib/feed";

// Solana address validation
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// DexScreener recent trades fallback (when ClickHouse + internal API are down).
async function dexTrades(address: string, limit: number) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json();
    const pair = (j?.pairs || []).filter((p: any) => p.chainId === "solana").sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (!pair) return null;
    // DexScreener doesn't expose a raw trade list; return an empty set with the
    // pair so the UI shows "no recent trades" rather than an error.
    return { address, trades: [], data: [], total: 0, source: "dexscreener" };
  } catch { return null; }
}

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

    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam && /^\d+$/.test(limitParam) ? parseInt(limitParam) : 50;

    // Prefer the shared ClickHouse trade history.
    const feed = await feedFetch(`/api/feed/trades/${address}?limit=${limit}`);
    if (feed && Array.isArray(feed.data)) {
      return NextResponse.json(
        { address, trades: feed.data, data: feed.data, total: feed.data.length, source: "clickhouse" },
        { headers: { "Cache-Control": "public, max-age=2" } }
      );
    }

    // Fallback: internal API (Postgres) if still available.
    const response = await fetchInternalApi(`/api/pulse/trades/${encodeURIComponent(address)}?limit=${limit}`);
    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=2" } });
    }

    // Last resort: DexScreener (no raw trade list, returns empty set gracefully).
    const dex = await dexTrades(address, limit);
    if (dex) return NextResponse.json(dex, { headers: { "Cache-Control": "public, max-age=5" } });

    return NextResponse.json({ address, trades: [], data: [], total: 0 }, { headers: { "Cache-Control": "public, max-age=5" } });
  } catch (error) {
    console.error("[pulse/trades] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
