import { NextRequest, NextResponse } from "next/server";
import { verifyChallenge, makeProof, EMAIL_RE } from "@/lib/emailCode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/email/verify {email, code, token} → {proof} when the code matches. */
export async function POST(req: NextRequest) {
  let email = "", code = "", token = "";
  try {
    const b = await req.json();
    email = String(b?.email || "").trim();
    code = String(b?.code || "").trim();
    token = String(b?.token || "");
  } catch {}
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code) || !token) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!verifyChallenge(email, code, token)) {
    return NextResponse.json({ error: "wrong or expired code" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, proof: makeProof(email) });
}
