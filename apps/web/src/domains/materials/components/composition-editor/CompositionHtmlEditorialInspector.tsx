"use client";

import { useMemo } from "react";
import { z } from "zod";
import { useAuthStore } from "@/core/stores/authStore";
import { useOrganizationStore } from "@/core/stores/organizationStore";
import { htmlEditingBindingSchema } from "@/domains/production/composition-editor/html-editing/html-editing.contract";
import type { HtmlSnapshotLocatorScope } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";
import { useCompositionHtmlEditorialSession, type CompositionHtmlEditorialHost } from "./useCompositionHtmlEditorialSession";
import { CompositionHtmlEditableFields } from "./CompositionHtmlEditableFields";
import { CompositionHtmlInitializationPanel } from "./CompositionHtmlInitializationPanel";

const enabled = process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED === "true";
const mutationsEnabled = process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED === "true";
const scopeSchema = htmlEditingBindingSchema.pick({ organizationId: true, documentId: true, clipId: true }).extend({ actorId: z.string().uuid() });
/** Writes require both an opt-in flag and the coordinated native host. */
export function CompositionHtmlEditorialInspector({ draftId, clipId, documentHash, host }: {
  draftId: string; clipId: string; documentHash: string; host?: CompositionHtmlEditorialHost;
}) {
  const actorId = useAuthStore(state => state.user?.id ?? null);
  const organizationId = useOrganizationStore(state => state.activeOrganizationId);
  const scope = useMemo(() => scopeSchema.safeParse({ actorId, organizationId, documentId: draftId, clipId }), [actorId, organizationId, draftId, clipId]);
  if (!scope.success) return null;
  const ownerScope = { actorId: scope.data.actorId, organizationId: scope.data.organizationId, draftId: scope.data.documentId };
  return <>
    {host && <CompositionHtmlInitializationPanel key={`${scope.data.actorId}:${organizationId}:${draftId}:${clipId}:${documentHash}`}
      scope={ownerScope} target={{ clipId: scope.data.clipId, documentHash }} host={host} />}
    {enabled && <ScopedInspector key={`${scope.data.actorId}:${organizationId}:${draftId}:${clipId}`}
    scope={{ actorId: scope.data.actorId, organizationId: scope.data.organizationId, draftId: scope.data.documentId }}
    clipId={scope.data.clipId} documentHash={documentHash} host={mutationsEnabled ? host : undefined} />}
  </>;
}
function ScopedInspector({ scope, clipId, documentHash, host }: {
  scope: HtmlSnapshotLocatorScope; clipId: string; documentHash: string; host?: CompositionHtmlEditorialHost;
}) {
  const { view, error, busy, consult, changeFields, restore, history } = useCompositionHtmlEditorialSession(scope, clipId, documentHash, host);
  return <section className="space-y-2 rounded border p-3 text-xs" aria-label="Inspector HTML editorial">
    <h3>Contenido HTML editable</h3>
    <p>{host ? "Edición declarativa mediante guardado coordinado. No ejecuta render." : "Consulta de campos declarados. No modifica contenido ni ejecuta render."}</p>
    <button type="button" disabled={busy} onClick={() => void consult()}>{busy ? "Consultando…" : "Consultar campos HTML"}</button>
    {error && <p role="alert">{error}</p>}
    {view && <>
      <p>Revisión editorial {view.revisionVersion}. Plantilla {view.manifest.binding.templateId}.</p>
      {!view.usedResourcesGranted && <p role="alert">Hay recursos usados sin permiso vigente. La consulta no autoriza renderizarlos.</p>}
      {host && <>
        <div className="flex gap-2">
          <button type="button" disabled={busy || !history.canUndo} onClick={() => void restore("UNDO")}>Deshacer HTML</button>
          <button type="button" disabled={busy || !history.canRedo} onClick={() => void restore("REDO")}>Rehacer HTML</button>
        </div>
        <CompositionHtmlEditableFields key={`${view.revisionSha256}:${view.compositionDocumentHash}`} view={view}
          busy={busy || history.status !== "READY"} onCommit={changeFields} />
      </>}
      <ul className="max-h-80 space-y-3 overflow-auto">
        {view.manifest.elements.map(element => {
          const override = view.state.overrides.find(item => item.elementId === element.elementId);
          const original = view.defaults.find(item => item.elementId === element.elementId);
          const value = override?.operation === "SET_TEXT" ? override.value : override?.operation === "SET_IMAGE" ? override.assetId
            : override?.operation === "SET_THEME" ? override.choiceId : original?.kind === "TEXT" ? original.value
            : original?.kind === "IMAGE" ? original.assetId : original?.kind === "THEME" ? original.choiceId : null;
          return <li key={element.elementId}><p>{element.label} · {element.kind}</p><p className="whitespace-pre-wrap break-words">{value ?? "Sin valor declarado"}</p>
            {element.kind === "TEXT" && <p>Límite de edición: {element.maxCharacters} caracteres.</p>}
            {element.kind === "IMAGE" && <p>Opciones con permiso vigente: {element.allowedAssetIds.filter(id => view.grantedAssetIds.includes(id)).length}.</p>}
            {element.kind === "THEME" && <p>Opciones: {element.allowedChoiceIds.join(", ")}.</p>}
          </li>;
        })}
      </ul>
    </>}
  </section>;
}
