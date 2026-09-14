import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContentSecurityPolicy,
  buildGlobalSecurityHeaders,
  resolveAllowedServerActionOrigins,
} from "../web-security-policy";

test("production Server Actions trust only exact HTTPS deployment hosts", () => {
  const origins = resolveAllowedServerActionOrigins({
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://courses.example.com/path",
    URL: "https://soflia-coursegen.netlify.app",
    DEPLOY_URL: "https://release--soflia-coursegen.netlify.app",
    DEPLOY_PRIME_URL: "https://deploy-preview-42--soflia-coursegen.netlify.app",
  });

  assert.deepEqual(origins, [
    "soflia-coursegen.netlify.app",
    "courses.example.com",
    "release--soflia-coursegen.netlify.app",
    "deploy-preview-42--soflia-coursegen.netlify.app",
  ]);
  assert.ok(!origins.some((origin) => origin.includes("*")));
  assert.ok(!origins.some((origin) => origin.startsWith("localhost")));
});

test("invalid and insecure production origins are ignored", () => {
  const origins = resolveAllowedServerActionOrigins({
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: "javascript:alert(1)",
    URL: "http://production.example.com",
    DEPLOY_URL: "not a URL",
    DEPLOY_PRIME_URL: undefined,
  });

  assert.deepEqual(origins, ["soflia-coursegen.netlify.app"]);
});

test("development policy keeps local tooling without weakening production", () => {
  const origins = resolveAllowedServerActionOrigins({
    NODE_ENV: "development",
    NEXT_PUBLIC_APP_URL: "http://localhost:3100",
    URL: undefined,
    DEPLOY_URL: undefined,
    DEPLOY_PRIME_URL: undefined,
  });
  const policy = buildContentSecurityPolicy({
    NODE_ENV: "development",
    NEXT_PUBLIC_APP_URL: undefined,
    URL: undefined,
    DEPLOY_URL: undefined,
    DEPLOY_PRIME_URL: undefined,
  });

  assert.ok(origins.includes("localhost:3100"));
  assert.ok(origins.includes("localhost:3000"));
  assert.match(policy, /script-src[^;]+'unsafe-eval'/);
  assert.match(policy, /ws:\/\/localhost:\*/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
});

test("production CSP is enforced and limits executable/network origins", () => {
  const environment = {
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: undefined,
    URL: undefined,
    DEPLOY_URL: undefined,
    DEPLOY_PRIME_URL: undefined,
  } as const;
  const headers = buildGlobalSecurityHeaders(environment);
  const policyHeader = headers.find(
    (header) => header.key === "Content-Security-Policy",
  );

  assert.ok(policyHeader);
  const directives = policyHeader.value.split("; ");
  const scriptSources = directives.find((directive) => directive.startsWith("script-src"))?.split(" ") || [];
  const connectionSources = directives.find((directive) => directive.startsWith("connect-src"))?.split(" ") || [];
  assert.equal(
    headers.some((header) => header.key === "Content-Security-Policy-Report-Only"),
    false,
  );
  assert.match(policyHeader.value, /object-src 'none'/);
  assert.match(policyHeader.value, /frame-ancestors 'self'/);
  assert.match(policyHeader.value, /script-src 'self' 'unsafe-inline' https:\/\/accounts\.google\.com https:\/\/apis\.google\.com/);
  assert.doesNotMatch(policyHeader.value, /'unsafe-eval'/);
  assert.ok(!scriptSources.includes("https:"));
  assert.ok(!connectionSources.includes("https:"));
  assert.match(policyHeader.value, /https:\/\/\*\.supabase\.co/);
  assert.match(policyHeader.value, /upgrade-insecure-requests/);
  assert.ok(headers.some((header) => header.key === "Strict-Transport-Security"));
});
