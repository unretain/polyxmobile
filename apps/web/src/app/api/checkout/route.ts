import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Price IDs from Stripe
const PRICE_IDS: Record<string, string | undefined> = {
  PRO: process.env.STRIPE_PRICE_PRO,
  BUSINESS: process.env.STRIPE_PRICE_BUSINESS,
};

// Initialize Stripe
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
}) : null;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { plan, email, successUrl, cancelUrl } = body;

    if (!plan || !email) {
      return NextResponse.json(
        { error: "Plan and email are required" },
        { status: 400 }
      );
    }

    if (plan === "FREE") {
      return NextResponse.json(
        { error: "Free plan does not require checkout" },
        { status: 400 }
      );
    }

    const priceId = PRICE_IDS[plan];
    if (!priceId) {
      return NextResponse.json(
        { error: `Price not configured for ${plan} plan` },
        { status: 400 }
      );
    }

    // Check if Stripe is configured
    if (!stripe) {
      return NextResponse.json(
        { error: "Stripe not configured. Set STRIPE_SECRET_KEY in environment." },
        { status: 500 }
      );
    }

    // Check if user has an existing subscription (for upgrades)
    const existingSubscription = await prisma.subscription.findUnique({
      where: { email },
    });

    // If user has an active subscription with Stripe, upgrade it instead of creating new checkout
    if (existingSubscription?.stripeSubscriptionId && existingSubscription.status === "ACTIVE") {
      try {
        // Get the current subscription from Stripe
        const stripeSubscription = await stripe.subscriptions.retrieve(existingSubscription.stripeSubscriptionId);

        if (stripeSubscription.status === "active") {
          // Upgrade the subscription by changing the price
          await stripe.subscriptions.update(existingSubscription.stripeSubscriptionId, {
            items: [{
              id: stripeSubscription.items.data[0].id,
              price: priceId,
            }],
            proration_behavior: "create_prorations",
            metadata: {
              plan,
              email,
            },
          });

          // Update our database
          await prisma.subscription.update({
            where: { email },
            data: { plan: plan as "PRO" | "BUSINESS" },
          });

          return NextResponse.json({
            upgraded: true,
            message: `Successfully upgraded to ${plan}!`,
            redirectUrl: "/dashboard/license",
          });
        }
      } catch (err) {
        console.error("Upgrade error:", err);
        // Fall through to create new checkout session
      }
    }

    // Create Stripe checkout session for new subscriptions
    // Use subscription mode for recurring payments (Pro/Business plans)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl || `${APP_URL}/solutions?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${APP_URL}/solutions?canceled=true`,
      metadata: {
        plan,
        email,
      },
      allow_promotion_codes: true,
    });

    return NextResponse.json({
      checkoutUrl: session.url,
      sessionId: session.id,
    });

  } catch (error: unknown) {
    console.error("Checkout error:", error);
    const message = error instanceof Error ? error.message : "Failed to create checkout session";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

// GET - Verify a checkout session
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json(
      { error: "Session ID required" },
      { status: 400 }
    );
  }

  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 500 }
    );
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "customer"],
    });

    return NextResponse.json({
      status: session.status,
      customerEmail: session.customer_email,
      plan: session.metadata?.plan,
      subscriptionId: typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id,
    });
  } catch (error: unknown) {
    console.error("Session retrieval error:", error);
    const message = error instanceof Error ? error.message : "Failed to retrieve session";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
