import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Plan limits configuration
const PLAN_LIMITS = {
  FREE: {
    domains: 1,
    viewsPerMonth: 1000,
    watermark: true,
    whiteLabel: false,
  },
  PRO: {
    domains: 3,
    viewsPerMonth: 50000,
    watermark: false,
    whiteLabel: false,
  },
  BUSINESS: {
    domains: -1, // unlimited
    viewsPerMonth: -1, // unlimited
    watermark: false,
    whiteLabel: true,
  },
};

// GET /api/subscription/status
// Returns the current user's subscription status from database
// Works with both email and Phantom wallet users
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required. Please sign in." },
        { status: 401 }
      );
    }

    // Get subscription by user ID (works for Phantom users too)
    const subscription = await prisma.subscription.findFirst({
      where: { userId: session.user.id },
      include: { domains: true },
    });

    // If no subscription record, return free tier
    if (!subscription) {
      return NextResponse.json({
        plan: "FREE",
        status: "ACTIVE",
        hasSubscription: false,
        features: PLAN_LIMITS.FREE,
        domains: [],
        usage: {
          embedViews: 0,
          limit: PLAN_LIMITS.FREE.viewsPerMonth,
          remaining: PLAN_LIMITS.FREE.viewsPerMonth,
          resetAt: getNextMonthReset(),
        },
      });
    }

    const plan = subscription.plan;
    const features = PLAN_LIMITS[plan];
    const viewsLimit = features.viewsPerMonth;
    const viewsUsed = subscription.embedViews;
    const viewsRemaining = viewsLimit === -1 ? -1 : Math.max(0, viewsLimit - viewsUsed);

    return NextResponse.json({
      plan,
      status: subscription.status,
      hasSubscription: plan !== "FREE",
      subscriptionId: subscription.stripeSubscriptionId,
      features,
      domains: subscription.domains.map(d => ({
        domain: d.domain,
        isVerified: d.isVerified,
      })),
      usage: {
        embedViews: viewsUsed,
        limit: viewsLimit,
        remaining: viewsRemaining,
        resetAt: subscription.embedViewsResetAt?.toISOString() || getNextMonthReset(),
      },
    });

  } catch (error) {
    console.error("Subscription status error:", error);
    return NextResponse.json(
      { error: "Failed to check subscription status" },
      { status: 500 }
    );
  }
}

// Helper to get next month reset date
function getNextMonthReset(): string {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth.toISOString();
}
