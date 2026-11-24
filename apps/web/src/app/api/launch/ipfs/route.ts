import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/launch/ipfs — proxy token metadata + image to pump.fun's IPFS
 * uploader. Proxied server-side because pump.fun doesn't send CORS headers for
 * browser uploads. No secrets involved; this only relays public metadata.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart form expected" }, { status: 400 });
  }

  const file = form.get("file");
  const name = String(form.get("name") || "").trim();
  const symbol = String(form.get("symbol") || "").trim();
  if (!(file instanceof File) || !name || !symbol) {
    return NextResponse.json({ error: "image, name and symbol are required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "image must be an image file under 5MB" }, { status: 400 });
  }

  const out = new FormData();
  out.set("file", file);
  out.set("name", name.slice(0, 32));
  out.set("symbol", symbol.slice(0, 10));
  out.set("description", String(form.get("description") || "").slice(0, 500));
  for (const k of ["twitter", "telegram", "website"] as const) {
    const v = String(form.get(k) || "").trim();
    if (v) out.set(k, v.slice(0, 200));
  }
  out.set("showName", "true");

  try {
    const r = await fetch("https://pump.fun/api/ipfs", {
      method: "POST",
      body: out,
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    if (!r.ok) {
      console.error("[launch/ipfs] upload failed:", r.status, text.slice(0, 200));
      return NextResponse.json({ error: "metadata upload failed — try again" }, { status: 502 });
    }
    const json = JSON.parse(text);
    if (!json?.metadataUri) {
      return NextResponse.json({ error: "uploader returned no metadataUri" }, { status: 502 });
    }
    return NextResponse.json({ metadataUri: json.metadataUri });
  } catch (e) {
    console.error("[launch/ipfs] error:", e);
    return NextResponse.json({ error: "metadata upload failed — try again" }, { status: 502 });
  }
}
