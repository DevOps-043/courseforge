export const MATERIALIZED_CAPTURE_AUDIT_SCOPE = "SDK_REPORTED_CAPTURE_NOT_CDP_OR_COLOR_ATTESTATION";

/** Check the SDK's resolved final strategy, not merely the options sent to it. */
export function auditMaterializedProducerCapture(capture) {
  if (!capture || capture.forceScreenshot !== true || capture.captureMode !== "screenshot"
    || capture.workerCount !== 1 || capture.browserGpuMode !== "software" || capture.hasHdrContent !== false
    || capture.deFallbackReason !== undefined || capture.deSelfVerifyFallback === true
    || capture.memoryExhaustionDetected === true || (capture.transientRetries !== undefined && capture.transientRetries !== 0))
    throw new Error("CONTROLLED_RENDER_PRODUCER_CAPTURE_MISMATCH");
  return {scope: MATERIALIZED_CAPTURE_AUDIT_SCOPE, forceScreenshot: true, captureMode: "screenshot",
    workerCount: 1, browserGpuMode: "software", hasHdrContent: false};
}
