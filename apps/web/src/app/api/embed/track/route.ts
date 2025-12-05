import { NextRequest, NextResponse } from "next/server";

// In-memory view tracking (in production, use Redis or database)
// This is a simple rate limiter that resets daily
const viewCounts = new Map<string, { count: number; resetAt: number }>();

// Plan limits (monthly views)
const PLAN_LIMITS = {
  FREE: 1000,
  PRO: 50000,
  BUSINESS: 500000, // 500k views/month - not unlimited since we pay for API usage
};

// Get the current day key (resets at midnight UTC)
function getDayKey(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

// POST /api/embed/track - Track an embed view and check rate limits
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { licenseKey, domain, tokenAddress } = body;

    // Determine plan from license
    let plan: "FREE" | "PRO" | "BUSINESS" = "FREE";
    let email = "anonymous";

    if (licenseKey) {
      // Extract email from license key (format: email:hash)
      const parts = licenseKey.split(":");
      if (parts.length >= 2) {
        email = parts[0];

        // Validate license by checking subscription status
        try {
          const response = await fetch(`${req.nextUrl.origin}/api/subscription/status?email=${encodeURIComponent(email)}`);
          if (response.ok) {
            const data = await response.json();
            if (data.hasSubscription) {
              plan = data.plan;
            }
          }
        } catch (err) {
          console.error("Failed to validate license:", err);
        }
      }
    }

    // Check rate limit
    const limit = PLAN_LIMITS[plan];
    const dayKey = getDayKey();
    const trackingKey = `${email}:${domain || "unknown"}`;

    let viewData = viewCounts.get(trackingKey);

    // Reset if new day
    if (!viewData || viewData.resetAt !== dayKey) {
      viewData = { count: 0, resetAt: dayKey };
    }

    // Check if over limit (skip for unlimited plans)
    if (limit !== -1 && viewData.count >= limit) {
      return NextResponse.json({
        allowed: false,
        reason: "rate_limit_exceeded",
        plan,
        limit,
        used: viewData.count,
        resetAt: new Date(dayKey + 24 * 60 * 60 * 1000).toISOString(),
        upgradeUrl: "/solutions#pricing",
      }, { status: 429 });
    }

    // Increment view count
    viewData.count++;
    viewCounts.set(trackingKey, viewData);

    return NextResponse.json({
      allowed: true,
      plan,
      limit: limit === -1 ? "unlimited" : limit,
      used: viewData.count,
      remaining: limit === -1 ? "unlimited" : Math.max(0, limit - viewData.count),
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
  const email = req.nextUrl.searchParams.get("email");
  const domain = req.nextUrl.searchParams.get("domain");

  if (!email) {
    return NextResponse.json(
      { error: "Email parameter required" },
      { status: 400 }
    );
  }

  // Get plan from subscription status
  let plan: "FREE" | "PRO" | "BUSINESS" = "FREE";

  try {
    const response = await fetch(`${req.nextUrl.origin}/api/subscription/status?email=${encodeURIComponent(email)}`);
    if (response.ok) {
      const data = await response.json();
      if (data.hasSubscription) {
        plan = data.plan;
      }
    }
  } catch (err) {
    console.error("Failed to get subscription status:", err);
  }

  const limit = PLAN_LIMITS[plan];
  const dayKey = getDayKey();
  const trackingKey = `${email}:${domain || "unknown"}`;

  const viewData = viewCounts.get(trackingKey);
  const count = viewData?.resetAt === dayKey ? viewData.count : 0;

  return NextResponse.json({
    email,
    domain: domain || "all",
    plan,
    limit: limit === -1 ? "unlimited" : limit,
    used: count,
    remaining: limit === -1 ? "unlimited" : Math.max(0, limit - count),
    resetAt: new Date(dayKey + 24 * 60 * 60 * 1000).toISOString(),
  });
}
