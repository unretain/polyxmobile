import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Initialize Stripe lazily
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
}) : null;

// Map Stripe plan metadata to our enum
function mapPlan(plan: string | undefined): SubscriptionPlan {
  if (plan === "BUSINESS") return "BUSINESS";
  if (plan === "PRO") return "PRO";
  return "FREE";
}

// Map Stripe subscription status to our enum
function mapStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case "active": return "ACTIVE";
    case "past_due": return "PAST_DUE";
    case "canceled": return "CANCELED";
    default: return "EXPIRED";
  }
}

// This webhook handles Stripe events for payment/subscription management
// Events handled:
// - checkout.session.completed: Payment completed (one-time or subscription)
// - customer.subscription.updated: Subscription plan changed or renewed
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

    // SECURITY: Always require webhook secret and signature verification
    // Never skip verification, even in development
    if (!STRIPE_WEBHOOK_SECRET) {
      console.error("STRIPE_WEBHOOK_SECRET not configured");
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 500 }
      );
    }

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

    // Handle the event
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("Checkout completed:", session.id);
        console.log("Payment mode:", session.mode);

        // Extract customer info
        // For wallet users, Stripe collects real email during checkout (customer_email)
        // walletEmail contains the original wallet identifier for reference
        const email = session.customer_email || session.metadata?.walletEmail || session.metadata?.email;
        const walletEmail = session.metadata?.walletEmail;
        const plan = session.metadata?.plan || "PRO";
        const stripeCustomerId = session.customer as string;
        // For one-time payments, there's no subscription ID
        const stripeSubscriptionId = session.subscription as string | null;

        if (!email) {
          console.error("No email found in checkout session");
          break;
        }

        console.log(`New ${session.mode === "payment" ? "purchase" : "subscription"}: ${email} - Plan: ${plan}${walletEmail ? ` (wallet: ${walletEmail})` : ''}`);

        // Use transaction with serializable isolation to prevent race conditions
        await prisma.$transaction(async (tx) => {
          // Find user by email (if they have an account)
          // For wallet users, also try to find by their wallet-generated email
          let user = await tx.user.findUnique({
            where: { email },
          });

          // If not found and we have a wallet email, try that
          if (!user && walletEmail && walletEmail !== email) {
            user = await tx.user.findUnique({
              where: { email: walletEmail },
            });
          }

          // Check if subscription already exists (by real email or wallet email)
          let existing = await tx.subscription.findUnique({
            where: { email },
          });

          // Also check by wallet email if different
          if (!existing && walletEmail && walletEmail !== email) {
            existing = await tx.subscription.findUnique({
              where: { email: walletEmail },
            });
          }

          if (existing) {
            // Update existing subscription
            await tx.subscription.update({
              where: { email: existing.email },
              data: {
                plan: mapPlan(plan),
                status: "ACTIVE",
                stripeCustomerId,
                // Only update stripeSubscriptionId if we have one (don't overwrite with null)
                ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
                userId: user?.id,
              },
            });
          } else {
            // Create new subscription
            await tx.subscription.create({
              data: {
                email,
                plan: mapPlan(plan),
                status: "ACTIVE",
                stripeCustomerId,
                stripeSubscriptionId: stripeSubscriptionId || null,
                userId: user?.id,
              },
            });
          }
        }, {
          isolationLevel: "Serializable",
        });

        console.log(`Plan activated for ${email}`);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("Subscription updated:", subscription.id);

        const status = mapStatus(subscription.status);
        const plan = mapPlan(subscription.metadata?.plan);

        // Update subscription status in database
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: { status, plan },
        });

        console.log(`Subscription ${subscription.id} updated: ${status}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("Subscription canceled:", subscription.id);

        // Mark subscription as canceled and downgrade to free
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            status: "CANCELED",
            plan: "FREE",
          },
        });

        console.log(`Subscription ${subscription.id} canceled`);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("Payment failed for invoice:", invoice.id);

        // Update subscription status to past due
        await prisma.subscription.updateMany({
          where: { stripeCustomerId: invoice.customer as string },
          data: { status: "PAST_DUE" },
        });

        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("Payment succeeded for invoice:", invoice.id);
        // Subscription renewals are handled here
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        console.log("Charge refunded:", charge.id);

        // If full refund, downgrade to free
        if (charge.refunded && charge.amount_refunded === charge.amount) {
          const customerId = charge.customer as string;
          if (customerId) {
            await prisma.subscription.updateMany({
              where: { stripeCustomerId: customerId },
              data: {
                status: "CANCELED",
                plan: "FREE",
              },
            });
            console.log(`Full refund processed - subscription downgraded for customer ${customerId}`);
          }
        }
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        console.log("Chargeback/dispute created:", dispute.id);

        // Immediately suspend access on chargeback
        const chargeId = dispute.charge as string;
        if (chargeId) {
          const charge = await stripe.charges.retrieve(chargeId);
          const customerId = charge.customer as string;
          if (customerId) {
            await prisma.subscription.updateMany({
              where: { stripeCustomerId: customerId },
              data: {
                status: "CANCELED",
                plan: "FREE",
              },
            });
            console.log(`Chargeback received - subscription suspended for customer ${customerId}`);
          }
        }
        break;
      }

      case "customer.subscription.trial_will_end": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("Trial ending soon:", subscription.id);
        // Could send email notification here
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
