import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const LICENSE_SECRET = process.env.LICENSE_SECRET;

// Always allowed domains (your own domains) - EXACT MATCH ONLY
const ALWAYS_ALLOWED = new Set([
  "localhost",
  "127.0.0.1",
  "polyx.xyz",
  "www.polyx.xyz",
  "polyx.vercel.app",
]);

// Rate limiting for license validation (in-memory, use Redis in production)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute for embed validation

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

// SECURITY: Check if domain is EXACTLY in allowed list (no partial matches)
function isAllowedDomain(domain: string): boolean {
  return ALWAYS_ALLOWED.has(domain.toLowerCase());
}

// Generate a license key for a domain using HMAC
function generateLicenseKey(email: string, domain: string, plan: string): string {
  const secret = LICENSE_SECRET || "dev-secret-not-for-production";
  const data = `${email}:${domain}:${plan}`;
  return crypto.createHmac("sha256", secret).update(data).digest("hex").substring(0, 32);
}

// Verify a license key
function verifyLicenseKey(key: string, email: string, domain: string, plan: string): boolean {
  const expectedKey = generateLicenseKey(email, domain, plan);
  if (key.length !== expectedKey.length) return false;
  return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expectedKey));
}

// POST /api/embed/license - Validate embed request (called by embed iframe)
// This endpoint is public - it validates license keys for embedded charts
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

    // SECURITY: Only allow EXACT domain matches for our domains
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
        valid: true,
        plan: "FREE",
        domain: checkDomain || "unknown",
        features: {
          watermark: true,
          whiteLabel: false,
        },
        message: "No license key - using free tier with watermark",
      });
    }

    // Validate license key format: {email}:{key}
    const parts = licenseKey.split(":");
    if (parts.length < 2) {
      return NextResponse.json({
        valid: false,
        error: "Invalid license key format",
      }, { status: 400 });
    }

    const email = parts[0];
    const key = parts.slice(1).join(":"); // Handle emails with colons

    // Look up subscription in database
    const subscription = await prisma.subscription.findUnique({
      where: { email },
      include: { domains: true },
    });

    if (!subscription || subscription.status !== "ACTIVE" || subscription.plan === "FREE") {
      return NextResponse.json({
        valid: true,
        plan: "FREE",
        domain: checkDomain,
        features: { watermark: true, whiteLabel: false },
        message: "No active subscription - using free tier",
      });
    }

    const plan = subscription.plan;

    // Verify the license key matches
    const isValidKey = verifyLicenseKey(key, email, checkDomain || "*", plan);
    const isWildcardValid = !isValidKey && verifyLicenseKey(key, email, "*", plan);

    if (!isValidKey && !isWildcardValid) {
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

    // Check if domain is registered (if not wildcard)
    if (checkDomain && subscription.domains.length > 0) {
      const isRegistered = subscription.domains.some(d =>
        d.domain === checkDomain || d.domain === "*"
      );
      if (!isRegistered && !isWildcardValid) {
        return NextResponse.json({
          valid: false,
          error: "Domain not registered for this license",
          plan: "FREE",
          features: { watermark: true, whiteLabel: false },
        }, { status: 403 });
      }
    }

    // Track embed view
    await prisma.subscription.update({
      where: { email },
      data: { embedViews: { increment: 1 } },
    });

    return NextResponse.json({
      valid: true,
      plan,
      domain: checkDomain,
      features: {
        watermark: plan === "FREE",
        whiteLabel: plan === "BUSINESS",
        customThemes: plan !== "FREE",
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

// GET /api/embed/license - Generate license key for authenticated user
// Requires authentication - uses session to get user's subscription
export async function GET(req: NextRequest) {
  try {
    // Get authenticated session
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Authentication required. Please sign in." },
        { status: 401 }
      );
    }

    const email = session.user.email;
    const domain = req.nextUrl.searchParams.get("domain");

    // Get subscription from database
    const subscription = await prisma.subscription.findUnique({
      where: { email },
    });

    // If no subscription or free tier, they can't generate license keys
    if (!subscription || subscription.plan === "FREE") {
      return NextResponse.json({
        error: "Active Pro or Business subscription required to generate license keys",
        plan: "FREE",
        upgradeUrl: "/solutions#pricing",
      }, { status: 403 });
    }

    if (subscription.status !== "ACTIVE") {
      return NextResponse.json({
        error: "Your subscription is not active. Please update your payment method.",
        status: subscription.status,
      }, { status: 403 });
    }

    const plan = subscription.plan;
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
