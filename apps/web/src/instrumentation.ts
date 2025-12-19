// Next.js instrumentation - runs once when server starts
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // Only run on the server (not during build or in edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPriceUpdater } = await import("@/lib/price-updater");
    startPriceUpdater();
  }
}
