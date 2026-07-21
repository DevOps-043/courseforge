import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ["@google/genai", "@remotion/bundler", "esbuild"],
  experimental: {
    serverActions: {
      allowedOrigins: ["soflia-coursegen.netlify.app", "*.netlify.app", "localhost:3000"]
    }
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
        ],
      },
    ];
  }
};

export default nextConfig;
