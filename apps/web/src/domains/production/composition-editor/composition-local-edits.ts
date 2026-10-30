import type { CompositionEditorDocument } from "./composition-document.types";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";
import { applyCompositionEditorPatches, ensureCanvasDurationForClipPatches } from "./editor-patch.service";
import { COMPOSITION_PREVIEW_SAVE_QUEUE_CONFIG } from "./composition-preview-sync.config";

type Payload = { document: CompositionEditorDocument; documentHash: string };
type Edit = { id: string; operations: CompositionEditorPatchOperation[]; source: "USER" | "AGENT" };

/** Proyección de sesión: la cola existente sigue siendo la única que persiste. */
export class CompositionLocalEdits<TPayload extends Payload> {
  private confirmed: TPayload | null = null;
  private pending: Edit[] = [];
  private projected: CompositionEditorDocument | null = null;
  get active() { return this.pending.length > 0; }

  admit(payload: TPayload, edit: Edit, retain: () => void = () => {}) {
    if (this.pending.length >= COMPOSITION_PREVIEW_SAVE_QUEUE_CONFIG.maxPendingCommands) throw new Error("Hay demasiados cambios pendientes. Espera a que termine el guardado actual.");
    const operations = ensureCanvasDurationForClipPatches(payload.document, edit.operations);
    const document = applyCompositionEditorPatches(payload.document, operations, edit.source);
    if (JSON.stringify(document) === JSON.stringify(payload.document)) return null;
    retain();
    if (!this.active) this.confirmed = payload;
    this.pending.push({ ...edit, operations });
    this.projected = document;
    return { operations, payload: { ...payload, document } };
  }

  prepare(id: string) {
    if (!this.confirmed || this.pending[0]?.id !== id) throw new Error("El orden de los cambios pendientes no coincide con el guardado.");
    const edit = this.pending[0];
    return { ...edit, before: this.confirmed, document: applyCompositionEditorPatches(this.confirmed.document, edit.operations, edit.source) };
  }

  confirm(id: string, payload: TPayload, expectedDocument?: CompositionEditorDocument) {
    if (this.pending[0]?.id !== id) throw new Error("La respuesta no corresponde al cambio en curso.");
    this.confirmed = payload;
    this.pending.shift();
    // El caso normal no vuelve a aplicar toda la cola sobre un documento idéntico.
    if (this.pending.length && this.projected && expectedDocument
      && JSON.stringify(payload.document) === JSON.stringify(expectedDocument)) return { ...payload, document: this.projected };
    // Una respuesta antigua sólo confirma su comando; no sustituye ediciones posteriores.
    let document = payload.document;
    for (const edit of this.pending) document = applyCompositionEditorPatches(document, edit.operations, edit.source);
    this.projected = document;
    return { ...payload, document };
  }

  cancel(payload = this.confirmed) {
    this.pending = [];
    this.confirmed = null;
    this.projected = null;
    return payload;
  }
}
