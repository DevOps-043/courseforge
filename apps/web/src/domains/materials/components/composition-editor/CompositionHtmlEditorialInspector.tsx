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
import { CompositionHtmlLegacyAdoptionPanel } from "./CompositionHtmlLegacyAdoptionPanel";
import { CompositionHtmlPanel } from "./CompositionHtmlPanel";

const enabled = process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED === "true";
const mutationsEnabled = process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED === "true";
const preparationEnabled = process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_INITIALIZATION_ENABLED === "true";
const scopeSchema = htmlEditingBindingSchema.pick({ organizationId: true, documentId: true, clipId: true }).extend({ actorId: z.string().uuid() });
/** Writes require both an opt-in flag and the coordinated native host. */
export function CompositionHtmlEditorialInspector({ draftId, clipId, documentHash, host }: {
  draftId: string; clipId: string; documentHash: string; host?: CompositionHtmlEditorialHost;
}) {
  const actorId = useAuthStore(state => state.user?.id ?? null);
  const authLoading = useAuthStore(state => state.isLoading);
  const sessionError = useAuthStore(state => state.sessionError);
  const initializeAuth = useAuthStore(state => state.initialize);
  const organizationId = useOrganizationStore(state => state.activeOrganizationId);
  const organizationLoading = useOrganizationStore(state => !state.isLoaded || state.isSwitching);
  const scope = useMemo(() => scopeSchema.safeParse({ actorId, organizationId, documentId: draftId, clipId }), [actorId, organizationId, draftId, clipId]);
  if (!scope.success) return enabled ? <CompositionHtmlPanel title="Contenido HTML editable" label="Inspector HTML editorial">
    {authLoading || organizationLoading ? <p role="status">Comprobando sesión y organización…</p> : <>
      <p role="alert">{sessionError ?? (!actorId ? "No se pudo identificar tu sesión. Vuelve a comprobarla o inicia sesión de nuevo."
        : !organizationId ? "Selecciona una organización válida para editar HTML." : "El contexto de edición HTML no es válido.")}</p>
      {!actorId && <button type="button" onClick={() => void initializeAuth()}>Volver a comprobar sesión</button>}
    </>}
  </CompositionHtmlPanel> : null;
  const ownerScope = { actorId: scope.data.actorId, organizationId: scope.data.organizationId, draftId: scope.data.documentId };
  return <>
    {enabled && <ScopedInspector key={`${scope.data.actorId}:${organizationId}:${draftId}:${clipId}`}
    scope={{ actorId: scope.data.actorId, organizationId: scope.data.organizationId, draftId: scope.data.documentId }}
    clipId={scope.data.clipId} documentHash={documentHash} host={mutationsEnabled ? host : undefined} />}
    {host && <CompositionHtmlInitializationPanel key={`${scope.data.actorId}:${organizationId}:${draftId}:${clipId}:${documentHash}`}
      scope={ownerScope} target={{ clipId: scope.data.clipId, documentHash }} host={host} />}
    {host && <CompositionHtmlLegacyAdoptionPanel key={`adoption:${scope.data.actorId}:${organizationId}:${draftId}:${clipId}`}
      scope={ownerScope} target={{ clipId: scope.data.clipId, documentHash }} host={host} />}
  </>;
}
function ScopedInspector({ scope, clipId, documentHash, host }: {
  scope: HtmlSnapshotLocatorScope; clipId: string; documentHash: string; host?: CompositionHtmlEditorialHost;
}) {
  const { view, error, busy, consult, changeFields, restore, history } = useCompositionHtmlEditorialSession(scope, clipId, documentHash, host);
  return <CompositionHtmlPanel title="Contenido HTML editable" label="Inspector HTML editorial" busy={busy}
    description={view ? (host ? "Campos disponibles para esta diapositiva. Los cambios se aplican al guardar la revisión." : "Campos disponibles en modo de solo lectura.")
      : host ? "Cambia los textos, imágenes y opciones que esta diapositiva tenga habilitados. Primero carga sus campos editables."
      : "Consulta los campos disponibles. La edición está deshabilitada en esta sesión."}>
    <button type="button" data-primary="true" disabled={busy} onClick={() => void consult()}>{busy ? "Cargando campos…" : view ? "Actualizar campos HTML" : "Cargar campos editables"}</button>
    {error && <p role="alert">{error}</p>}
    {error && !view && <p>{host && preparationEnabled
      ? "Si esta diapositiva aún no está preparada, abre «Preparar campos HTML» debajo. Si ya lo está, revisa los permisos y la configuración de lectura."
      : "Pide a un administrador que revise si esta diapositiva tiene campos habilitados, los permisos y la configuración de lectura."}</p>}
    {!view && !error && <p>{host
      ? "Después de cargar los campos: modifica un valor, pulsa «Preparar cambio» y guarda los cambios preparados. No se genera un video automáticamente."
      : "Pulsa «Cargar campos editables» para consultar los valores y límites disponibles. Esta consulta no modifica la diapositiva."}</p>}
    {view && <>
      <p>Revisión editorial {view.revisionVersion}. Plantilla {view.manifest.binding.templateId}.</p>
      {view.manifest.elements.length === 0 && <p role="status">Esta plantilla no declara campos editables para la diapositiva.</p>}
      {!view.usedResourcesGranted && <p role="alert">Hay recursos usados sin permiso vigente. La consulta no autoriza renderizarlos.</p>}
      {host && <>
        <div className="flex gap-2">
          <button type="button" disabled={busy || !history.canUndo} onClick={() => void restore("UNDO")}>Deshacer HTML</button>
          <button type="button" disabled={busy || !history.canRedo} onClick={() => void restore("REDO")}>Rehacer HTML</button>
        </div>
        <CompositionHtmlEditableFields key={`${view.revisionSha256}:${view.compositionDocumentHash}`} view={view}
          busy={busy || history.status !== "READY"} onCommit={changeFields} />
      </>}
      <details><summary>Ver valores y límites declarados ({view.manifest.elements.length})</summary>
      <ul className="max-h-80 space-y-3 overflow-auto">
        {view.manifest.elements.map(element => {
          const override = view.state.overrides.find(item => item.elementId === element.elementId);
          const original = view.defaults.find(item => item.elementId === element.elementId);
          const value = override?.operation === "SET_TEXT" ? override.value : override?.operation === "SET_IMAGE" ? override.assetId
            : override?.operation === "SET_THEME" ? override.choiceId : original?.kind === "TEXT" ? original.value
            : override?.operation === "SET_ATTRIBUTE" ? override.value : override?.operation === "SET_VISIBILITY" ? String(override.visible)
              : original?.kind === "IMAGE" ? original.assetId : original?.kind === "THEME" ? original.choiceId
                : override?.operation === "SET_SLOT_ORDER" ? override.itemIds.join(" → ") : original?.kind === "ATTRIBUTE" ? original.value
                  : original?.kind === "VISIBILITY" ? String(original.visible) : original?.kind === "SLOTS" ? original.itemIds.join(" → ")
                    : override?.operation === "SET_CHART_DATA" ? JSON.stringify(override.dataset)
                      : original?.kind === "CHART" ? JSON.stringify(original.dataset)
                        : override?.operation === "SET_STYLE_RANGE" ? String(override.value)
                          : original?.kind === "RANGE_TOKEN" ? String(original.value) : null;
          return <li key={element.elementId}><p>{element.label} · {element.kind}</p><p className="whitespace-pre-wrap break-words">{value ?? "Sin valor declarado"}</p>
            {element.kind === "TEXT" && <p>Límite de edición: {element.maxCharacters} caracteres.</p>}
            {element.kind === "TEXT" && element.localePolicy && <p>Idiomas/direcciones: {element.localePolicy.allowedLocales.map(locale => `${locale.language}/${locale.direction}`).join(", ")}.</p>}
            {element.kind === "IMAGE" && <p>Opciones con permiso vigente: {element.allowedAssetIds.filter(id => view.grantedAssetIds.includes(id)).length}.</p>}
            {element.kind === "THEME" && <p>Opciones: {element.allowedChoiceIds.join(", ")}.</p>}
            {element.kind === "ATTRIBUTE" && <p>Atributo: {element.attributeName}. {element.allowedValues
              ? `Valores declarados: ${element.allowedValues.join(", ")}.` : `Texto acotado a ${element.maxCharacters} caracteres.`}</p>}
            {element.kind === "VISIBILITY" && <p>Visibilidad reversible; display visible: {element.visibleDisplay}.</p>}
            {element.kind === "SLOTS" && <p>Slots repetibles declarados: {element.itemIds.length}. Sin inserción ni movimientos entre contenedores.</p>}
            {element.kind === "CHART" && <p>Gráfico {element.chart.type}: datos tipados; diseño e identidad fijados por plantilla.</p>}
            {element.kind === "RANGE_TOKEN" && <p>Token {element.tokenId}: {element.range.minimum}–{element.range.maximum}, paso {element.range.step}.</p>}
          </li>;
        })}
      </ul></details>
    </>}
  </CompositionHtmlPanel>;
}
