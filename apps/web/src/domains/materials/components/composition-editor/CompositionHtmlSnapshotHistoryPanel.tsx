"use client";

import { useEffect, useRef, useState } from "react";
import type { HtmlSnapshotLocatorScope } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";
import { htmlSnapshotHistoryRequestSchema, type HtmlSnapshotHistoryPage } from "@/domains/production/composition-editor/composition-html-editing-snapshot-history.contract";
import { consultHtmlSnapshotHistory } from "@/domains/production/composition-editor/composition-html-editing-snapshot-history.client";
import { CompositionHtmlSnapshotInspectionPanel } from "./CompositionHtmlSnapshotInspectionPanel";
import { historicalHtmlMetadataGuidance } from "@/domains/production/composition-editor/composition-html-editing-historical-continuity";

const enabled = process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED === "true"
  && process.env.NEXT_PUBLIC_COMPOSITION_HTML_SNAPSHOT_RECOVERY_ENABLED === "true";
const metadataLabels = {
  HTML_PIN_REQUIRES_BYTE_INSPECTION: "Pin HTML registrado: requiere inspección de bytes y permisos actuales",
  MISSING_OR_INVALID_HTML_METADATA: "Metadatos HTML ausentes o inválidos: requiere investigación, no descartar legado",
  NOT_MARKED_AS_SNAPSHOT: "Sin marca de snapshot: registro conservado para inventario",
};
/** One bounded inventory page; explicit non-executing inspection only. */
export function CompositionHtmlSnapshotHistoryPanel({ scope, compositionId }: { scope: HtmlSnapshotLocatorScope; compositionId: string }) {
  const [page, setPage] = useState<HtmlSnapshotHistoryPage | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  async function consult(next: boolean) {
    if (requestRef.current || next && !page?.nextCursor) return;
    const parsed = htmlSnapshotHistoryRequestSchema.safeParse({ ...scope, compositionId, cursor: next ? page!.nextCursor : null });
    if (!parsed.success) { setError("Contexto de inventario no disponible."); return; }
    const controller = new AbortController(); requestRef.current = controller; setBusy(true); setError(null);
    if (!next) setPage(null);
    try {
      const result = await consultHtmlSnapshotHistory({ request: parsed.data, signal: controller.signal });
      if (!controller.signal.aborted) setPage(result);
    } catch {
      if (!controller.signal.aborted) setError("No se pudo leer la página autorizada. No se restauró ni modificó ninguna publicación; la lectura del inventario sigue incompleta.");
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; if (!controller.signal.aborted) setBusy(false); }
    }
  }
  if (!enabled) return null;
  return <section className="space-y-2 rounded border p-3 text-xs" aria-label="Inventario histórico HTML" aria-busy={busy}>
    <h3>Inventario de publicaciones históricas</h3>
    <p>Consulta metadatos de esta composición, no contenido ejecutable. Ningún pin confirma compatibilidad, permisos de recursos ni paridad visual.</p>
    <button type="button" disabled={busy} onClick={() => void consult(false)}>{page ? "Reiniciar inventario" : "Consultar inventario"}</button>
    {error && <p role="alert">{error}</p>}
    {page && <>
      <p role="status">{page.entries.length} registros en esta página; cota de revisión {page.ceilingRevision}.</p>
      <ul className="space-y-2">{page.entries.map(entry => <li key={entry.revisionId}>
        <p className="break-all">Revisión {entry.revisionNumber} · {entry.revisionId}</p>
        <p>{metadataLabels[entry.metadataStatus]}</p>
        <p>{historicalHtmlMetadataGuidance(entry.metadataStatus).instruction}</p>
        {entry.draftId && <p>{entry.draftId === scope.draftId ? "Borrador actual" : "Otro borrador de esta composición"}</p>}
        {entry.bundlePin && <p className="break-all">SHA-256 del bundle registrado: {entry.bundlePin.sha256}</p>}
        <CompositionHtmlSnapshotInspectionPanel key={`${entry.revisionId}:${entry.documentHash}:${entry.bundlePin?.sha256}`}
          scope={scope} compositionId={compositionId} entry={entry} />
      </li>)}</ul>
      {page.nextCursor ? <button type="button" disabled={busy} onClick={() => void consult(true)}>Consultar siguiente página</button>
        : <p>Fin de esta lectura hasta la cota indicada. No acredita inspección de archivos ni cierre de compatibilidad histórica.</p>}
      <p>Las publicaciones posteriores a esa cota no se incluyen. Si se modificó la historia, reinicia la lectura. No se acumulan todas las páginas en memoria.</p>
    </>}
  </section>;
}
