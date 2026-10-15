export const HTML_EDITING_INSPECTOR_HTTP_POLICY = Object.freeze({ timeoutMs: 20_000, maximumUrlBytes: 2048,
  windowSeconds: 60, organizationRequestsPerWindow: 120, actorRequestsPerWindow: 30, maximumRateResponseBytes: 1024 });
export const htmlEditingInspectorEnabled = (value: string | undefined): boolean => value === "true";
