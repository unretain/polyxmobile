import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Plan domain limits
const DOMAIN_LIMITS = {
  FREE: 1,
  PRO: 3,
  BUSINESS: -1, // unlimited
};

// POST /api/subscription/domains - Add a domain
export async function POST(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { domain } = body;

    if (!domain || typeof domain !== "string") {
      return NextResponse.json(
        { error: "Domain is required" },
        { status: 400 }
      );
    }

    // SECURITY: Block bare wildcard "*" - it would allow any domain
    if (domain === "*") {
      return NextResponse.json(
        { error: "Bare wildcard '*' is not allowed. Use '*.example.com' for subdomains." },
        { status: 400 }
      );
    }

    // Validate domain format (allow *.example.com or example.com)
    const domainRegex = /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
    if (!domainRegex.test(domain)) {
      return NextResponse.json(
        { error: "Invalid domain format" },
        { status: 400 }
      );
    }

    // Get subscription by user ID (works for Phantom users too)
    const subscription = await prisma.subscription.findFirst({
      where: { userId: session.user.id },
      include: { domains: true },
    });

    if (!subscription || subscription.plan === "FREE") {
      return NextResponse.json(
        { error: "Pro or Business subscription required to add domains" },
        { status: 403 }
      );
    }

    // Check domain limit
    const limit = DOMAIN_LIMITS[subscription.plan];
    if (limit !== -1 && subscription.domains.length >= limit) {
      return NextResponse.json(
        { error: `You can only add ${limit} domains on the ${subscription.plan} plan` },
        { status: 403 }
      );
    }

    // Check if domain already exists
    const existing = subscription.domains.find(d => d.domain === domain);
    if (existing) {
      return NextResponse.json(
        { error: "Domain already registered" },
        { status: 400 }
      );
    }

    // Add domain
    const newDomain = await prisma.domain.create({
      data: {
        domain,
        subscriptionId: subscription.id,
        isVerified: false,
      },
    });

    return NextResponse.json({
      success: true,
      domain: {
        domain: newDomain.domain,
        isVerified: newDomain.isVerified,
      },
    });

  } catch (error) {
    console.error("Add domain error:", error);
    return NextResponse.json(
      { error: "Failed to add domain" },
      { status: 500 }
    );
  }
}

// DELETE /api/subscription/domains - Remove a domain
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const domain = req.nextUrl.searchParams.get("domain");

    if (!domain) {
      return NextResponse.json(
        { error: "Domain parameter required" },
        { status: 400 }
      );
    }

    // Get subscription by user ID
    const subscription = await prisma.subscription.findFirst({
      where: { userId: session.user.id },
      include: { domains: true },
    });

    if (!subscription) {
      return NextResponse.json(
        { error: "No subscription found" },
        { status: 404 }
      );
    }

    // Find and delete the domain
    const domainRecord = subscription.domains.find(d => d.domain === domain);
    if (!domainRecord) {
      return NextResponse.json(
        { error: "Domain not found" },
        { status: 404 }
      );
    }

    await prisma.domain.delete({
      where: { id: domainRecord.id },
    });

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("Delete domain error:", error);
    return NextResponse.json(
      { error: "Failed to delete domain" },
      { status: 500 }
    );
  }
}
