// Next.js instrumentation - runs once when server starts
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // Only run on the server (not during build or in edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Disabled: price updater hits RPC too often
    // const { startPriceUpdater } = await import("@/lib/price-updater");
    // startPriceUpdater();

    // Disabled: polling disabled to avoid rate limits on public RPC
    // Data will be fetched on-demand when user visits Pulse page
    console.log("[Pulse] Server-side polling disabled (rate limit protection)");
    console.log("[Pulse] Data fetched on-demand via API routes");
  }
}
