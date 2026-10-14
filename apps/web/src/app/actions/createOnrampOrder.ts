"use server";

const CROSSMINT_BASE = "https://www.crossmint.com/api";
const SERVER_KEY = process.env.CROSSMINT_SERVER_SIDE_API_KEY || "";

const USDC_TOKEN_LOCATOR = "solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

interface CreateOrderParams {
  walletAddress: string;
  receiptEmail: string;
  amount: string;
}

type OrderResult =
  | { ok: true; orderId: string; clientSecret: string }
  | { ok: false; error: string };

export async function createOnrampOrder({ walletAddress, receiptEmail, amount }: CreateOrderParams): Promise<OrderResult> {
  if (!SERVER_KEY) {
    return { ok: false, error: "Crossmint server key not configured." };
  }

  try {
    const body = {
      recipient: { walletAddress },
      payment: { method: "card", receiptEmail },
      lineItems: [
        {
          tokenLocator: USDC_TOKEN_LOCATOR,
          executionParameters: { mode: "exact-in", amount },
        },
      ],
    };

    console.log("[crossmint] Creating order:", JSON.stringify(body));

    const response = await fetch(`${CROSSMINT_BASE}/2022-06-09/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": SERVER_KEY },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    console.log("[crossmint] Order response:", response.status, text);

    if (!response.ok) {
      return { ok: false, error: `Crossmint API error ${response.status}: ${text}` };
    }

    let data: any;
    try { data = JSON.parse(text); } catch {
      return { ok: false, error: `Invalid JSON from Crossmint: ${text.slice(0, 200)}` };
    }

    const orderId = data?.order?.orderId || data?.orderId;
    const clientSecret = data?.clientSecret;

    if (!orderId || !clientSecret) {
      return { ok: false, error: `Missing orderId/clientSecret: ${JSON.stringify(data).slice(0, 300)}` };
    }

    return { ok: true, orderId, clientSecret };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[crossmint] Order error:", msg);
    return { ok: false, error: `Network error: ${msg}` };
  }
}
