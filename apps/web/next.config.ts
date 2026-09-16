import type { NextConfig } from "next";
import {
  buildGlobalSecurityHeaders,
  resolveAllowedServerActionOrigins,
} from "./src/config/web-security-policy";

const allowedServerActionOrigins = resolveAllowedServerActionOrigins(process.env);
const securityHeaders = buildGlobalSecurityHeaders(process.env);

const nextConfig: NextConfig = {
  devIndicators: {
    position: "bottom-right",
  },
  serverExternalPackages: ["@google/genai", "@remotion/bundler", "@remotion/renderer", "esbuild"],
  experimental: {
    serverActions: {
      allowedOrigins: allowedServerActionOrigins,
    }
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  }
};

export default nextConfig;
