export const HTML_EDITING_OPERATION_HTTP_POLICY = Object.freeze({
  maximumUrlBytes: 2048, timeoutMs: 60_000, readTimeoutMs: 20_000,
  windowSeconds: 60, organizationReadRequests: 60, actorReadRequests: 30, maximumRateResponseBytes: 1024,
});
export const htmlEditingOperationReceiptsEnabled = (value: string | undefined) => value === "true";
