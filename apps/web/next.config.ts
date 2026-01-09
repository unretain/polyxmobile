import type { NextConfig } from "next";

const isMobileBuild = process.env.MOBILE_BUILD === "true";

const nextConfig: NextConfig = {
  // Static export only for mobile builds (Capacitor iOS)
  // Railway deployments use server-side rendering with API routes
  ...(isMobileBuild && {
    output: "export",
    trailingSlash: true,
  }),
  transpilePackages: ["@shared/types"],
  images: {
    unoptimized: isMobileBuild, // Only unoptimized for static export
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
