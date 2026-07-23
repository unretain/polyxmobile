import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same-origin Solana RPC proxy for the ColdStick wallet (balance / blockhash /
// send). The browser can't reach the configured RPC directly — the public
// mainnet-beta endpoint rate-limits and CORS-blocks inside the WKWebView, and
// the Corvus trial RPC is IP-whitelisted to the server. So the client posts
// JSON-RPC here and we forward it server-side.
//
// Target: use SOLANA_RPC_URL when it's a real hosted RPC (e.g. Helius). Fall
// back to a reliable keyless public node when it's only the rate-limited default
// or the whitelisted-only Corvus endpoint (not reachable/appropriate here).
const RELIABLE_PUBLIC_RPC = "https://solana-rpc.publicnode.com";

function rpcTarget(): string {
  const url = config.solanaRpcUrl;
  if (
    !url ||
    url.includes("mainnet-beta.solana.com") ||
    url.includes("corvus-labs") ||
    url.startsWith("http://")
  ) {
    return RELIABLE_PUBLIC_RPC;
  }
  return url;
}

export async function POST(req: NextRequest) {
  let body: string;
  try {
    body = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const target = rpcTarget();

  try {
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "RPC proxy request failed" },
      { status: 502 }
    );
  }
}
