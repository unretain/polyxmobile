import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@shared/types"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
