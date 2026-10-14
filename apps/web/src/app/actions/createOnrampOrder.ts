"use server";

/**
 * Server action to create a Crossmint onramp order.
 * Uses the server-side API key to create an order for USDC on Solana.
 */

const CROSSMINT_API_BASE = "https://www.crossmint.com/api/2022-06-09";
const SERVER_KEY = process.env.CROSSMINT_SERVER_SIDE_API_KEY || "";

// USDC on Solana mainnet
const USDC_TOKEN_LOCATOR = "solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

interface CreateOrderParams {
  walletAddress: string;
  receiptEmail: string;
  amount: string; // USD amount
}

export async function createOnrampOrder({ walletAddress, receiptEmail, amount }: CreateOrderParams) {
  if (!SERVER_KEY) {
    throw new Error("Crossmint server key not configured");
  }

  const response = await fetch(`${CROSSMINT_API_BASE}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": SERVER_KEY,
    },
    body: JSON.stringify({
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
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[crossmint] Order creation failed:", error);
    throw new Error(`Failed to create order: ${response.status}`);
  }

  const data = await response.json();
  return {
    orderId: data.order.orderId,
    clientSecret: data.clientSecret,
  };
}
