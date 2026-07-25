/**
 * POST /api/wallet/vault — store a user's seed phrase, encrypted, in the vault.
 * Server-side only. The plaintext mnemonic is encrypted before it touches the DB
 * and is never logged.
 */
import { NextRequest, NextResponse } from "next/server";
import { storeSeedPhrase } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function POST(req: NextRequest) {
  let body: { publicKey?: unknown; mnemonic?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { publicKey, mnemonic } = body;
  if (
    typeof publicKey !== "string" ||
    typeof mnemonic !== "string" ||
    !SOLANA_ADDRESS_REGEX.test(publicKey) ||
    mnemonic.trim().split(/\s+/).length < 12
  ) {
    return NextResponse.json({ error: "valid publicKey and mnemonic required" }, { status: 400 });
  }

  const result = await storeSeedPhrase(publicKey, mnemonic.trim());
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
