import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const LICENSE_SECRET = process.env.LICENSE_SECRET || "dev-secret";

// Plan limits (monthly views)
const PLAN_LIMITS = {
  FREE: 1000,
  PRO: 50000,
  BUSINESS: 500000, // 500k views/month - not unlimited since we pay for API usage
};

// Check if embedViews should be reset (monthly reset)
function shouldResetViews(resetAt: Date | null): boolean {
  if (!resetAt) return true;
  return new Date() >= resetAt;
}

// Get next month reset date
function getNextMonthReset(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

// Verify old license key format (sub_{id}_{hmac}) and extract subscription ID
function verifyOldFormat(licenseKey: string): string | null {
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

// Verify new license key format (plx_{encrypted}_{hmac})
function verifyNewFormat(licenseKey: string): boolean {
  if (!licenseKey.startsWith("plx_")) return false;

  const parts = licenseKey.split("_");
  if (parts.length !== 3) return false;

  const encrypted = parts[1];
  const providedHmac = parts[2];

  const expectedHmac = crypto.createHmac("sha256", LICENSE_SECRET)
    .update(encrypted)
    .digest("hex")
    .substring(0, 8);

  if (providedHmac.length !== expectedHmac.length) return false;
  return crypto.timingSafeEqual(Buffer.from(providedHmac), Buffer.from(expectedHmac));
}

// Lookup subscription by license key
async function lookupSubscriptionByLicenseKey(licenseKey: string): Promise<string | null> {
  // First check old format (direct subscription ID)
  const oldFormatId = verifyOldFormat(licenseKey);
  if (oldFormatId) return oldFormatId;

  // For new format, verify HMAC and lookup by stored license key
  if (verifyNewFormat(licenseKey)) {
    const subscription = await prisma.subscription.findFirst({
      where: { licenseKey },
    });
    return subscription?.id || null;
  }

  return null;
}

// POST /api/embed/track - Track an embed view and check rate limits
// Uses database for persistent tracking (not in-memory)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { licenseKey, domain, tokenAddress } = body;

    // Determine plan from license
    let plan: "FREE" | "PRO" | "BUSINESS" = "FREE";
    let subscription = null;

    if (licenseKey) {
      // Verify and lookup subscription by license key
      const subscriptionId = await lookupSubscriptionByLicenseKey(licenseKey);

      if (subscriptionId) {
        // Get subscription from database
        subscription = await prisma.subscription.findUnique({
          where: { id: subscriptionId },
        });

        if (subscription && subscription.status === "ACTIVE") {
          plan = subscription.plan;
        }
      }
    }

    const limit = PLAN_LIMITS[plan];

    // For FREE tier (no subscription), use simple tracking without persistence
    if (!subscription) {
      // Track in EmbedView table for analytics
      await prisma.embedView.create({
        data: {
          domain: domain || "unknown",
          tokenAddress: tokenAddress || "unknown",
        },
      });

      return NextResponse.json({
        allowed: true,
        plan: "FREE",
        limit,
        used: 0,
        remaining: limit,
        message: "Free tier - upgrade for higher limits",
      });
    }

    // Check if we need to reset monthly views
    if (shouldResetViews(subscription.embedViewsResetAt)) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          embedViews: 0,
          embedViewsResetAt: getNextMonthReset(),
        },
      });
      subscription.embedViews = 0;
    }

    // Check if over limit
    if (subscription.embedViews >= limit) {
      return NextResponse.json({
        allowed: false,
        reason: "rate_limit_exceeded",
        plan,
        limit,
        used: subscription.embedViews,
        resetAt: subscription.embedViewsResetAt?.toISOString() || getNextMonthReset().toISOString(),
        upgradeUrl: "/solutions#pricing",
      }, { status: 429 });
    }

    // Increment view count in database (persistent)
    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        embedViews: { increment: 1 },
      },
    });

    // Also track in EmbedView table for analytics
    await prisma.embedView.create({
      data: {
        domain: domain || "unknown",
        tokenAddress: tokenAddress || "unknown",
      },
    });

    return NextResponse.json({
      allowed: true,
      plan,
      limit,
      used: updated.embedViews,
      remaining: Math.max(0, limit - updated.embedViews),
      resetAt: subscription.embedViewsResetAt?.toISOString() || getNextMonthReset().toISOString(),
    });

  } catch (error) {
    console.error("View tracking error:", error);
    // Allow on error to prevent blocking embeds
    return NextResponse.json({
      allowed: true,
      error: "tracking_failed",
    });
  }
}

// GET /api/embed/track - Get current usage stats
export async function GET(req: NextRequest) {
  const licenseKey = req.nextUrl.searchParams.get("licenseKey");

  if (!licenseKey) {
    return NextResponse.json(
      { error: "License key parameter required" },
      { status: 400 }
    );
  }

  // Verify license key
  const subscriptionId = await lookupSubscriptionByLicenseKey(licenseKey);
  if (!subscriptionId) {
    return NextResponse.json(
      { error: "Invalid license key" },
      { status: 403 }
    );
  }

  // Get subscription from database
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
  });

  if (!subscription) {
    return NextResponse.json(
      { error: "Subscription not found" },
      { status: 404 }
    );
  }

  const plan = subscription.status === "ACTIVE" ? subscription.plan : "FREE";
  const limit = PLAN_LIMITS[plan];

  // Check if views should be reset
  let used = subscription.embedViews;
  if (shouldResetViews(subscription.embedViewsResetAt)) {
    used = 0; // Will be reset on next POST
  }

  return NextResponse.json({
    subscriptionId,
    plan,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetAt: subscription.embedViewsResetAt?.toISOString() || getNextMonthReset().toISOString(),
  });
}
