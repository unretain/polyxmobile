import { NextRequest, NextResponse } from "next/server";

// This will be replaced with Prisma when DB is available
// For now, we'll use a simple in-memory check + always allow localhost

interface DomainLicense {
  domain: string;
  plan: "FREE" | "PRO" | "BUSINESS";
  status: "ACTIVE" | "EXPIRED";
  showWatermark: boolean;
  maxViewsPerMonth: number;
}

// SECURITY: Use Set for exact match (prevents evil-polyx.xyz bypass)
const ALWAYS_ALLOWED = new Set([
  "localhost",
  "127.0.0.1",
  "polyx.xyz",
  "www.polyx.xyz",
  "polyx.vercel.app",
]);

// CORS headers for embed endpoints
function getCorsHeaders(origin: string | null) {
  // Allow any origin for embeds, but track it
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// Check if domain is exactly allowed
function isAllowedDomain(domain: string): boolean {
  return ALWAYS_ALLOWED.has(domain.toLowerCase());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { domain, referer } = body;

    // Extract domain from referer if not provided directly
    let checkDomain = domain;
    if (!checkDomain && referer) {
      try {
        const url = new URL(referer);
        checkDomain = url.hostname;
      } catch {
        checkDomain = referer;
      }
    }

    // If no domain provided, check the request origin
    if (!checkDomain) {
      const origin = req.headers.get("origin");
      const refererHeader = req.headers.get("referer");

      if (origin) {
        try {
          checkDomain = new URL(origin).hostname;
        } catch {
          checkDomain = origin;
        }
      } else if (refererHeader) {
        try {
          checkDomain = new URL(refererHeader).hostname;
        } catch {
          checkDomain = refererHeader;
        }
      }
    }

    // Default response for unknown domains (free tier with watermark)
    const defaultResponse: DomainLicense = {
      domain: checkDomain || "unknown",
      plan: "FREE",
      status: "ACTIVE",
      showWatermark: true,
      maxViewsPerMonth: 1000,
    };

    const origin = req.headers.get("origin");

    // SECURITY: Only allow EXACT domain matches (prevents evil-polyx.xyz bypass)
    if (checkDomain && isAllowedDomain(checkDomain)) {
      return NextResponse.json({
        ...defaultResponse,
        plan: "BUSINESS",
        showWatermark: false,
        maxViewsPerMonth: 500000,
      }, { headers: getCorsHeaders(origin) });
    }

    // TODO: When database is connected, query the Subscription and Domain tables
    // const subscription = await prisma.domain.findFirst({
    //   where: { domain: checkDomain, subscription: { status: "ACTIVE" } },
    //   include: { subscription: true }
    // });
    //
    // if (subscription) {
    //   return NextResponse.json({
    //     domain: checkDomain,
    //     plan: subscription.subscription.plan,
    //     status: subscription.subscription.status,
    //     showWatermark: subscription.subscription.plan === "FREE",
    //     maxViewsPerMonth: getMaxViews(subscription.subscription.plan),
    //   });
    // }

    // Return free tier for unlicensed domains
    return NextResponse.json(defaultResponse, { headers: getCorsHeaders(origin) });

  } catch (error) {
    console.error("Domain validation error:", error);
    const origin = req.headers.get("origin");
    return NextResponse.json(
      { error: "Validation failed", showWatermark: true },
      { status: 500, headers: getCorsHeaders(origin) }
    );
  }
}

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function GET(req: NextRequest) {
  // Simple health check
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");

  return NextResponse.json({
    status: "ok",
    origin,
    referer,
    message: "Use POST to validate domain licensing",
  }, { headers: getCorsHeaders(origin) });
}
