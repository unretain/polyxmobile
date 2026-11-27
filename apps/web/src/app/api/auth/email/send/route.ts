import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { makeChallenge, EMAIL_RE } from "@/lib/emailCode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Light per-IP throttle: 5 sends / 10 min. In-memory is fine, worst case a
// redeploy resets the window.
const sends = new Map<string, { n: number; at: number }>();

/** POST /api/auth/email/send {email} → emails a 6-digit code via Resend. */
export async function POST(req: NextRequest) {
  if (!config.resendApiKey) {
    return NextResponse.json({ error: "email sign-up is not configured" }, { status: 501 });
  }
  let email = "";
  try { email = String((await req.json())?.email || "").trim(); } catch {}
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "enter a valid email" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const now = Date.now();
  const s = sends.get(ip);
  if (s && now - s.at < 10 * 60 * 1000 && s.n >= 5) {
    return NextResponse.json({ error: "too many codes, wait a few minutes" }, { status: 429 });
  }
  sends.set(ip, s && now - s.at < 10 * 60 * 1000 ? { n: s.n + 1, at: s.at } : { n: 1, at: now });

  const { code, token, exp } = makeChallenge(email);
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.resendApiKey}` },
      body: JSON.stringify({
        from: config.resendFromEmail,
        to: [email],
        subject: `${code} is your Polyx code`,
        text: `Your Polyx verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      console.error("[email/send] resend failed:", r.status, (await r.text()).slice(0, 200));
      return NextResponse.json({ error: "couldn't send the email, try again" }, { status: 502 });
    }
  } catch (e) {
    console.error("[email/send] error:", e);
    return NextResponse.json({ error: "couldn't send the email, try again" }, { status: 502 });
  }
  return NextResponse.json({ token, exp });
}
