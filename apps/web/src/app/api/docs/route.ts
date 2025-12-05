import { NextResponse } from "next/server";

// API Documentation endpoint
export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://polyx.xyz";

  const documentation = {
    name: "Polyx 3D Chart Embed API",
    version: "1.0.0",
    description: "Embed beautiful 3D Solana token charts on your website",
    baseUrl,

    // Quick Start
    quickStart: {
      title: "Quick Start",
      steps: [
        "1. Subscribe to a plan at /solutions#pricing",
        "2. Get your license key from /api/embed/license?email=YOUR_EMAIL",
        "3. Add the embed code to your website",
      ],
      freeUsage: "Free tier available with watermark - no license key needed",
    },

    // Embed Methods
    embedding: {
      iframe: {
        title: "iFrame Embed (Simplest)",
        description: "Just paste this HTML into your page",
        code: `<iframe
  src="${baseUrl}/embed/TOKEN_ADDRESS?license=YOUR_LICENSE_KEY"
  width="100%"
  height="500"
  frameborder="0"
  style="border-radius: 8px;"
></iframe>`,
        parameters: {
          TOKEN_ADDRESS: "Solana token mint address",
          license: "Your license key (optional for free tier)",
          theme: "dark or light (default: dark)",
          timeframe: "1m, 5m, 15m, 1h, 4h, 1d (default: 1h)",
          header: "true or false - show token info header (default: true)",
        },
      },
      javascript: {
        title: "JavaScript SDK (Advanced)",
        description: "More control over the chart",
        code: `<div id="polyx-chart"></div>
<script src="${baseUrl}/embed.js"></script>
<script>
  PolyxChart.render({
    container: '#polyx-chart',
    token: 'TOKEN_ADDRESS',
    license: 'YOUR_LICENSE_KEY',
    theme: 'dark',
    timeframe: '1h',
    width: '100%',
    height: 500
  });
</script>`,
      },
    },

    // API Endpoints
    endpoints: [
      {
        method: "GET",
        path: "/api/pricing",
        description: "Get available subscription plans and pricing",
        authentication: "None required",
        response: {
          plans: "Array of plan objects with features and limits",
          currency: "USD",
          billingCycle: "monthly",
        },
      },
      {
        method: "POST",
        path: "/api/checkout",
        description: "Create a Stripe checkout session for subscription",
        authentication: "None required",
        body: {
          plan: "PRO or BUSINESS",
          email: "Customer email address",
          successUrl: "(optional) Redirect URL after successful payment",
          cancelUrl: "(optional) Redirect URL if payment is canceled",
        },
        response: {
          checkoutUrl: "Stripe checkout page URL",
          sessionId: "Stripe session ID",
        },
      },
      {
        method: "GET",
        path: "/api/subscription/status",
        description: "Check subscription status for an email",
        authentication: "None required",
        parameters: {
          email: "Email address to check",
        },
        response: {
          email: "Email address",
          plan: "FREE, PRO, or BUSINESS",
          status: "active, canceled, or past_due",
          hasSubscription: "boolean",
          features: "Object with plan features",
        },
      },
      {
        method: "GET",
        path: "/api/embed/license",
        description: "Generate a license key for embedding",
        authentication: "Must have active subscription",
        parameters: {
          email: "Your subscription email",
          domain: "(optional) Domain to restrict license to",
        },
        response: {
          licenseKey: "Your license key",
          usage: "How to use the license key",
          example: "Example embed code",
        },
      },
      {
        method: "POST",
        path: "/api/embed/license",
        description: "Validate a license key",
        authentication: "None required",
        body: {
          licenseKey: "License key to validate",
          domain: "(optional) Domain making the request",
        },
        response: {
          valid: "boolean",
          plan: "Plan level",
          features: "Enabled features",
        },
      },
    ],

    // Pricing
    pricing: {
      FREE: {
        price: "$0/month",
        domains: 1,
        viewsPerMonth: 1000,
        watermark: true,
        support: "Community",
      },
      PRO: {
        price: "$29/month",
        domains: 3,
        viewsPerMonth: 50000,
        watermark: false,
        support: "Priority",
      },
      BUSINESS: {
        price: "$99/month",
        domains: "Unlimited",
        viewsPerMonth: "Unlimited",
        watermark: false,
        whiteLabel: true,
        support: "Dedicated",
      },
    },

    // Support
    support: {
      email: "support@polyx.xyz",
      documentation: `${baseUrl}/solutions`,
      pricing: `${baseUrl}/solutions#pricing`,
    },
  };

  return NextResponse.json(documentation, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
