import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export for Capacitor iOS/mobile build
  output: "export",
  trailingSlash: true,
  transpilePackages: ["@shared/types"],
  images: {
    // Static export requires unoptimized images
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
