/**
 * Run this script to create Stripe products and prices
 * Usage: npx tsx scripts/setup-stripe.ts
 */

import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY not set in environment");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-11-20.acacia",
});

async function setupStripeProducts() {
  console.log("🚀 Setting up Stripe products and prices...\n");

  try {
    // Create Pro Product
    console.log("Creating Pro product...");
    const proProduct = await stripe.products.create({
      name: "Polyx Pro",
      description: "3D Chart Embed API - Pro Plan",
      metadata: {
        plan: "PRO",
        domains: "3",
        views: "50000",
        watermark: "false",
      },
    });
    console.log(`✅ Pro product created: ${proProduct.id}`);

    // Create Pro Price (recurring monthly)
    const proPrice = await stripe.prices.create({
      product: proProduct.id,
      unit_amount: 2900, // $29.00
      currency: "usd",
      recurring: {
        interval: "month",
      },
      metadata: {
        plan: "PRO",
      },
    });
    console.log(`✅ Pro price created: ${proPrice.id}`);

    // Create Business Product
    console.log("\nCreating Business product...");
    const businessProduct = await stripe.products.create({
      name: "Polyx Business",
      description: "3D Chart Embed API - Business Plan",
      metadata: {
        plan: "BUSINESS",
        domains: "unlimited",
        views: "unlimited",
        watermark: "false",
        whitelabel: "true",
      },
    });
    console.log(`✅ Business product created: ${businessProduct.id}`);

    // Create Business Price (recurring monthly)
    const businessPrice = await stripe.prices.create({
      product: businessProduct.id,
      unit_amount: 9900, // $99.00
      currency: "usd",
      recurring: {
        interval: "month",
      },
      metadata: {
        plan: "BUSINESS",
      },
    });
    console.log(`✅ Business price created: ${businessPrice.id}`);

    // Output the price IDs to add to .env
    console.log("\n" + "=".repeat(60));
    console.log("📋 Add these to your .env.local file:\n");
    console.log(`STRIPE_PRICE_PRO=${proPrice.id}`);
    console.log(`STRIPE_PRICE_BUSINESS=${businessPrice.id}`);
    console.log("=".repeat(60));

    console.log("\n✨ Stripe setup complete!");
    console.log("\n📌 Next steps:");
    console.log("1. Add the price IDs above to your .env.local file");
    console.log("2. Set up a webhook in Stripe Dashboard pointing to:");
    console.log("   https://your-domain.com/api/webhooks/stripe");
    console.log("3. Add the webhook secret to STRIPE_WEBHOOK_SECRET");

  } catch (error) {
    console.error("❌ Error setting up Stripe:", error);
    process.exit(1);
  }
}

setupStripeProducts();
