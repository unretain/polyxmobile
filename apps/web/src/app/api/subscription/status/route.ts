import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-11-20.acacia",
}) : null;

// GET /api/subscription/status?email=user@example.com
// Check subscription status for a given email
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");

  if (!email) {
    return NextResponse.json(
      { error: "Email parameter is required" },
      { status: 400 }
    );
  }

  if (!stripe) {
    return NextResponse.json(
      { error: "Payment service not configured" },
      { status: 500 }
    );
  }

  try {
    // Find customer by email
    const customers = await stripe.customers.list({
      email: email,
      limit: 1,
    });

    if (customers.data.length === 0) {
      // No customer found - return free tier
      return NextResponse.json({
        email,
        plan: "FREE",
        status: "active",
        hasSubscription: false,
        features: {
          domains: 1,
          viewsPerMonth: 1000,
          watermark: true,
        },
      });
    }

    const customer = customers.data[0];

    // Get active subscriptions for this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: "active",
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      // Customer exists but no active subscription
      return NextResponse.json({
        email,
        plan: "FREE",
        status: "active",
        hasSubscription: false,
        customerId: customer.id,
        features: {
          domains: 1,
          viewsPerMonth: 1000,
          watermark: true,
        },
      });
    }

    const subscription = subscriptions.data[0];
    const plan = subscription.metadata?.plan || "PRO";

    // Determine features based on plan
    const features = plan === "BUSINESS" ? {
      domains: -1,
      viewsPerMonth: -1,
      watermark: false,
      whiteLabel: true,
    } : {
      domains: 3,
      viewsPerMonth: 50000,
      watermark: false,
      whiteLabel: false,
    };

    return NextResponse.json({
      email,
      plan,
      status: subscription.status,
      hasSubscription: true,
      customerId: customer.id,
      subscriptionId: subscription.id,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      features,
    });

  } catch (error) {
    console.error("Subscription status error:", error);
    return NextResponse.json(
      { error: "Failed to check subscription status" },
      { status: 500 }
    );
  }
}
