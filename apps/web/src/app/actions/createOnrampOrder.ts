"use server";

/**
 * Server action to create a Crossmint onramp order.
 * Links the wallet to a Crossmint user first, then creates the order.
 * Returns { ok, orderId, clientSecret } on success or { ok, error } on failure.
 */

const CROSSMINT_BASE = "https://www.crossmint.com/api";
const SERVER_KEY = process.env.CROSSMINT_SERVER_SIDE_API_KEY || "";

// USDC on Solana mainnet
const USDC_TOKEN_LOCATOR = "solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

interface CreateOrderParams {
  walletAddress: string;
  receiptEmail: string;
  amount: string;
}

type OrderResult =
  | { ok: true; orderId: string; clientSecret: string }
  | { ok: false; error: string };

/**
 * Link an external wallet to a Crossmint user (by email).
 * Must be called before creating an order for that wallet.
 */
async function linkWallet(email: string, walletAddress: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${CROSSMINT_BASE}/2025-06-09/users/email:${encodeURIComponent(email)}/linked-wallets/${walletAddress}`;

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": SERVER_KEY,
      },
      body: JSON.stringify({
        chain: "solana",
      }),
    });

    const text = await response.text();
    console.log("[crossmint] linkWallet response:", response.status, text);

    if (!response.ok) {
      // 409 = already linked, that's fine
      if (response.status === 409) return { ok: true };
      return { ok: false, error: `Link wallet failed (${response.status}): ${text}` };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[crossmint] linkWallet error:", msg);
    return { ok: false, error: `Link wallet error: ${msg}` };
  }
}

export async function createOnrampOrder({ walletAddress, receiptEmail, amount }: CreateOrderParams): Promise<OrderResult> {
  if (!SERVER_KEY) {
    return { ok: false, error: "Crossmint server key not configured. Set CROSSMINT_SERVER_SIDE_API_KEY." };
  }

  // Step 1: Link the wallet to a Crossmint user
  const linkResult = await linkWallet(receiptEmail, walletAddress);
  if (!linkResult.ok) {
    return { ok: false, error: linkResult.error || "Failed to link wallet" };
  }

  // Step 2: Create the order
  try {
    const body = {
      lineItems: [
        {
          tokenLocator: USDC_TOKEN_LOCATOR,
          executionParameters: {
            mode: "exact-in",
            amount,
          },
        },
      ],
      payment: {
        method: "card",
        receiptEmail,
      },
      recipient: {
        walletAddress,
      },
    };

    console.log("[crossmint] Creating order:", JSON.stringify(body));

    const response = await fetch(`${CROSSMINT_BASE}/2022-06-09/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": SERVER_KEY,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    console.log("[crossmint] Order response:", response.status, text);

    if (!response.ok) {
      return { ok: false, error: `Crossmint API error ${response.status}: ${text}` };
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: `Invalid JSON from Crossmint: ${text.slice(0, 200)}` };
    }

    const orderId = data?.order?.orderId || data?.orderId;
    const clientSecret = data?.clientSecret;

    if (!orderId || !clientSecret) {
      return { ok: false, error: `Missing orderId/clientSecret in response: ${JSON.stringify(data).slice(0, 300)}` };
    }

    return { ok: true, orderId, clientSecret };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[crossmint] Order creation error:", msg);
    return { ok: false, error: `Network error: ${msg}` };
  }
}
