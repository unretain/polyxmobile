import { NextRequest, NextResponse } from "next/server";

// Pricing tiers
const PRICING = {
  FREE: {
    name: "Free",
    price: 0,
    maxDomains: 1,
    maxViews: 1000,
    features: ["1 domain", "1,000 views/month", "Watermark required", "Basic support"],
  },
  PRO: {
    name: "Pro",
    price: 29,
    priceId: "price_pro_monthly", // Stripe price ID - update after Stripe setup
    maxDomains: 3,
    maxViews: 50000,
    features: ["3 domains", "50,000 views/month", "No watermark", "Priority support", "Custom themes"],
  },
  BUSINESS: {
    name: "Business",
    price: 99,
    priceId: "price_business_monthly", // Stripe price ID - update after Stripe setup
    maxDomains: -1, // unlimited
    maxViews: -1, // unlimited
    features: ["Unlimited domains", "Unlimited views", "No watermark", "White-label option", "Dedicated support", "Custom integrations"],
  },
};

// GET /api/subscriptions - Get pricing info
export async function GET() {
  return NextResponse.json({
    plans: PRICING,
    currency: "USD",
    billingCycle: "monthly",
  });
}

// POST /api/subscriptions - Create/manage subscription
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, email, plan, domain } = body;

    switch (action) {
      case "check": {
        // Check subscription status for an email
        // TODO: Query database when connected
        // const subscription = await prisma.subscription.findUnique({
        //   where: { email },
        //   include: { domains: true },
        // });

        return NextResponse.json({
          exists: false,
          plan: "FREE",
          domains: [],
          message: "Database not connected - using free tier",
        });
      }

      case "create": {
        // Create a new subscription (after Stripe payment)
        if (!email || !plan) {
          return NextResponse.json(
            { error: "Email and plan are required" },
            { status: 400 }
          );
        }

        // TODO: Create subscription in database
        // const subscription = await prisma.subscription.create({
        //   data: {
        //     email,
        //     plan,
        //     status: "ACTIVE",
        //   },
        // });

        return NextResponse.json({
          success: true,
          message: "Subscription created (mock - database not connected)",
          subscription: { email, plan, status: "ACTIVE" },
        });
      }

      case "add-domain": {
        // Add a domain to the subscription
        if (!email || !domain) {
          return NextResponse.json(
            { error: "Email and domain are required" },
            { status: 400 }
          );
        }

        // TODO: Add domain to database
        // const domainRecord = await prisma.domain.create({
        //   data: {
        //     domain,
        //     subscription: { connect: { email } },
        //   },
        // });

        return NextResponse.json({
          success: true,
          message: "Domain added (mock - database not connected)",
          domain: { domain, verified: false },
        });
      }

      case "remove-domain": {
        // Remove a domain from the subscription
        if (!email || !domain) {
          return NextResponse.json(
            { error: "Email and domain are required" },
            { status: 400 }
          );
        }

        // TODO: Remove domain from database

        return NextResponse.json({
          success: true,
          message: "Domain removed (mock - database not connected)",
        });
      }

      default:
        return NextResponse.json(
          { error: "Invalid action. Use: check, create, add-domain, remove-domain" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Subscription API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
