import type { NextConfig } from "next";

const isMobileBuild = process.env.MOBILE_BUILD === "true";

const nextConfig: NextConfig = {
  // Static export for Capacitor iOS build
  ...(isMobileBuild && {
    output: "export",
    trailingSlash: true,
  }),
  transpilePackages: ["@shared/types"],
  images: {
    // Static export requires unoptimized images
    unoptimized: isMobileBuild,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
