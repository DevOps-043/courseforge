/** Shared bounds for current-edit and exact-history service-only RPC adapters. */
export const HTML_EDITING_REPOSITORY_POLICY = Object.freeze({ rpcTimeoutMs: 15_000, responseBytes: 16 * 1024 * 1024,
  acknowledgmentBytes: 4 * 1024 });
