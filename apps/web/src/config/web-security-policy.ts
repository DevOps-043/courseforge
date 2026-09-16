type SecurityEnvironment = Partial<Record<
  | "DEPLOY_PRIME_URL"
  | "DEPLOY_URL"
  | "NEXT_PUBLIC_APP_URL"
  | "NODE_ENV"
  | "URL",
  string | undefined
>>;

const PRODUCTION_APP_HOST = "soflia-coursegen.netlify.app";

function trustedHost(rawValue: string | undefined, allowLocalHttp: boolean) {
  if (!rawValue) return null;

  try {
    const parsed = new URL(rawValue);
    const isLocalHttp =
      allowLocalHttp &&
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");

    if (parsed.protocol !== "https:" && !isLocalHttp) return null;
    return parsed.host;
  } catch {
    return null;
  }
}

export function resolveAllowedServerActionOrigins(
  environment: SecurityEnvironment,
) {
  const isProduction = environment.NODE_ENV === "production";
  const configuredOrigins = [
    environment.NEXT_PUBLIC_APP_URL,
    environment.URL,
    environment.DEPLOY_URL,
    environment.DEPLOY_PRIME_URL,
  ].map((value) => trustedHost(value, !isProduction));

  return Array.from(
    new Set([
      PRODUCTION_APP_HOST,
      ...configuredOrigins,
      ...(!isProduction ? ["localhost:3000", "127.0.0.1:3000"] : []),
    ].filter((origin): origin is string => Boolean(origin))),
  );
}

export function buildContentSecurityPolicy(environment: SecurityEnvironment) {
  const isProduction = environment.NODE_ENV === "production";
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    [
      "script-src 'self' 'unsafe-inline'",
      !isProduction ? "'unsafe-eval'" : null,
      "https://accounts.google.com",
      "https://apis.google.com",
    ].filter(Boolean).join(" "),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    [
      "connect-src 'self'",
      "https://*.supabase.co",
      "wss://*.supabase.co",
      "https://accounts.google.com",
      "https://apis.google.com",
      "https://www.googleapis.com",
      ...(!isProduction
        ? ["ws://localhost:*", "ws://127.0.0.1:*"]
        : []),
    ].join(" "),
    "font-src 'self' data: https://fonts.gstatic.com",
    [
      "frame-src 'self'",
      "https://gamma.app",
      "https://*.google.com",
      "https://www.youtube.com",
      "https://www.youtube-nocookie.com",
      "https://player.vimeo.com",
    ].join(" "),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ];

  return directives.join("; ");
}

export function buildGlobalSecurityHeaders(environment: SecurityEnvironment) {
  return [
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy(environment),
    },
    ...(environment.NODE_ENV === "production"
      ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
      : []),
  ];
}
