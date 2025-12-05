import Stripe from "stripe";

// Lazy initialization to avoid build-time errors when env var is not set
let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }
    _stripe = new Stripe(key, {
      apiVersion: "2025-11-17.clover",
      typescript: true,
    });
  }
  return _stripe;
}

// Export getter for lazy access
export const stripe = new Proxy({} as Stripe, {
  get(_, prop) {
    return (getStripe() as any)[prop];
  },
});

// Product and Price IDs - these will be set after creating products in Stripe
// You can either create them manually in dashboard or use the setup script
export const STRIPE_PRODUCTS = {
  PRO: {
    name: "Polyx Pro",
    description: "3 domains, 50,000 views/month, no watermark",
    priceId: process.env.STRIPE_PRICE_PRO || "",
    price: 2900, // $29.00 in cents
  },
  BUSINESS: {
    name: "Polyx Business",
    description: "Unlimited domains and views, white-label option",
    priceId: process.env.STRIPE_PRICE_BUSINESS || "",
    price: 9900, // $99.00 in cents
  },
};

// Create a checkout session for subscription
export async function createCheckoutSession({
  email,
  plan,
  successUrl,
  cancelUrl,
}: {
  email: string;
  plan: "PRO" | "BUSINESS";
  successUrl: string;
  cancelUrl: string;
}) {
  const product = STRIPE_PRODUCTS[plan];

  if (!product.priceId) {
    throw new Error(`Price ID not configured for ${plan} plan`);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: email,
    line_items: [
      {
        price: product.priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      plan,
      email,
    },
    subscription_data: {
      metadata: {
        plan,
        email,
      },
    },
  });

  return session;
}

// Create a billing portal session for managing subscriptions
export async function createBillingPortalSession({
  customerId,
  returnUrl,
}: {
  customerId: string;
  returnUrl: string;
}) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session;
}

// Verify webhook signature
export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
  webhookSecret: string
) {
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}
