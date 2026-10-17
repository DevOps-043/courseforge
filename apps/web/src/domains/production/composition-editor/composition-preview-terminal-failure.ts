import type { CompositionPreviewLoadErrorCode } from "./composition-preview-protocol";
import type { CompositionPreviewMetric } from "./composition-preview-telemetry";
import {
  transitionCompositionPreviewSyncState,
  type CompositionPreviewSyncState,
} from "./composition-preview-sync-state";

export type TerminalPreviewSyncOutcome =
  | "ACCESS_DENIED"
  | "AUTH_REQUIRED"
  | "PREVIEW_IFRAME_ERROR"
  | "PREVIEW_LOAD_FAILED"
  | "PREVIEW_LOADED_NO_RUNTIME"
  | "PREVIEW_READY_TIMEOUT"
  | "RUNTIME_FAILED";

export interface TerminalPreviewFailure {
  code?: CompositionPreviewLoadErrorCode;
  message: string;
  outcome: TerminalPreviewSyncOutcome;
}

export interface TerminalPreviewPresentation {
  loadErrorCode: CompositionPreviewLoadErrorCode | null;
  mediaState: "READY";
  message: string;
  pendingMediaIds: [];
  playing: false;
  ready: false;
}

interface TerminalPreviewFailurePorts {
  record: (metric: CompositionPreviewMetric) => void;
  present: (presentation: TerminalPreviewPresentation) => void;
  state: { current: CompositionPreviewSyncState };
}

/** Commits one terminal outcome; a repeated signal cannot overwrite the first failure or duplicate metrics. */
export function applyCompositionPreviewTerminalFailure(
  failure: TerminalPreviewFailure,
  atSeconds: number,
  ports: TerminalPreviewFailurePorts,
) {
  if (ports.state.current.phase === "RUNTIME_FAILED") return false;
  ports.state.current = transitionCompositionPreviewSyncState(ports.state.current, { type: "RUNTIME_FAILED" });
  try {
    ports.record({
      atSeconds,
      context: { syncOutcome: failure.outcome },
      durationMs: 0,
      mediaIds: [],
      name: "preview_sync_event",
    });
  } catch {
    // Diagnostic delivery must not prevent the editor from surfacing a terminal failure.
  }
  ports.present({
    loadErrorCode: failure.code ?? null,
    mediaState: "READY",
    message: failure.message,
    pendingMediaIds: [],
    playing: false,
    ready: false,
  });
  return true;
}
