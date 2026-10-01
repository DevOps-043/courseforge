/**
 * Safe rollout switch for the preview synchronization controller.
 * The implementation stays opt-in until DEV/QA validates runtime parity and fallback telemetry.
 */
export const COMPOSITION_PREVIEW_SYNC_V2_ENABLED = (
  process.env.NEXT_PUBLIC_COMPOSITION_PREVIEW_SYNC_V2_ENABLED === "true"
);

export const COMPOSITION_PREVIEW_SAVE_QUEUE_CONFIG = {
  maxPendingCommands: 50,
} as const;

export const COMPOSITION_PREVIEW_RUNTIME_PATCH_CONFIG = {
  acknowledgementTimeoutMs: 750,
} as const;

export const COMPOSITION_PREVIEW_DOCUMENT_READY_CONFIG = {
  acknowledgementTimeoutMs: 30_000,
  runtimeHandshakeAfterLoadMs: 5_000,
} as const;
