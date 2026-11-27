/**
 * Stateless email verification codes (server-only).
 *
 * No DB table: the /send route returns an HMAC-sealed challenge token binding
 * (email, code, expiry); /verify recomputes the seal from the user's input.
 * A verified email yields a durable `proof` that /api/wallet/register checks
 * before persisting the address, so nobody can attach an email they don't own.
 */
import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { config } from "./config";

const SECRET = config.authSecret || "polyx-dev-email-secret";
const CODE_TTL_MS = 10 * 60 * 1000;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hmac(parts: string[]): string {
  return createHmac("sha256", SECRET).update(parts.join("|")).digest("hex");
}

export function makeChallenge(email: string): { code: string; token: string; exp: number } {
  const code = String(randomInt(100000, 1000000)); // 6 digits
  const exp = Date.now() + CODE_TTL_MS;
  const seal = hmac(["code", email.toLowerCase(), code, String(exp)]);
  return { code, token: `${exp}.${seal}`, exp };
}

export function verifyChallenge(email: string, code: string, token: string): boolean {
  const [expStr, seal] = String(token).split(".");
  const exp = Number(expStr);
  if (!exp || !seal || Date.now() > exp) return false;
  const expect = hmac(["code", email.toLowerCase(), String(code).trim(), expStr]);
  try {
    return timingSafeEqual(Buffer.from(seal), Buffer.from(expect));
  } catch { return false; }
}

/** Durable "this email was verified on this device" credential. */
export function makeProof(email: string): string {
  return hmac(["verified", email.toLowerCase()]);
}

export function verifyProof(email: string, proof: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(String(proof)), Buffer.from(makeProof(email)));
  } catch { return false; }
}
