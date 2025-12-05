import { NextResponse } from "next/server";

// Public pricing information - no auth required
const PRICING_PLANS = {
  FREE: {
    id: "FREE",
    name: "Free",
    description: "For personal projects and testing",
    price: 0,
    currency: "USD",
    interval: "month",
    features: {
      domains: 1,
      viewsPerMonth: 1000,
      watermark: true,
      customThemes: false,
      whiteLabel: false,
      support: "community",
    },
    limits: {
      maxDomains: 1,
      maxViewsPerMonth: 1000,
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
      domains: 3,
      viewsPerMonth: 50000,
      watermark: false,
      customThemes: true,
      whiteLabel: false,
      support: "priority",
    },
    limits: {
      maxDomains: 3,
      maxViewsPerMonth: 50000,
    },
  },
  BUSINESS: {
    id: "BUSINESS",
    name: "Business",
    description: "For enterprises with custom needs",
    price: 99,
    currency: "USD",
    interval: "month",
    stripePriceId: process.env.STRIPE_PRICE_BUSINESS,
    features: {
      domains: 10,
      viewsPerMonth: 500000,
      watermark: false,
      customThemes: true,
      whiteLabel: true,
      support: "dedicated",
    },
    limits: {
      maxDomains: 10,
      maxViewsPerMonth: 500000,
    },
  },
};

// GET /api/pricing - Public endpoint to fetch pricing info
export async function GET() {
  // Return public pricing without sensitive Stripe IDs
  const publicPricing = Object.entries(PRICING_PLANS).map(([key, plan]) => ({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    currency: plan.currency,
    interval: plan.interval,
    features: plan.features,
    limits: plan.limits,
    // Don't expose stripePriceId
  }));

  return NextResponse.json({
    plans: publicPricing,
    currency: "USD",
    billingCycle: "monthly",
    // API info
    checkoutEndpoint: "/api/checkout",
    embedEndpoint: "/embed/{tokenAddress}",
    documentationUrl: "/api/docs",
  });
}
