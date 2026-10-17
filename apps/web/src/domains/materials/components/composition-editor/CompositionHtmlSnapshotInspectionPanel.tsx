"use client";

import { useEffect, useRef, useState } from "react";
import type { HtmlSnapshotHistoryPage } from "@/domains/production/composition-editor/composition-html-editing-snapshot-history.contract";
import type { HtmlSnapshotLocatorScope } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";
import type { HtmlSnapshotInspectionResult } from "@/domains/production/composition-editor/composition-html-editing-snapshot-inspection.contract";
import { consultHtmlSnapshotInspection } from "@/domains/production/composition-editor/composition-html-editing-snapshot-inspection.client";
import { CompositionHtmlSnapshotRepublicationReviewPanel } from "./CompositionHtmlSnapshotRepublicationReviewPanel";
import { historicalHtmlInspectionGuidance } from "@/domains/production/composition-editor/composition-html-editing-historical-continuity";

const labels = {
  REJECTED: "El contenido no superó la inspección de compatibilidad.",
  LEGACY_V1_REQUIRES_REVIEW: "Bundle V1: requiere revisión y republicación explícita.",
  PROFILE_MISMATCH_REQUIRES_REVIEW: "Perfil antiguo: requiere revisión y republicación explícita.",
  CURRENT_PROFILE_REQUIRES_CONTENT_AND_AUTHORITY_CHECKS: "Perfil vigente: aún requiere verificar documento, contenido y permisos actuales.",
};
export function CompositionHtmlSnapshotInspectionPanel({ scope, compositionId, entry }: {
  scope: HtmlSnapshotLocatorScope; compositionId: string; entry: HtmlSnapshotHistoryPage["entries"][number];
}) {
  const [result, setResult] = useState<HtmlSnapshotInspectionResult | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => { controllerRef.current?.abort(); }, []);
  async function inspect() {
    if (controllerRef.current || entry.metadataStatus !== "HTML_PIN_REQUIRES_BYTE_INSPECTION") return;
    const controller = new AbortController(); controllerRef.current = controller; setBusy(true); setError(null); setResult(null);
    try {
      const received = await consultHtmlSnapshotInspection({ request: { ...scope, compositionId, revisionId: entry.revisionId }, signal: controller.signal });
      if (received.documentId !== entry.draftId || received.documentHash !== entry.documentHash || received.bundleSha256 !== entry.bundlePin?.sha256) throw new Error();
      if (!controller.signal.aborted) setResult(received);
    } catch {
      if (!controller.signal.aborted) setError("No se pudo inspeccionar esta identidad. Reinicia el inventario si cambió; no se ejecutó ni restauró el HTML.");
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; if (!controller.signal.aborted) setBusy(false); }
    }
  }
  if (entry.metadataStatus !== "HTML_PIN_REQUIRES_BYTE_INSPECTION") return null;
  return <section aria-label={`Inspección de revisión ${entry.revisionNumber}`} aria-busy={busy}>
    <button type="button" disabled={busy} onClick={() => void inspect()}>{busy ? "Inspeccionando bytes…" : "Inspeccionar archivo sin ejecutarlo"}</button>
    {error && <p role="alert">{error}</p>}
    {result && <>
      <p role="status">{labels[result.diagnostic.status]}</p>
      <p>{historicalHtmlInspectionGuidance(result.diagnostic).instruction}</p>
      <p className="break-all">Archivo SHA-256: {result.projectHash}</p>
      {result.diagnostic.status === "PROFILE_MISMATCH_REQUIRES_REVIEW" && <p>Diferencias: {result.diagnostic.profileDifferences.join(", ")}</p>}
      <p>Inspección textual, no prueba visual, autorización de recursos ni permiso de publicación.</p>
      <CompositionHtmlSnapshotRepublicationReviewPanel
        key={`${result.revisionId}:${result.projectHash}:${result.bundleSha256}`} inspected={result} />
    </>}
  </section>;
}
