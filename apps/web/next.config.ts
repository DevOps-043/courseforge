import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ["@google/genai"],
  experimental: {
    serverActions: {
      allowedOrigins: ["soflia-coursegen.netlify.app", "*.netlify.app", "localhost:3000"]
    }
  }
};

export default nextConfig;
