import { NextResponse } from "next/server";

// Public pricing information - no auth required
// Embeds are unlimited for all tiers (we serve cached data, no marginal cost)
const PRICING_PLANS = {
  FREE: {
    id: "FREE",
    name: "Free",
    description: "For personal projects and testing",
    price: 0,
    currency: "USD",
    interval: "month",
    features: {
      unlimitedEmbeds: true,
      watermark: true,
      customThemes: false,
      whiteLabel: false,
      apiAccess: false,
      support: "community",
    },
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    description: "For growing businesses and professionals",
    price: 29,
    currency: "USD",
    interval: "month",
    stripePriceId: process.env.STRIPE_PRICE_PRO,
    features: {
      unlimitedEmbeds: true,
      watermark: false,
      customThemes: true,
      whiteLabel: false,
      apiAccess: false,
      support: "priority",
    },
  },
  BUSINESS: {
    id: "BUSINESS",
    name: "Business",
    description: "For enterprises with API access",
    price: 99,
    currency: "USD",
    interval: "month",
    stripePriceId: process.env.STRIPE_PRICE_BUSINESS,
    features: {
      unlimitedEmbeds: true,
      watermark: false,
      customThemes: true,
      whiteLabel: true,
      apiAccess: true,
      apiRateLimit: 5000, // 5000 CU per month
      support: "dedicated",
    },
  },
};

// GET /api/pricing - Public endpoint to fetch pricing info
export async function GET() {
  // Return public pricing without sensitive Stripe IDs
  const publicPricing = Object.entries(PRICING_PLANS).map(([, plan]) => ({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    currency: plan.currency,
    interval: plan.interval,
    features: plan.features,
    // Don't expose stripePriceId
  }));

  return NextResponse.json({
    plans: publicPricing,
    currency: "USD",
    billingCycle: "monthly",
    // API info
    checkoutEndpoint: "/api/checkout",
    embedEndpoint: "/embed/{tokenAddress}",
    ohlcvApiEndpoint: "/api/v1/ohlcv/{tokenAddress}",
    documentationUrl: "/api/docs",
  });
}
