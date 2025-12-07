import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// SECURITY: Use Set for exact match (prevents evil-polyx.xyz bypass)
const ALWAYS_ALLOWED = new Set([
  "localhost",
  "127.0.0.1",
  "polyx.xyz",
  "www.polyx.xyz",
  "polyx.vercel.app",
]);

// Plan view limits
const PLAN_LIMITS = {
  FREE: 1000,
  PRO: 50000,
  BUSINESS: 500000,
};

// CORS headers for embed endpoints
function getCorsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// Extract domain from request
function extractDomain(req: NextRequest, body?: { domain?: string; referer?: string }): string | null {
  // Try body first
  if (body?.domain) {
    return body.domain.toLowerCase();
  }

  // Try referer from body
  if (body?.referer) {
    try {
      return new URL(body.referer).hostname.toLowerCase();
    } catch {}
  }

  // Try origin header
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).hostname.toLowerCase();
    } catch {}
  }

  // Try referer header
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).hostname.toLowerCase();
    } catch {}
  }

  return null;
}

// Check if domain matches a pattern (supports *.example.com)
function domainMatches(registeredDomain: string, checkDomain: string): boolean {
  // Exact match
  if (registeredDomain === checkDomain) return true;

  // Wildcard subdomain match (*.example.com matches sub.example.com)
  if (registeredDomain.startsWith("*.")) {
    const baseDomain = registeredDomain.slice(1); // ".example.com"
    return checkDomain.endsWith(baseDomain) && checkDomain !== baseDomain.slice(1);
  }

  return false;
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");

  try {
    const body = await req.json();
    const domain = extractDomain(req, body);

    // Default response for unknown/free tier
    const freeResponse = {
      domain: domain || "unknown",
      plan: "FREE" as const,
      status: "ACTIVE" as const,
      showWatermark: true,
      maxViewsPerMonth: PLAN_LIMITS.FREE,
    };

    // Always allow our own domains with full access
    if (domain && ALWAYS_ALLOWED.has(domain)) {
      return NextResponse.json({
        domain,
        plan: "BUSINESS",
        status: "ACTIVE",
        showWatermark: false,
        maxViewsPerMonth: PLAN_LIMITS.BUSINESS,
      }, { headers: getCorsHeaders(origin) });
    }

    // If no domain detected, return free tier
    if (!domain) {
      return NextResponse.json(freeResponse, { headers: getCorsHeaders(origin) });
    }

    // Query database for domain registration
    // Find any subscription that has this domain registered
    const domainRecord = await prisma.domain.findFirst({
      where: {
        OR: [
          { domain: domain },
          { domain: `*.${domain.split(".").slice(-2).join(".")}` }, // Check for wildcard parent
        ],
        subscription: {
          status: "ACTIVE",
        },
      },
      include: {
        subscription: true,
      },
    });

    if (domainRecord) {
      // Check if the domain actually matches (for wildcard patterns)
      if (domainMatches(domainRecord.domain, domain)) {
        const plan = domainRecord.subscription.plan;
        return NextResponse.json({
          domain,
          plan,
          status: domainRecord.subscription.status,
          showWatermark: plan === "FREE",
          maxViewsPerMonth: PLAN_LIMITS[plan],
        }, { headers: getCorsHeaders(origin) });
      }
    }

    // No license found - return free tier
    return NextResponse.json(freeResponse, { headers: getCorsHeaders(origin) });

  } catch (error) {
    console.error("Domain validation error:", error);
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
  const origin = req.headers.get("origin");
  const domain = extractDomain(req);

  // Quick check for own domains
  if (domain && ALWAYS_ALLOWED.has(domain)) {
    return NextResponse.json({
      status: "ok",
      domain,
      plan: "BUSINESS",
      showWatermark: false,
    }, { headers: getCorsHeaders(origin) });
  }

  return NextResponse.json({
    status: "ok",
    domain: domain || "unknown",
    message: "Use POST with licenseKey for full validation",
  }, { headers: getCorsHeaders(origin) });
}
