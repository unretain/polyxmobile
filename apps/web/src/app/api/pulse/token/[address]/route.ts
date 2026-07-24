import { NextRequest, NextResponse } from "next/server";
import { fetchInternalApi } from "@/lib/config";
import { pulseState } from "@/lib/pulse-grpc";
import { feedFetch } from "@/lib/feed";

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Cached DexScreener lookups (real 24h volume / liquidity / MC). Cached so the
// token page's 1s poll doesn't hammer DexScreener's rate limit.
const dexCache = new Map<string, { data: any | null; ts: number }>();
// 8s: DexScreener's own data granularity is a few seconds, so this is about as
// "live" as the stat gets for migrated tokens without a dedicated trade stream.
const DEX_TTL = 8000;

async function getDexData(address: string) {
  const cached = dexCache.get(address);
  if (cached && Date.now() - cached.ts < DEX_TTL) return cached.data;
  let data: any = null;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const json = await res.json();
      const pairs: any[] = Array.isArray(json?.pairs) ? json.pairs : [];
      const pair =
        pairs
          .filter((p) => p.chainId === "solana")
          .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0] || pairs[0];
      if (pair) {
        const base = pair.baseToken || {};
        data = {
          address: base.address || address,
          symbol: base.symbol || address.slice(0, 6),
          name: base.name || base.symbol || address.slice(0, 8),
          logoUri: pair.info?.imageUrl || null,
          price: parseFloat(pair.priceUsd) || 0,
          priceChange24h: pair.priceChange?.h24 || 0,
          volume24h: pair.volume?.h24 || 0, // real summed 24h buy+sell USD
          liquidity: pair.liquidity?.usd || 0,
          marketCap: pair.marketCap || pair.fdv || 0,
          txCount: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
          createdAt: pair.pairCreatedAt || Date.now(),
          complete: true,
          progress: 100,
          source: "dexscreener",
        };
      }
    }
  } catch {
    /* ignore, cache null */
  }
  dexCache.set(address, { data, ts: Date.now() });
  return data;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  if (!address || !SOLANA_ADDRESS_REGEX.test(address)) {
    return NextResponse.json({ error: "Invalid token address" }, { status: 400 });
  }

  // Prefer the shared ClickHouse feed (live MC, real 24h volume, curve progress).
  const feed = await feedFetch(`/api/feed/token/${address}`);
  if (feed && feed.address) {
    // Overlay real 24h volume from DexScreener if ClickHouse hasn't accrued a
    // full 24h yet (e.g. right after deploy).
    const dexEarly = feed.volume24h > 0 ? null : await getDexData(address);
    return NextResponse.json(
      { ...feed, volume24h: feed.volume24h || dexEarly?.volume24h || 0 },
      { headers: { "Cache-Control": "public, max-age=2" } }
    );
  }

  const dex = await getDexData(address);

  // In-memory live feed: pre-migration tokens we're actively tracking have LIVE
  // market cap / price / curve progress. Overlay real 24h volume + liquidity from
  // DexScreener (our own volume24h is only cumulative-since-connect).
  const live =
    pulseState.newTokens.get(address) ||
    pulseState.graduatingTokens.get(address) ||
    pulseState.graduatedTokens.get(address);
  if (live) {
    const merged = {
      ...live,
      volume24h: dex?.volume24h ?? live.volume24h,
      liquidity: dex?.liquidity ?? live.liquidity,
      logoUri: live.logoUri || dex?.logoUri || null,
    };
    return NextResponse.json(merged, { headers: { "Cache-Control": "public, max-age=2" } });
  }

  // Migrated / not-in-feed tokens: DexScreener is the real source of MC + volume.
  if (dex) {
    return NextResponse.json(dex, { headers: { "Cache-Control": "public, max-age=5" } });
  }

  // Last resort: internal API (may be down in dev / between deploys).
  try {
    const response = await fetchInternalApi(`/api/pulse/token/${encodeURIComponent(address)}`);
    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=5" } });
    }
  } catch {
    /* fall through */
  }

  return NextResponse.json({ error: "Token not found" }, { status: 404 });
}
