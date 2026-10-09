export const HTML_LEGACY_ADOPTION_HTTP_POLICY = Object.freeze({
  maximumUrlBytes: 2048, maximumRequestBytes: 1024, bodyTimeoutMs: 3000,
  timeoutMs: 15_000, windowSeconds: 60, organizationRequests: 300, actorRequests: 30,
  maximumRateResponseBytes: 4096,
});

/** Reads remain available independently when new writes are disabled. */
export function htmlLegacyAdoptionEnabled(method: "GET" | "POST", environment: Record<string, string | undefined>) {
  return environment.COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED === "true"
    && environment.COMPOSITION_HTML_EDITING_LEGACY_ADOPTION_RECEIPTS_ENABLED === "true"
    && (method === "GET" || (environment.COMPOSITION_HTML_EDITING_LEGACY_ADOPTION_ENABLED === "true"
      && environment.COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED === "true"));
}
