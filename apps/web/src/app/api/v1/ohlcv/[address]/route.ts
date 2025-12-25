import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { fetchInternalApi } from "@/lib/config";

const LICENSE_SECRET = process.env.LICENSE_SECRET;

// Rate limit: 5000 CU per month for BUSINESS tier
const MONTHLY_CU_LIMIT = 5000;

// CU costs per request type
const CU_COSTS = {
  ohlcv: 10, // 10 CU per OHLCV request (so ~500 requests/month)
};

// Valid timeframes to prevent injection
const VALID_TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

// Solana address validation (base58, 32-44 chars)
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Verify license key format (plx_{encrypted}_{hmac})
function verifyLicenseKey(licenseKey: string): boolean {
  if (!LICENSE_SECRET) {
    console.error("LICENSE_SECRET not configured");
    return false;
  }

  if (!licenseKey.startsWith("plx_")) return false;

  const parts = licenseKey.split("_");
  if (parts.length !== 3) return false;

  const encrypted = parts[1];
  const providedHmac = parts[2];

  // Validate parts are alphanumeric to prevent injection
  if (!/^[a-zA-Z0-9]+$/.test(encrypted) || !/^[a-fA-F0-9]+$/.test(providedHmac)) {
    return false;
  }

  const expectedHmac = crypto.createHmac("sha256", LICENSE_SECRET)
    .update(encrypted)
    .digest("hex")
    .substring(0, 8);

  if (providedHmac.length !== expectedHmac.length) return false;
  return crypto.timingSafeEqual(Buffer.from(providedHmac), Buffer.from(expectedHmac));
}

// Verify old format (sub_{id}_{hmac})
function verifyOldFormat(licenseKey: string): string | null {
  if (!LICENSE_SECRET) {
    console.error("LICENSE_SECRET not configured");
    return null;
  }

  if (!licenseKey.startsWith("sub_")) return null;

  const parts = licenseKey.split("_");
  if (parts.length !== 3) return null;

  const subscriptionId = parts[1];
  const providedHmac = parts[2];

  // Validate subscriptionId is alphanumeric (cuid format)
  if (!/^[a-zA-Z0-9]+$/.test(subscriptionId) || !/^[a-fA-F0-9]+$/.test(providedHmac)) {
    return null;
  }

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

// GET /api/v1/ohlcv/[address] - Authenticated OHLCV API for BUSINESS tier
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    // Check LICENSE_SECRET is configured
    if (!LICENSE_SECRET) {
      console.error("LICENSE_SECRET environment variable not set");
      return NextResponse.json(
        { error: "Service configuration error" },
        { status: 500 }
      );
    }

    const { address } = await params;

    // Validate token address format (prevent path traversal/injection)
    if (!address || !SOLANA_ADDRESS_REGEX.test(address)) {
      return NextResponse.json(
        { error: "Invalid token address format" },
        { status: 400 }
      );
    }

    // Get license key from header or query (prefer header for security)
    const licenseKey = req.headers.get("x-api-key") ||
                       req.headers.get("authorization")?.replace("Bearer ", "") ||
                       req.nextUrl.searchParams.get("apiKey");

    if (!licenseKey) {
      return NextResponse.json(
        {
          error: "API key required",
          message: "Provide your license key via x-api-key header or apiKey query param",
          docs: "/docs#api"
        },
        { status: 401 }
      );
    }

    // Limit license key length to prevent DoS
    if (licenseKey.length > 200) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      );
    }

    // Lookup subscription by license key
    let subscription;

    const oldFormatId = verifyOldFormat(licenseKey);
    if (oldFormatId) {
      subscription = await prisma.subscription.findUnique({
        where: { id: oldFormatId },
      });
    } else if (verifyLicenseKey(licenseKey)) {
      subscription = await prisma.subscription.findFirst({
        where: { licenseKey },
      });
    }

    if (!subscription) {
      // Generic error to prevent enumeration attacks
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      );
    }

    // Check if BUSINESS tier
    if (subscription.plan !== "BUSINESS") {
      return NextResponse.json(
        {
          error: "API access requires Business plan",
          currentPlan: subscription.plan,
          upgradeUrl: "/solutions#pricing"
        },
        { status: 403 }
      );
    }

    // Check if subscription is active
    if (subscription.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Subscription is not active" },
        { status: 403 }
      );
    }

    // Check rate limit (using embedViews field for API usage tracking)
    const now = new Date();
    const resetAt = subscription.embedViewsResetAt;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Reset if new month (compare timestamps properly)
    let currentUsage = subscription.embedViews;
    if (resetAt.getTime() < monthStart.getTime()) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          embedViews: 0,
          embedViewsResetAt: now,
        },
      });
      currentUsage = 0;
    }

    const requestCost = CU_COSTS.ohlcv;

    // Check if over limit BEFORE making the request
    if (currentUsage + requestCost > MONTHLY_CU_LIMIT) {
      const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return NextResponse.json(
        {
          error: "Rate limit exceeded",
          usage: currentUsage,
          limit: MONTHLY_CU_LIMIT,
          resetsAt: nextReset.toISOString(),
        },
        { status: 429, headers: {
          "Retry-After": Math.ceil((nextReset.getTime() - now.getTime()) / 1000).toString(),
        }}
      );
    }

    // Parse and validate query params
    const timeframeParam = req.nextUrl.searchParams.get("timeframe") || "1h";
    const timeframe = VALID_TIMEFRAMES.has(timeframeParam) ? timeframeParam : "1h";

    const limitParam = parseInt(req.nextUrl.searchParams.get("limit") || "100", 10);
    const limit = Number.isNaN(limitParam) ? 100 : Math.max(1, Math.min(limitParam, 1000));

    const fromParam = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");

    // Validate from/to are numeric timestamps if provided
    const from = fromParam && /^\d+$/.test(fromParam) ? fromParam : null;
    const to = toParam && /^\d+$/.test(toParam) ? toParam : null;

    // Build query string with validated params
    const queryParams = new URLSearchParams({
      timeframe,
      limit: limit.toString(),
    });
    if (from) queryParams.set("from", from);
    if (to) queryParams.set("to", to);

    // Fetch from internal API with authentication
    const response = await fetchInternalApi(
      `/api/tokens/${encodeURIComponent(address)}/ohlcv?${queryParams.toString()}`,
      { signal: AbortSignal.timeout(30000) }
    );

    if (!response.ok) {
      // Don't expose internal error details to client
      console.error("Internal API error:", await response.text());
      return NextResponse.json(
        { error: "Failed to fetch OHLCV data" },
        { status: response.status >= 500 ? 502 : response.status }
      );
    }

    const data = await response.json();

    // Increment usage counter AFTER successful request
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        embedViews: { increment: requestCost },
      },
    });

    // Return data with usage info headers
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const res = NextResponse.json(data);
    res.headers.set("X-RateLimit-Limit", MONTHLY_CU_LIMIT.toString());
    res.headers.set("X-RateLimit-Remaining", Math.max(0, MONTHLY_CU_LIMIT - currentUsage - requestCost).toString());
    res.headers.set("X-RateLimit-Reset", nextReset.toISOString());
    res.headers.set("X-Request-Cost", requestCost.toString());
    // Cache for 10 seconds to reduce load
    res.headers.set("Cache-Control", "private, max-age=10");

    return res;

  } catch (error) {
    // Don't expose internal error details
    console.error("OHLCV API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
