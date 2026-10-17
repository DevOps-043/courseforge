import { matchesCompositionPreviewNavigation } from "./composition-preview-comparison";
import type { CompositionPreviewIframeMessage } from "./composition-preview-protocol";

type PreviewMessageDecision =
  | { accept: true; runtimeSignal: boolean }
  | { accept: false; outcome?: "STALE_READY" | "UNVERIFIED_READY" };

/** Called after source identity and schema validation, before any runtime or UI effects. */
export function classifyCompositionPreviewMessage(input: {
  documentHash: string | null;
  generation: number;
  failedGeneration: number | null;
  message: CompositionPreviewIframeMessage;
  strictSync: boolean;
}): PreviewMessageDecision {
  if (!input.strictSync) return { accept: true, runtimeSignal: false };
  // Saves may change the sync phase without replacing the failed iframe.
  if (input.failedGeneration === input.generation) return { accept: false };
  const { message } = input;
  if (message.type === "courseforge-composition-ready" || message.type === "courseforge-composition-load-error") {
    if (!matchesCompositionPreviewNavigation({
      expectedDocumentHash: input.documentHash,
      expectedGeneration: input.generation,
      receivedDocumentHash: message.documentHash,
      receivedGeneration: message.previewGeneration,
    })) {
      return message.type === "courseforge-composition-ready"
        ? { accept: false, outcome: !input.documentHash || !message.documentHash || message.previewGeneration == null ? "UNVERIFIED_READY" : "STALE_READY" }
        : { accept: false };
    }
  } else if (message.previewGeneration !== input.generation) {
    return { accept: false };
  }
  return { accept: true, runtimeSignal: true };
}
