import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { makeProof, EMAIL_RE } from "@/lib/emailCode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/email/session-proof, after an OAuth sign-in (Google/Apple),
 * the provider has already verified the email, so the session is as good as a
 * code: hand back the same proof the code flow would have issued.
 */
export async function GET() {
  const session = await auth().catch(() => null);
  const email = session?.user?.email;
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, email, proof: makeProof(email) });
}
