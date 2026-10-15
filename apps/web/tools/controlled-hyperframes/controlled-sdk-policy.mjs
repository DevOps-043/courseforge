/** Local authored-corpus limits. These do not activate a product worker. */
export const SDK_LIFECYCLE_POLICY = Object.freeze({id: "SDK_OWNED_RESOURCES_AND_SHARED_DEADLINE_V1",
  maximumCleanupMs: 5_000, resourceIds: Object.freeze(["server", "capture", "cdp", "text", "sdrEncoder"])});
export const SDK_PROCESS_BUDGETS = Object.freeze({mediaMs: 120_000, encodeMs: 300_000, muxMs: 120_000, probeMs: 30_000});
