import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const LICENSE_SECRET = process.env.LICENSE_SECRET || "dev-secret";

// Always allowed domains (your own domains)
const ALWAYS_ALLOWED = new Set([
  "localhost",
  "127.0.0.1",
  "polyx.xyz",
  "www.polyx.xyz",
  "polyx.vercel.app",
]);

// Rate limiting (in-memory)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 60;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (!record || record.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (record.count >= RATE_LIMIT_MAX) return false;
  record.count++;
  return true;
}

// Generate a license key from subscription ID
// Format: sub_{subscriptionId}_{hmac} - NO EMAIL exposed
function generateLicenseKey(subscriptionId: string): string {
  const hmac = crypto.createHmac("sha256", LICENSE_SECRET)
    .update(subscriptionId)
    .digest("hex")
    .substring(0, 16);
  return `sub_${subscriptionId}_${hmac}`;
}

// Verify license key and extract subscription ID
function verifyAndExtractSubscriptionId(licenseKey: string): string | null {
  if (!licenseKey.startsWith("sub_")) return null;

  const parts = licenseKey.split("_");
  if (parts.length !== 3) return null;

  const subscriptionId = parts[1];
  const providedHmac = parts[2];

  const expectedHmac = crypto.createHmac("sha256", LICENSE_SECRET)
    .update(subscriptionId)
    .digest("hex")
    .substring(0, 16);

  if (providedHmac.length !== expectedHmac.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(providedHmac), Buffer.from(expectedHmac))) {
    return null;
  }

  return subscriptionId;
}

// POST /api/embed/license - Validate embed request (called by embed iframe)
export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ valid: false, error: "Rate limit exceeded" }, { status: 429 });
    }

    const body = await req.json();
    const { licenseKey } = body;

    // Get domain from referer/origin
    let domain = "";
    const referer = req.headers.get("referer");
    const origin = req.headers.get("origin");
    if (referer) {
      try { domain = new URL(referer).hostname; } catch {}
    } else if (origin) {
      try { domain = new URL(origin).hostname; } catch {}
    }

    // Always allow our own domains
    if (domain && ALWAYS_ALLOWED.has(domain.toLowerCase())) {
      return NextResponse.json({
        valid: true,
        plan: "BUSINESS",
        features: { watermark: false, whiteLabel: true },
      });
    }

    // No license key = free tier with watermark
    if (!licenseKey) {
      return NextResponse.json({
        valid: true,
        plan: "FREE",
        features: { watermark: true, whiteLabel: false },
      });
    }

    // Verify the license key
    const subscriptionId = verifyAndExtractSubscriptionId(licenseKey);
    if (!subscriptionId) {
      return NextResponse.json({
        valid: false,
        error: "Invalid license key",
        plan: "FREE",
        features: { watermark: true, whiteLabel: false },
      }, { status: 403 });
    }

    // Look up subscription by ID
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { domains: true },
    });

    if (!subscription || subscription.status !== "ACTIVE") {
      return NextResponse.json({
        valid: false,
        error: "Subscription not active",
        plan: "FREE",
        features: { watermark: true, whiteLabel: false },
      }, { status: 403 });
    }

    // Check domain restrictions (if any domains are registered)
    if (domain && subscription.domains.length > 0) {
      const isAllowed = subscription.domains.some(d => {
        if (d.domain === "*") return true;
        if (d.domain === domain) return true;
        // Support wildcard subdomains like *.example.com
        if (d.domain.startsWith("*.") && domain.endsWith(d.domain.slice(1))) return true;
        return false;
      });

      if (!isAllowed) {
        return NextResponse.json({
          valid: false,
          error: `Domain "${domain}" not registered for this license`,
          plan: "FREE",
          features: { watermark: true, whiteLabel: false },
        }, { status: 403 });
      }
    }

    // Track embed view
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { embedViews: { increment: 1 } },
    });

    return NextResponse.json({
      valid: true,
      plan: subscription.plan,
      features: {
        watermark: false,
        whiteLabel: subscription.plan === "BUSINESS",
      },
    });

  } catch (error) {
    console.error("License validation error:", error);
    return NextResponse.json({ valid: false, error: "Validation failed" }, { status: 500 });
  }
}

// GET /api/embed/license - Generate license key for authenticated user
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Get subscription by user ID (not email - works for Phantom users too)
    const subscription = await prisma.subscription.findFirst({
      where: { userId: session.user.id },
      include: { domains: true },
    });

    if (!subscription || subscription.plan === "FREE") {
      return NextResponse.json({
        error: "Pro or Business subscription required",
        plan: "FREE",
        upgradeUrl: "/solutions#pricing",
      }, { status: 403 });
    }

    if (subscription.status !== "ACTIVE") {
      return NextResponse.json({
        error: "Subscription not active",
        status: subscription.status,
      }, { status: 403 });
    }

    // Generate license key based on subscription ID (not email)
    const licenseKey = generateLicenseKey(subscription.id);

    return NextResponse.json({
      licenseKey,
      plan: subscription.plan,
      domains: subscription.domains.map(d => d.domain),
      usage: {
        embedViews: subscription.embedViews,
        limit: subscription.plan === "BUSINESS" ? -1 : 50000,
      },
    });

  } catch (error) {
    console.error("License generation error:", error);
    return NextResponse.json({ error: "Failed to generate license" }, { status: 500 });
  }
}
