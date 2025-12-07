/**
 * Configuration validation - runs at startup
 * Ensures all required environment variables are set in production
 */

const isProduction = process.env.NODE_ENV === "production";

// Required secrets in production
const REQUIRED_SECRETS = [
  "AUTH_SECRET",
  "DATABASE_URL",
] as const;

// Required for payment processing
const PAYMENT_SECRETS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_BUSINESS",
] as const;

// Required for email functionality
const EMAIL_SECRETS = [
  "RESEND_API_KEY",
] as const;

// Required for license system
const LICENSE_SECRETS = [
  "LICENSE_SECRET",
] as const;

// Required for trading functionality
const TRADING_SECRETS = [
  "MORALIS_API_KEY",
  "SOLANA_RPC_URL",
] as const;

// Validate configuration
export function validateConfig(): void {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required secrets
  for (const secret of REQUIRED_SECRETS) {
    if (!process.env[secret]) {
      missing.push(secret);
    }
  }

  // Check payment secrets
  for (const secret of PAYMENT_SECRETS) {
    if (!process.env[secret]) {
      if (isProduction) {
        missing.push(secret);
      } else {
        warnings.push(`${secret} not set - Stripe payments disabled`);
      }
    }
  }

  // Check email secrets
  for (const secret of EMAIL_SECRETS) {
    if (!process.env[secret]) {
      if (isProduction) {
        warnings.push(`${secret} not set - email functionality disabled`);
      }
    }
  }

  // Check license secrets
  for (const secret of LICENSE_SECRETS) {
    if (!process.env[secret]) {
      if (isProduction) {
        missing.push(secret);
      } else {
        warnings.push(`${secret} not set - using dev fallback`);
      }
    }
  }

  // Check trading secrets
  for (const secret of TRADING_SECRETS) {
    if (!process.env[secret]) {
      warnings.push(`${secret} not set - trading functionality disabled`);
    }
  }

  // Also accept NEXTAUTH_SECRET as fallback for AUTH_SECRET
  if (missing.includes("AUTH_SECRET") && process.env.NEXTAUTH_SECRET) {
    missing.splice(missing.indexOf("AUTH_SECRET"), 1);
  }

  // Log warnings
  for (const warning of warnings) {
    console.warn(`⚠️  Config warning: ${warning}`);
  }

  // Fail on missing required secrets in production
  if (missing.length > 0 && isProduction) {
    console.error("❌ Missing required environment variables:");
    for (const secret of missing) {
      console.error(`   - ${secret}`);
    }
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

// Export config values with type safety
export const config = {
  isProduction,

  // Auth
  authSecret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "",

  // Database
  databaseUrl: process.env.DATABASE_URL || "",

  // Stripe
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  stripePricePro: process.env.STRIPE_PRICE_PRO || "",
  stripePriceBusiness: process.env.STRIPE_PRICE_BUSINESS || "",
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "",

  // Email
  resendApiKey: process.env.RESEND_API_KEY || "",
  resendFromEmail: process.env.RESEND_FROM_EMAIL || "Polyx <noreply@polyx.xyz>",

  // License
  licenseSecret: process.env.LICENSE_SECRET || "dev-secret",

  // URLs
  appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  apiUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",

  // Trading / Solana
  moralisApiKey: process.env.MORALIS_API_KEY || "",
  solanaRpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",

  // Features
  isStripeEnabled: !!process.env.STRIPE_SECRET_KEY,
  isEmailEnabled: !!process.env.RESEND_API_KEY,
  isTradingEnabled: !!process.env.MORALIS_API_KEY && !!process.env.SOLANA_RPC_URL,
} as const;
