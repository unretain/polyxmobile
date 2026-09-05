import type { NextConfig } from "next";

// Coin logos live on images.polyx.trade. Serving them from there directly means a
// second origin has to be reachable for the page to look right — and on networks
// that interfere with TLS to *.polyx.trade (SNI filtering; the symptom is a partly
// broken grid of logos, since some connections get through and some don't) it isn't.
// Proxying them through whatever origin the app was loaded from removes that second
// dependency entirely: if the page loaded, its images load. The upstream sends
// `max-age=31536000, immutable`, so this costs one hop on a cold cache and nothing
// afterwards.
const IMG_ORIGIN = process.env.NEXT_PUBLIC_IMG_ORIGIN || "https://images.polyx.trade";

const nextConfig: NextConfig = {
  transpilePackages: ["@shared/types"],
  async rewrites() {
    return [{ source: "/imgp/:path*", destination: `${IMG_ORIGIN}/:path*` }];
  },
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
