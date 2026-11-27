"use server";

import { prisma } from "@/lib/prisma";

/**
 * Crossmint onramp, server-side order management.
 *
 * Orders are ALWAYS created here (never from the client) per Crossmint's
 * checklist item [8]. The server key must have scopes: orders.create, orders.read.
 */

const CROSSMINT_BASE = "https://www.crossmint.com/api";
const SERVER_KEY = process.env.CROSSMINT_SERVER_SIDE_API_KEY || "";

const USDC_TOKEN_LOCATOR = "solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Bump when the consent wording in OnrampModal changes. */
const ONRAMP_TOS_VERSION = "2026-11-23";

const MIN_USD = 1;
const MAX_USD = 5000;

export interface OnrampFeeLine {
  label: string;
  amount: string;
  currency: string;
}

export interface OnrampQuote {
  /** What the card is charged, fees included. */
  totalUsd: string;
  currency: string;
  /** Individual fee lines when Crossmint itemizes them. */
  fees: OnrampFeeLine[];
  /** Estimated USDC delivered (exact-in order), when quoted. */
  receiveAmount: string | null;
}

interface CreateOrderParams {
  walletAddress: string;
  receiptEmail: string;
  /** USD amount, exact-in. */
  amount: string;
  /** Must be true, the user ticked the Crossmint ToS/Privacy consent box. */
  acceptedTerms: boolean;
}

type OrderResult =
  | { ok: true; orderId: string; clientSecret: string; quote: OnrampQuote }
  | { ok: false; error: string };

function titleCase(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Pull a human-usable quote out of Crossmint's order object, defensively. */
function parseQuote(order: any, fallbackUsd: string): OnrampQuote {
  const li = order?.lineItems?.[0];
  const charges = li?.quote?.charges ?? {};
  const fees: OnrampFeeLine[] = [];
  for (const [key, val] of Object.entries<any>(charges)) {
    if (key === "unit" || !val?.amount) continue;
    fees.push({
      label: titleCase(key),
      amount: String(val.amount),
      currency: String(val.currency ?? "usd").toUpperCase(),
    });
  }
  const total =
    order?.quote?.totalPrice ?? li?.quote?.totalPrice ?? charges?.unit ?? null;
  const receive =
    li?.quote?.quantity ?? li?.quote?.quantityRange?.lowerBound ?? null;
  return {
    totalUsd: total?.amount ? String(total.amount) : fallbackUsd,
    currency: String(total?.currency ?? "usd").toUpperCase(),
    fees,
    receiveAmount: receive != null ? String(receive) : null,
  };
}

export async function createOnrampOrder({
  walletAddress,
  receiptEmail,
  amount,
  acceptedTerms,
}: CreateOrderParams): Promise<OrderResult> {
  if (!SERVER_KEY) {
    return { ok: false, error: "Buying is not available right now. (Payments are not configured.)" };
  }
  if (!SOLANA_ADDRESS_REGEX.test(walletAddress)) {
    return { ok: false, error: "Invalid receiving wallet address." };
  }
  const email = receiptEmail.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email for your receipt." };
  }
  const usd = Number(amount);
  if (!Number.isFinite(usd) || usd < MIN_USD || usd > MAX_USD) {
    return { ok: false, error: `Amount must be between $${MIN_USD} and $${MAX_USD}.` };
  }
  if (!acceptedTerms) {
    return { ok: false, error: "You must accept the Crossmint Terms of Service to continue." };
  }

  // Record consent BEFORE taking payment (Crossmint compliance checklist).
  // Fail closed: no recorded consent, no order.
  let consentId: string;
  try {
    const consent = await prisma.onrampConsent.create({
      data: { walletAddress, email, tosVersion: ONRAMP_TOS_VERSION },
    });
    consentId = consent.id;
  } catch (e) {
    console.error("[crossmint] consent write failed:", e);
    return { ok: false, error: "Could not start checkout. Please try again in a moment." };
  }

  try {
    const body = {
      recipient: { walletAddress },
      payment: { method: "card", receiptEmail: email },
      lineItems: [
        {
          tokenLocator: USDC_TOKEN_LOCATOR,
          executionParameters: { mode: "exact-in", amount: String(usd) },
        },
      ],
    };

    const response = await fetch(`${CROSSMINT_BASE}/2022-06-09/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": SERVER_KEY },
      body: JSON.stringify(body),
    });

    const text = await response.text();

    if (!response.ok) {
      console.error("[crossmint] order create failed:", response.status, text.slice(0, 500));
      return { ok: false, error: friendlyCreateError(response.status, text) };
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: "Unexpected response from the payment provider. Try again." };
    }

    const order = data?.order ?? data;
    const orderId = order?.orderId || data?.orderId;
    const clientSecret = data?.clientSecret;
    if (!orderId || !clientSecret) {
      console.error("[crossmint] missing orderId/clientSecret:", JSON.stringify(data).slice(0, 300));
      return { ok: false, error: "Could not start checkout. Please try again." };
    }

    // Tie the consent row to the order (best-effort; the consent itself is already stored).
    prisma.onrampConsent
      .update({ where: { id: consentId }, data: { orderId } })
      .catch(() => {});

    return { ok: true, orderId, clientSecret, quote: parseQuote(order, String(usd)) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[crossmint] order error:", msg);
    return { ok: false, error: "Network error reaching the payment provider. Check your connection and try again." };
  }
}

function friendlyCreateError(status: number, raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("unsupported") && lower.includes("country")) {
    return "Card purchases aren't available in your country yet.";
  }
  if (status === 400 && lower.includes("amount")) {
    return "That amount isn't supported. Try a different amount.";
  }
  if (status === 401 || status === 403) {
    return "Buying is temporarily unavailable. (Payment provider rejected our credentials.)";
  }
  if (status === 429) {
    return "Too many attempts. Wait a minute and try again.";
  }
  return "Could not start checkout. Please try again.";
}

// ---------------------------------------------------------------------------

export interface OnrampOrderStatus {
  ok: boolean;
  phase: "quote" | "payment" | "delivery" | "completed" | "unknown";
  paymentStatus: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  /** Solana tx that delivered the USDC, once known. */
  txId: string | null;
  error?: string;
}

/** Read an order's status server-side (orders.read scope). Used to confirm delivery. */
export async function getOnrampOrderStatus(orderId: string): Promise<OnrampOrderStatus> {
  const bad: OnrampOrderStatus = {
    ok: false, phase: "unknown", paymentStatus: null,
    failureCode: null, failureMessage: null, txId: null,
  };
  if (!SERVER_KEY || !/^[A-Za-z0-9_-]{6,128}$/.test(orderId)) return bad;
  try {
    const r = await fetch(`${CROSSMINT_BASE}/2022-06-09/orders/${orderId}`, {
      headers: { "x-api-key": SERVER_KEY },
      cache: "no-store",
    });
    if (!r.ok) return { ...bad, error: `status ${r.status}` };
    const data: any = await r.json();
    const order = data?.order ?? data;
    const li = order?.lineItems?.[0];
    return {
      ok: true,
      phase: order?.phase ?? "unknown",
      paymentStatus: order?.payment?.status ?? null,
      failureCode: order?.payment?.failureReason?.code ?? null,
      failureMessage: order?.payment?.failureReason?.message ?? null,
      txId: li?.delivery?.txId ?? null,
    };
  } catch {
    return bad;
  }
}
