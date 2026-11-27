import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptWalletAddress } from "@/lib/mobileWallet";
import { verifyProof, EMAIL_RE } from "@/lib/emailCode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENCRYPTION_KEY = process.env.AUTH_SECRET || "";

/**
 * POST /api/wallet/lookup {email, emailProof} → wallet addresses previously
 * registered under this VERIFIED email. Powers "welcome back": signing up
 * twice with the same email offers an import instead of silently minting a
 * fresh wallet. Proof required, so only the email's owner can ask.
 */
export async function POST(req: NextRequest) {
  let email = "", emailProof = "";
  try {
    const b = await req.json();
    email = String(b?.email || "").trim();
    emailProof = String(b?.emailProof || "");
  } catch {}
  if (!EMAIL_RE.test(email) || !verifyProof(email, emailProof)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const rows = await prisma.mobileUser.findMany({
      where: { email },
      select: { encryptedPublicKey: true },
      take: 50,
    });
    const wallets = new Set<string>();
    for (const r of rows) {
      try {
        const pk = await decryptWalletAddress(r.encryptedPublicKey, ENCRYPTION_KEY);
        if (pk && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pk)) wallets.add(pk);
      } catch { /* legacy/undecryptable row */ }
    }
    return NextResponse.json({ wallets: [...wallets] });
  } catch (e) {
    console.error("[wallet/lookup] failed:", e);
    return NextResponse.json({ wallets: [] });
  }
}
