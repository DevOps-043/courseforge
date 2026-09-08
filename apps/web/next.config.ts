import type { NextConfig } from "next";

function deploymentHost() {
  const candidate = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!candidate) return null;
  try {
    return new URL(candidate).host;
  } catch {
    return null;
  }
}

const allowedServerActionOrigins = [
  "soflia-coursegen.netlify.app",
  "localhost:3000",
  deploymentHost(),
].filter((origin): origin is string => Boolean(origin));

const securityHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
  {
    key: "Content-Security-Policy-Report-Only",
    value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https: wss:; font-src 'self' data: https:; frame-src 'self' https:; worker-src 'self' blob:",
  },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

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
