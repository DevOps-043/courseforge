"use client";

import { NativeCompositionPreview } from "./NativeCompositionPreview";
import { CompositionHtmlReconstructionResourceLinkPanel } from "./CompositionHtmlReconstructionResourceLinkPanel";
import { useEffect, useRef, useState } from "react";
import type { CompositionStudioAsset } from "./composition-studio.types";
import { htmlReconstructionOpeningSchema, type HtmlReconstructionOpening } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-opening.contract";
import { htmlReconstructionLibraryPageSchema, type HtmlReconstructionLibraryPage } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-library.contract";
import { consultHtmlReconstructionLibrary, HtmlReconstructionLibraryReadError } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-library.client";
import { initializeHtmlReconstructionLibrary, appendHtmlReconstructionLibraryPage } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-library-selection";

/** Only mount with server-authorized current identity. Existing studio reads the
 * new saved draft normally; never initialize/import sources from the old component.
 * Null is explicit independent scope, not an empty/fictitious component ID. */
export function CompositionHtmlReconstructionEditor({opening, initialLibrary, actorId, resourceLinkEnabled}: {
  opening: HtmlReconstructionOpening; initialLibrary: HtmlReconstructionLibraryPage | null; actorId: string; resourceLinkEnabled: boolean;
}) {
  const authorized = htmlReconstructionOpeningSchema.parse(opening);
  const [library, setLibrary] = useState(() => {
    if (!initialLibrary) return null;
    const page = htmlReconstructionLibraryPageSchema.parse(initialLibrary);
    if (page.organizationId !== authorized.organizationId || page.compositionId !== authorized.compositionId || page.draftId !== authorized.draftId)
      throw new Error("HTML_RECONSTRUCTION_LIBRARY_PAGE_MISMATCH");
    return initializeHtmlReconstructionLibrary(page);
  });
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(initialLibrary ? null : "La biblioteca vinculada no está disponible. Puedes consultar de nuevo sin importar recursos.");
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);
  async function loadLibrary(nextPage: boolean) {
    if (inFlight.current || (nextPage && !library?.page.nextAssetId)) return;
    const controller = new AbortController(); inFlight.current = controller; setLoading(true); setError(null);
    try {
      const page = await consultHtmlReconstructionLibrary({request: {draftId: authorized.draftId, query: {
        compositionId: authorized.compositionId,
        ...(nextPage && library ? {afterAssetId: library.page.nextAssetId!, expectedDocumentHash: library.page.currentDocumentHash,
          expectedVersion: library.page.currentVersion} : {}),
      }}, signal: controller.signal});
      controller.signal.throwIfAborted();
      if (page.organizationId !== authorized.organizationId) throw new Error("La empresa de la biblioteca cambió.");
      setLibrary(nextPage && library ? appendHtmlReconstructionLibraryPage({previous: library, next: page}) : initializeHtmlReconstructionLibrary(page));
    } catch (failure) {
      if (!controller.signal.aborted) {
        setLibrary(null);
        setError(failure instanceof HtmlReconstructionLibraryReadError ? failure.message
          : "La identidad de la biblioteca no coincide. Actualiza la consulta antes de seleccionar medios.");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (inFlight.current === controller) inFlight.current = null;
    }
  }
  const assets: CompositionStudioAsset[] = (library?.assets ?? []).map(asset => ({id: asset.productionAssetId,
    // Native clip labels have a UTF-16 budget; don't split a surrogate pair.
    label: asset.label.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, ""), mimeType: asset.mimeType, durationSeconds: asset.durationSeconds ?? undefined, hasAudio: asset.hasAudio ?? undefined,
    sourceWidth: asset.sourceWidth ?? undefined, sourceHeight: asset.sourceHeight ?? undefined, timelineRole: asset.timelineRole,
    timelineVariant: asset.timelineVariant ?? undefined, sizeLabel: `${Math.ceil(asset.fileSizeBytes / 1024)} KB`,
    sourceLabel: "Medio vinculado al borrador independiente", previewUrl: null, isEditable: true, valid: true,
  }));
  return <section aria-label="Editor de contenido reconstruido independiente">
    <p role="status" className="mb-3 rounded-lg border border-slate-300 p-3 text-sm dark:border-white/20">
      Contenido independiente. Los cambios se guardan en este nuevo borrador; el original permanece intacto.
      No se importa la biblioteca de la lección original. Solo se muestran medios actualmente vinculados a este nuevo borrador.
      La creación no equivale a publicación.
    </p>
    <div className="mb-3 flex flex-wrap items-center gap-3" aria-busy={loading}>
      <button type="button" disabled={loading} onClick={() => void loadLibrary(false)}>Actualizar biblioteca vinculada</button>
      {library?.page.nextAssetId && <button type="button" disabled={loading} onClick={() => void loadLibrary(true)}>Cargar más medios</button>}
      <span role="status">{loading ? "Consultando medios…" : `${assets.length} medios disponibles en la biblioteca`}</span>
      {error && <p role="alert">{error}</p>}
    </div>
    <CompositionHtmlReconstructionResourceLinkPanel key={`${actorId}:${authorized.organizationId}:${authorized.compositionId}:${authorized.draftId}`}
      scope={{actorId, organizationId: authorized.organizationId, compositionId: authorized.compositionId, draftId: authorized.draftId}}
      linkEnabled={resourceLinkEnabled} onLinked={() => loadLibrary(false)} />
    <NativeCompositionPreview key={authorized.draftId} assets={assets} componentId={null}
      compositionId={authorized.compositionId} draftId={authorized.draftId} lessons={[]}
      selectedLessonId={null} onSelectLesson={() => { /* No lesson library in independent scope. */ }} />
  </section>;
}
