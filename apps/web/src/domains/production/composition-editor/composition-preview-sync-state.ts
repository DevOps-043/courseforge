export const COMPOSITION_PREVIEW_SYNC_PHASES = [
  "LOADING",
  "SYNCED",
  "LOCAL_DIRTY",
  "SAVING",
  "VISUAL_SYNC_PENDING",
  "CONFLICT",
  "SAVE_FAILED",
  "RUNTIME_FAILED",
] as const;

export type CompositionPreviewSyncPhase = typeof COMPOSITION_PREVIEW_SYNC_PHASES[number];

export interface CompositionPreviewSyncState {
  localRevision: number;
  pendingRenderDocumentHash: string | null;
  persistedDocumentHash: string | null;
  phase: CompositionPreviewSyncPhase;
  renderedDocumentHash: string | null;
}

export type CompositionPreviewSyncEvent =
  | { documentHash: string; type: "DOCUMENT_LOADED" }
  | { type: "EDIT_ACCEPTED" }
  | { type: "SAVE_STARTED" }
  | { documentHash: string; type: "SAVE_SUCCEEDED" }
  | { type: "SAVE_FAILED" }
  | { documentHash: string; type: "CONFLICT" }
  | { documentHash: string; type: "PREVIEW_RELOAD_STARTED" }
  | { documentHash: string; type: "PREVIEW_READY" }
  | { type: "RUNTIME_FAILED" };

export const INITIAL_COMPOSITION_PREVIEW_SYNC_STATE: CompositionPreviewSyncState = {
  localRevision: 0,
  pendingRenderDocumentHash: null,
  persistedDocumentHash: null,
  phase: "LOADING",
  renderedDocumentHash: null,
};

export function transitionCompositionPreviewSyncState(
  state: CompositionPreviewSyncState,
  event: CompositionPreviewSyncEvent,
): CompositionPreviewSyncState {
  switch (event.type) {
    case "DOCUMENT_LOADED":
      return { ...state, pendingRenderDocumentHash: event.documentHash, persistedDocumentHash: event.documentHash, phase: "VISUAL_SYNC_PENDING" };
    case "EDIT_ACCEPTED":
      return { ...state, localRevision: state.localRevision + 1, pendingRenderDocumentHash: null, phase: "LOCAL_DIRTY" };
    case "SAVE_STARTED":
      return { ...state, phase: "SAVING" };
    case "SAVE_SUCCEEDED":
      return {
        ...state,
        pendingRenderDocumentHash: state.renderedDocumentHash === event.documentHash ? null : event.documentHash,
        persistedDocumentHash: event.documentHash,
        phase: state.renderedDocumentHash === event.documentHash ? "SYNCED" : "VISUAL_SYNC_PENDING",
      };
    case "SAVE_FAILED":
      return { ...state, phase: "SAVE_FAILED" };
    case "CONFLICT":
      return { ...state, pendingRenderDocumentHash: null, persistedDocumentHash: event.documentHash, phase: "CONFLICT" };
    case "PREVIEW_RELOAD_STARTED":
      return { ...state, pendingRenderDocumentHash: event.documentHash, phase: "VISUAL_SYNC_PENDING" };
    case "PREVIEW_READY":
      return {
        ...state,
        pendingRenderDocumentHash: null,
        renderedDocumentHash: event.documentHash,
        phase: state.persistedDocumentHash === event.documentHash ? "SYNCED" : "LOCAL_DIRTY",
      };
    case "RUNTIME_FAILED":
      return { ...state, phase: "RUNTIME_FAILED" };
  }
}
