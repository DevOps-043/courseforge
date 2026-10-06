/** Server-only rollout gate. Unset/any value except literal true stays off. */
export const htmlSnapshotRecoveryEnabled = (configured:string | undefined) => configured === "true";
export const HTML_SNAPSHOT_RECOVERY_HTTP_POLICY = Object.freeze({requestsPerWindow:30,windowSeconds:60,
  timeoutMs:15_000,maximumUrlBytes:2048,maximumRateResponseBytes:1024});
