import type { CompositionPreviewParentCommandInput, CompositionPreviewVisualPatchResult } from "./composition-preview-protocol";
import { COMPOSITION_PREVIEW_RUNTIME_PATCH_CONFIG } from "./composition-preview-sync.config";
import type { CompositionPreviewVisualPatch } from "./composition-preview-visual-patch";

export interface CompositionPreviewRuntimePatchOutcome {
  applied: boolean;
  code: CompositionPreviewVisualPatchResult["code"] | "DISPOSED" | "SEND_REJECTED" | "TIMEOUT";
  durationMs: number;
  sequence: number;
}

type PendingPatch = {
  resolve: (outcome: CompositionPreviewRuntimePatchOutcome) => void;
  startedAt: number;
  timeout: ReturnType<typeof setTimeout>;
};

/** Owns bounded patch acknowledgements so stale or duplicate iframe messages are ignored. */
export class CompositionPreviewRuntimePatchCoordinator {
  private readonly pending = new Map<number, PendingPatch>();
  private sequence = 0;

  constructor(
    private readonly acknowledgementTimeoutMs: number = COMPOSITION_PREVIEW_RUNTIME_PATCH_CONFIG.acknowledgementTimeoutMs,
  ) {}

  dispatch(params: {
    baseDocumentHash: string;
    patch: CompositionPreviewVisualPatch;
    send: (command: CompositionPreviewParentCommandInput) => boolean;
  }) {
    this.sequence = this.sequence >= 2_147_483_647 ? 1 : this.sequence + 1;
    const sequence = this.sequence;
    const startedAt = performance.now();
    return new Promise<CompositionPreviewRuntimePatchOutcome>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(sequence);
        resolve({ applied: false, code: "TIMEOUT", durationMs: performance.now() - startedAt, sequence });
      }, this.acknowledgementTimeoutMs);
      this.pending.set(sequence, { resolve, startedAt, timeout });
      const sent = params.send({
        baseDocumentHash: params.baseDocumentHash,
        patch: params.patch,
        sequence,
        type: "courseforge-composition-visual-patch",
      });
      if (!sent) this.resolvePending(sequence, false, "SEND_REJECTED");
    });
  }

  acknowledge(message: CompositionPreviewVisualPatchResult) {
    return this.resolvePending(message.sequence, message.applied, message.code);
  }

  dispose() {
    for (const sequence of [...this.pending.keys()]) {
      this.resolvePending(sequence, false, "DISPOSED");
    }
  }

  private resolvePending(
    sequence: number,
    applied: boolean,
    code: CompositionPreviewRuntimePatchOutcome["code"],
  ) {
    const pending = this.pending.get(sequence);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    this.pending.delete(sequence);
    pending.resolve({
      applied,
      code,
      durationMs: Math.max(0, performance.now() - pending.startedAt),
      sequence,
    });
    return true;
  }
}
