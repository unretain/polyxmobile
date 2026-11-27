import { NextRequest, NextResponse } from "next/server";
import { fetchInternalApi } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/launch/register, tell the feed a mint was launched through Polyx,
 * so Pulse can badge and filter it (source: "polyx"). Best-effort: the launch
 * itself already succeeded on-chain by the time this is called.
 */
export async function POST(req: NextRequest) {
  let mint = "";
  try {
    mint = String((await req.json())?.mint || "");
  } catch {}
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return NextResponse.json({ error: "valid mint required" }, { status: 400 });
  }
  try {
    const r = await fetchInternalApi("/api/feed/polyx-launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mint }),
    });
    return NextResponse.json({ ok: r.ok });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
