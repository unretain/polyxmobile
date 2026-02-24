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
  // Enable WASM support for yellowstone-grpc
  experimental: {
    serverComponentsExternalPackages: ["@triton-one/yellowstone-grpc"],
  },
  webpack: (config, { isServer }) => {
    // WASM support
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Handle WASM files
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });

    // For server-side gRPC
    if (isServer) {
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push("@triton-one/yellowstone-grpc");
      }
    }

    return config;
  },
};

export default nextConfig;
