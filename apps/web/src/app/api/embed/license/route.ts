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
// Format: plx_{encryptedSubId}_{hmac} - subscription ID is NOT exposed
// Uses AES-256-CBC to encrypt the subscription ID
function generateLicenseKey(subscriptionId: string): string {
  // Create a deterministic IV from the subscription ID (so same ID = same key)
  const ivSeed = crypto.createHash("sha256").update(subscriptionId + LICENSE_SECRET).digest();
  const iv = ivSeed.subarray(0, 16);

  // Derive encryption key from secret
  const key = crypto.createHash("sha256").update(LICENSE_SECRET).digest();

  // Encrypt subscription ID
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(subscriptionId, "utf8", "hex");
  encrypted += cipher.final("hex");

  // Create HMAC for integrity
  const hmac = crypto.createHmac("sha256", LICENSE_SECRET)
    .update(encrypted)
    .digest("hex")
    .substring(0, 8);

  return `plx_${encrypted}_${hmac}`;
}

// Verify license key and extract subscription ID
function verifyAndExtractSubscriptionId(licenseKey: string): string | null {
  // Support both old (sub_) and new (plx_) formats during migration
  if (licenseKey.startsWith("sub_")) {
    return verifyOldFormat(licenseKey);
  }

  if (!licenseKey.startsWith("plx_")) return null;

  const parts = licenseKey.split("_");
  if (parts.length !== 3) return null;

  const encrypted = parts[1];
  const providedHmac = parts[2];

  // Verify HMAC
  const expectedHmac = crypto.createHmac("sha256", LICENSE_SECRET)
    .update(encrypted)
    .digest("hex")
    .substring(0, 8);

  if (providedHmac.length !== expectedHmac.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(providedHmac), Buffer.from(expectedHmac))) {
    return null;
  }

  try {
    // Decrypt subscription ID - we need to try decryption with derived IV
    const key = crypto.createHash("sha256").update(LICENSE_SECRET).digest();

    // We need to find the correct IV - try each subscription in DB would be slow
    // Instead, use a lookup table approach: store encrypted -> subscriptionId mapping
    // For now, iterate through subscriptions (not ideal but works for small scale)
    return null; // Will be resolved via database lookup below
  } catch {
    return null;
  }
}

// Legacy format support (sub_{id}_{hmac})
function verifyOldFormat(licenseKey: string): string | null {
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

// Lookup subscription by license key (for new encrypted format)
async function lookupSubscriptionByLicenseKey(licenseKey: string): Promise<string | null> {
  // First check old format
  const oldFormatId = verifyOldFormat(licenseKey);
  if (oldFormatId) return oldFormatId;

  if (!licenseKey.startsWith("plx_")) return null;

  // For new format, we store the license key in the subscription record
  const subscription = await prisma.subscription.findFirst({
    where: { licenseKey },
  });

  return subscription?.id || null;
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

    // Verify the license key and look up subscription
    const subscriptionId = await lookupSubscriptionByLicenseKey(licenseKey);
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
        // SECURITY: Never allow bare wildcard "*" - only *.example.com patterns
        if (d.domain === "*") return false;
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

    // Store the license key in the subscription for lookup
    // This allows us to validate keys without exposing the subscription ID
    if (subscription.licenseKey !== licenseKey) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { licenseKey },
      });
    }

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
