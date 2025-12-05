import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// SECURITY: Require webhook secret in production
if (!STRIPE_WEBHOOK_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("STRIPE_WEBHOOK_SECRET environment variable is required in production");
}

// Initialize Stripe
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-11-20.acacia",
}) : null;

// This webhook handles Stripe events for subscription management
// Events handled:
// - checkout.session.completed: New subscription created
// - customer.subscription.updated: Plan changed or renewed
// - customer.subscription.deleted: Subscription canceled
// - invoice.payment_failed: Payment failed

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    // If Stripe not configured, just log and acknowledge
    if (!stripe) {
      console.log("Stripe webhook received but Stripe not configured");
      return NextResponse.json({ received: true });
    }

    let event: Stripe.Event;

    // SECURITY: Always verify webhook signature when secret is configured
    if (STRIPE_WEBHOOK_SECRET) {
      if (!signature) {
        return NextResponse.json(
          { error: "Missing stripe-signature header" },
          { status: 400 }
        );
      }
      try {
        event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        console.error("Webhook signature verification failed:", err);
        return NextResponse.json(
          { error: "Webhook signature verification failed" },
          { status: 400 }
        );
      }
    } else if (process.env.NODE_ENV === "development") {
      // Parse without verification (development only when no secret configured)
      console.warn("DEV MODE: Webhook received without signature verification");
      try {
        event = JSON.parse(body) as Stripe.Event;
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON payload" },
          { status: 400 }
        );
      }
    } else {
      // SECURITY: Fail closed in production without webhook secret
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 500 }
      );
    }

    // Handle the event
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("Checkout completed:", session.id);

        // Extract customer info
        const email = session.customer_email || session.metadata?.email;
        const plan = session.metadata?.plan || "PRO";
        const stripeCustomerId = session.customer as string;
        const stripeSubscriptionId = session.subscription as string;

        console.log(`New subscription: ${email} - Plan: ${plan}`);
        console.log(`Customer ID: ${stripeCustomerId}`);
        console.log(`Subscription ID: ${stripeSubscriptionId}`);

        // TODO: Create/update subscription in database when DB is connected
        // await prisma.subscription.upsert({
        //   where: { email },
        //   create: {
        //     email,
        //     plan,
        //     status: "ACTIVE",
        //     stripeCustomerId,
        //     stripeSubscriptionId,
        //   },
        //   update: {
        //     plan,
        //     status: "ACTIVE",
        //     stripeCustomerId,
        //     stripeSubscriptionId,
        //   },
        // });

        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("Subscription updated:", subscription.id);

        const status = subscription.status === "active" ? "ACTIVE" :
                       subscription.status === "past_due" ? "PAST_DUE" :
                       subscription.status === "canceled" ? "CANCELED" : "EXPIRED";

        console.log(`Subscription ${subscription.id} status: ${status}`);

        // TODO: Update subscription status in database
        // await prisma.subscription.update({
        //   where: { stripeSubscriptionId: subscription.id },
        //   data: { status },
        // });

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("Subscription canceled:", subscription.id);

        // TODO: Mark subscription as canceled in database
        // await prisma.subscription.update({
        //   where: { stripeSubscriptionId: subscription.id },
        //   data: {
        //     status: "CANCELED",
        //     plan: "FREE",
        //   },
        // });

        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("Payment failed for invoice:", invoice.id);

        // TODO: Update subscription status and notify customer
        // await prisma.subscription.update({
        //   where: { stripeCustomerId: invoice.customer as string },
        //   data: { status: "PAST_DUE" },
        // });

        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("Payment succeeded for invoice:", invoice.id);
        // Subscription renewals are handled here
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}
