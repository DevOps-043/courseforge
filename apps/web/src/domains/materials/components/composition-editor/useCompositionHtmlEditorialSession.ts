"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HtmlSnapshotLocatorScope } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";
import { consultHtmlEditingInspector } from "@/domains/production/composition-editor/composition-html-editing-http.client";
import { HtmlEditingEditorialHistory } from "@/domains/production/composition-editor/composition-html-editing-history.client";
import { prepareHtmlEditingBatchCommand } from "@/domains/production/composition-editor/composition-html-editing-field-command.client";
import { htmlEditingInspectorViewSchema, type HtmlEditingInspectorView } from "@/domains/production/composition-editor/html-editing/html-editing-inspector.contract";
import { htmlEditingBindingsMatch } from "@/domains/production/composition-editor/html-editing/html-editing-validation";
import { htmlEditingMutationAcknowledgmentSchema, type HtmlEditingMutationRequest } from "@/domains/production/composition-editor/composition-html-editing-mutation.contract";
import type { CompositionHtmlEditorialHost } from "@/domains/production/composition-editor/composition-html-editing-native-host.client";
export type { CompositionHtmlEditorialHost } from "@/domains/production/composition-editor/composition-html-editing-native-host.client";

/** Native host must reserve queue + bypass fences, persist tracking, dispatch once,
 * verify authorized refresh and guard adoption before resolving this port.
 * Missing port means read-only; flags alone never enable a raw POST from UI. */
export function useCompositionHtmlEditorialSession(scope: HtmlSnapshotLocatorScope, clipId: string,
  documentHash: string, host?: CompositionHtmlEditorialHost) {
  const [view, setView] = useState<HtmlEditingInspectorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useMemo(() => new HtmlEditingEditorialHistory({ actorId: scope.actorId, organizationId: scope.organizationId,
    documentId: scope.draftId, clipId }), [scope.actorId, scope.organizationId, scope.draftId, clipId]);
  const requestRef = useRef<AbortController | null>(null);
  const documentHashRef = useRef(documentHash); documentHashRef.current = documentHash;
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  useEffect(() => {
    if (!requestRef.current && view && view.compositionDocumentHash !== documentHash) setView(null);
  }, [documentHash, view, busy]);

  async function consult() {
    if (requestRef.current) return;
    const controller = new AbortController(); requestRef.current = controller; setBusy(true); setView(null); setError(null);
    try {
      const current = await consultHtmlEditingInspector({ scope: { organizationId: scope.organizationId, documentId: scope.draftId, clipId }, signal: controller.signal });
      if (controller.signal.aborted || requestRef.current !== controller) return;
      if (current.compositionDocumentHash !== documentHashRef.current) {
        setError("El documento guardado cambió. Recarga la composición antes de inspeccionar sus valores."); return;
      }
      history.observe(current, scope.actorId); setView(current);
    } catch {
      if (!controller.signal.aborted) setError("No se pudo consultar la revisión editable. Requiere una plantilla inicializada y lectura habilitada.");
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; if (!controller.signal.aborted) setBusy(false); }
    }
  }

  async function mutate(action: { overrides: unknown } | { direction: "UNDO" | "REDO" }): Promise<boolean> {
    if (!host || !view || requestRef.current || view.compositionDocumentHash !== documentHashRef.current) return false;
    let body: HtmlEditingMutationRequest;
    try {
      if ("overrides" in action) {
        body = prepareHtmlEditingBatchCommand(view, action.overrides);
        history.beginCommand();
      } else body = history.beginRestore(action.direction);
    } catch { setError("El lote no cumple las opciones, permisos o límites declarados. Repara todas las imágenes revocadas antes de guardar."); return false; }
    const controller = new AbortController(); requestRef.current = controller; setBusy(true); setError(null);
    try {
      const result = await host.execute({ scope, clipId, body, beforeView: view, signal: controller.signal });
      if (controller.signal.aborted || requestRef.current !== controller) return false;
      const acknowledgment = htmlEditingMutationAcknowledgmentSchema.parse(result.acknowledgment);
      const fresh = htmlEditingInspectorViewSchema.parse(result.view);
      if (fresh.revisionVersion !== acknowledgment.next.version || fresh.revisionSha256 !== acknowledgment.next.sha256
        || fresh.compositionDocumentHash !== result.adoptedDocumentHash
        || !htmlEditingBindingsMatch(view.manifest.binding, fresh.manifest.binding)
        || JSON.stringify(view.manifest) !== JSON.stringify(fresh.manifest)) throw new Error();
      history.confirm(acknowledgment); history.observe(fresh, scope.actorId); setView(fresh);
      return true;
    } catch {
      history.markUncertain();
      if (!controller.signal.aborted) {
        setView(null); setError("No se completó la confirmación y actualización del editor. Conserva el seguimiento; no repitas el envío automáticamente.");
      }
      return false;
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; if (!controller.signal.aborted) setBusy(false); }
    }
  }
  return { view, error, busy, consult, changeFields: (overrides: unknown) => mutate({ overrides }),
    restore: (direction: "UNDO" | "REDO") => mutate({ direction }), history: history.snapshot() };
}
