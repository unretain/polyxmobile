import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Plan features configuration
// Embeds are unlimited for all tiers (we serve cached data, no marginal cost)
const PLAN_FEATURES = {
  FREE: {
    watermark: true,
    whiteLabel: false,
    apiAccess: false,
  },
  PRO: {
    watermark: false,
    whiteLabel: false,
    apiAccess: false,
  },
  BUSINESS: {
    watermark: false,
    whiteLabel: true,
    apiAccess: true,
    apiRateLimit: 5000, // 5000 CU per month
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
        features: PLAN_FEATURES.FREE,
        domains: [],
      });
    }

    const plan = subscription.plan;
    const features = PLAN_FEATURES[plan];

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
      // API usage tracking for BUSINESS tier
      // Note: Using embedViews field for API usage tracking until schema is updated
      ...(plan === "BUSINESS" && {
        apiUsage: {
          used: subscription.embedViews || 0,
          limit: 5000,
          remaining: Math.max(0, 5000 - (subscription.embedViews || 0)),
          resetAt: subscription.embedViewsResetAt?.toISOString() || getNextMonthReset(),
        },
      }),
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
