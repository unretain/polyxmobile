import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import crypto from "crypto";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const LICENSE_SECRET = process.env.LICENSE_SECRET;

// Note: LICENSE_SECRET should be set in production environment variables
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
}) : null;

// Always allowed domains (your own domains) - EXACT MATCH ONLY
const ALWAYS_ALLOWED = new Set([
  "localhost",
  "127.0.0.1",
  "polyx.xyz",
  "www.polyx.xyz",
  "polyx.vercel.app",
]);

// Rate limiting for license generation (in-memory, use Redis in production)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || record.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count++;
  return true;
}

// Validate email format
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

// Validate domain format
function isValidDomain(domain: string): boolean {
  if (domain === "*") return true;
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-_.]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;
  return domainRegex.test(domain) && domain.length <= 253;
}

// SECURITY: Check if domain is EXACTLY in allowed list (no partial matches)
function isAllowedDomain(domain: string): boolean {
  return ALWAYS_ALLOWED.has(domain.toLowerCase());
}

// Generate a license key for a domain using HMAC for better security
function generateLicenseKey(email: string, domain: string, plan: string): string {
  const secret = LICENSE_SECRET || "dev-secret-not-for-production";
  const data = `${email}:${domain}:${plan}`;
  return crypto.createHmac("sha256", secret).update(data).digest("hex").substring(0, 32);
}

// Verify a license key
function verifyLicenseKey(key: string, email: string, domain: string, plan: string): boolean {
  const expectedKey = generateLicenseKey(email, domain, plan);
  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expectedKey));
}

// POST /api/embed/license - Validate embed request
// Called by the embed page to check if domain is authorized
export async function POST(req: NextRequest) {
  try {
    // Rate limiting
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ||
               req.headers.get("x-real-ip") ||
               "unknown";
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { valid: false, error: "Rate limit exceeded. Try again later." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { licenseKey, domain } = body;

    // Get domain from referer if not provided
    let checkDomain = domain;
    if (!checkDomain) {
      const referer = req.headers.get("referer");
      const origin = req.headers.get("origin");

      if (referer) {
        try { checkDomain = new URL(referer).hostname; } catch {}
      } else if (origin) {
        try { checkDomain = new URL(origin).hostname; } catch {}
      }
    }

    // SECURITY: Only allow EXACT domain matches (prevents evil-polyx.xyz bypass)
    if (checkDomain && isAllowedDomain(checkDomain)) {
      return NextResponse.json({
        valid: true,
        plan: "BUSINESS",
        domain: checkDomain,
        features: {
          watermark: false,
          whiteLabel: true,
        },
      });
    }

    // If no license key provided, return free tier (with watermark)
    if (!licenseKey) {
      return NextResponse.json({
        valid: true, // Still allow, but with watermark
        plan: "FREE",
        domain: checkDomain || "unknown",
        features: {
          watermark: true,
          whiteLabel: false,
        },
        message: "No license key - using free tier with watermark",
      });
    }

    // Validate license key against Stripe subscriptions
    // License key format: {email}:{key}
    const [email, key] = licenseKey.split(":");

    if (!email || !key) {
      return NextResponse.json({
        valid: false,
        error: "Invalid license key format",
      }, { status: 400 });
    }

    if (!stripe) {
      return NextResponse.json({
        valid: false,
        error: "Payment service not configured",
      }, { status: 500 });
    }

    // Find customer and check subscription
    const customers = await stripe.customers.list({ email, limit: 1 });

    if (customers.data.length === 0) {
      return NextResponse.json({
        valid: true,
        plan: "FREE",
        domain: checkDomain,
        features: { watermark: true, whiteLabel: false },
        message: "No subscription found - using free tier",
      });
    }

    const customer = customers.data[0];
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: "active",
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      return NextResponse.json({
        valid: true,
        plan: "FREE",
        domain: checkDomain,
        features: { watermark: true, whiteLabel: false },
        message: "No active subscription - using free tier",
      });
    }

    const subscription = subscriptions.data[0];
    const plan = subscription.metadata?.plan || "PRO";

    // Verify the license key matches
    const isValidKey = verifyLicenseKey(key, email, checkDomain || "*", plan);

    if (!isValidKey) {
      // SECURITY: Reject invalid license keys - don't just log a warning
      // Check if they have a wildcard license as fallback
      const isWildcardValid = verifyLicenseKey(key, email, "*", plan);

      if (!isWildcardValid) {
        return NextResponse.json({
          valid: false,
          error: "Invalid license key for this domain",
          plan: "FREE",
          features: {
            watermark: true,
            whiteLabel: false,
          },
        }, { status: 403 });
      }
    }

    return NextResponse.json({
      valid: true,
      plan,
      domain: checkDomain,
      features: {
        watermark: plan === "FREE",
        whiteLabel: plan === "BUSINESS",
        customThemes: plan !== "FREE",
      },
      subscription: {
        status: subscription.status,
        currentPeriodEnd: (subscription as any).current_period_end
          ? new Date((subscription as any).current_period_end * 1000).toISOString()
          : null,
      },
    });

  } catch (error) {
    console.error("License validation error:", error);
    return NextResponse.json(
      { valid: false, error: "Validation failed" },
      { status: 500 }
    );
  }
}

// GET /api/embed/license?email=xxx - Generate license key for subscriber
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  const domain = req.nextUrl.searchParams.get("domain");

  if (!email) {
    return NextResponse.json(
      { error: "Email is required" },
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
    // Verify the user has an active subscription
    const customers = await stripe.customers.list({ email, limit: 1 });

    if (customers.data.length === 0) {
      return NextResponse.json(
        { error: "No subscription found for this email" },
        { status: 404 }
      );
    }

    const customer = customers.data[0];
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: "active",
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      return NextResponse.json(
        { error: "No active subscription found" },
        { status: 404 }
      );
    }

    const subscription = subscriptions.data[0];
    const plan = subscription.metadata?.plan || "PRO";

    // Generate license key for this domain (or wildcard)
    const targetDomain = domain || "*";
    const key = generateLicenseKey(email, targetDomain, plan);
    const licenseKey = `${email}:${key}`;

    return NextResponse.json({
      licenseKey,
      email,
      domain: targetDomain,
      plan,
      usage: `Add ?license=${encodeURIComponent(licenseKey)} to your embed URL`,
      example: `<iframe src="https://polyx.xyz/embed/TOKEN_ADDRESS?license=${encodeURIComponent(licenseKey)}"></iframe>`,
    });

  } catch (error) {
    console.error("License generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate license" },
      { status: 500 }
    );
  }
}
