import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const LICENSE_SECRET = process.env.LICENSE_SECRET || "dev-secret";

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
  const oldFormatId = verifyOldFormat(licenseKey);
  if (oldFormatId) return oldFormatId;

  if (verifyNewFormat(licenseKey)) {
    const subscription = await prisma.subscription.findFirst({
      where: { licenseKey },
    });
    return subscription?.id || null;
  }

  return null;
}

// POST /api/embed/track - Track embed view for analytics (no limits)
// Embeds are always allowed - we serve cached data so no marginal cost
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { licenseKey, domain, tokenAddress } = body;

    // Determine plan from license (for watermark logic in embed)
    let plan: "FREE" | "PRO" | "BUSINESS" = "FREE";

    if (licenseKey) {
      const subscriptionId = await lookupSubscriptionByLicenseKey(licenseKey);

      if (subscriptionId) {
        const subscription = await prisma.subscription.findUnique({
          where: { id: subscriptionId },
        });

        if (subscription && subscription.status === "ACTIVE") {
          plan = subscription.plan;
        }
      }
    }

    // Track in EmbedView table for analytics only (no limits enforced)
    prisma.embedView.create({
      data: {
        domain: domain || "unknown",
        tokenAddress: tokenAddress || "unknown",
      },
    }).catch(() => {}); // Fire and forget

    // Always allow - just return plan info for watermark logic
    return NextResponse.json({
      allowed: true,
      plan,
      // PRO and BUSINESS get no watermark
      showWatermark: plan === "FREE",
    });

  } catch (error) {
    console.error("View tracking error:", error);
    // Allow on error
    return NextResponse.json({
      allowed: true,
      plan: "FREE",
      showWatermark: true,
    });
  }
}

// GET /api/embed/track - Get subscription info
export async function GET(req: NextRequest) {
  const licenseKey = req.nextUrl.searchParams.get("licenseKey");

  if (!licenseKey) {
    return NextResponse.json({
      plan: "FREE",
      showWatermark: true,
    });
  }

  const subscriptionId = await lookupSubscriptionByLicenseKey(licenseKey);
  if (!subscriptionId) {
    return NextResponse.json({
      plan: "FREE",
      showWatermark: true,
      error: "Invalid license key",
    });
  }

  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
  });

  if (!subscription) {
    return NextResponse.json({
      plan: "FREE",
      showWatermark: true,
      error: "Subscription not found",
    });
  }

  const plan = subscription.status === "ACTIVE" ? subscription.plan : "FREE";

  return NextResponse.json({
    subscriptionId,
    plan,
    showWatermark: plan === "FREE",
  });
}
