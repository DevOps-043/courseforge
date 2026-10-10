"use client";

import { useEffect, useRef, useState } from "react";
import type { HtmlSnapshotInspectionResult } from "@/domains/production/composition-editor/composition-html-editing-snapshot-inspection.contract";
import type { HtmlSnapshotRepublicationReview } from "@/domains/production/composition-editor/composition-html-editing-snapshot-republication-review.contract";
import { consultHtmlSnapshotRepublicationReview } from "@/domains/production/composition-editor/composition-html-editing-snapshot-republication-review.client";

const comparisonLabels = { NO_PRIOR_OUTPUT_PIN: "Sin pin anterior de salida", OUTPUT_PIN_EQUAL: "Pin de salida igual (no prueba visual)",
  OUTPUT_PIN_CHANGED: "Pin de salida diferente; requiere comparación visual" };
export function CompositionHtmlSnapshotRepublicationReviewPanel({ inspected }: { inspected: HtmlSnapshotInspectionResult }) {
  const [review, setReview] = useState<HtmlSnapshotRepublicationReview | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => { controllerRef.current?.abort(); }, []);
  async function prepare() {
    if (controllerRef.current) return;
    const controller = new AbortController(); controllerRef.current = controller; setBusy(true); setError(null); setReview(null);
    try {
      const result = await consultHtmlSnapshotRepublicationReview({ request: {
        actorId: inspected.actorId, organizationId: inspected.organizationId, compositionId: inspected.compositionId,
        draftId: inspected.draftId, revisionId: inspected.revisionId,
      }, signal: controller.signal });
      if (result.documentId !== inspected.documentId || result.documentHash !== inspected.documentHash
        || result.originalProjectHash !== inspected.projectHash || result.originalBundleSha256 !== inspected.bundleSha256) throw new Error();
      if (!controller.signal.aborted) setReview(result);
    } catch {
      if (!controller.signal.aborted) setError("No se pudo verificar identidad, contenido o permisos vigentes para preparar el candidato. Conserva el original y solicita investigación del bloqueo; no sustituyas pins, reescribas la fuente ni repitas automáticamente. No se aprobó, publicó ni modificó el borrador.");
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; if (!controller.signal.aborted) setBusy(false); }
    }
  }
  if (!["LEGACY_V1_REQUIRES_REVIEW", "PROFILE_MISMATCH_REQUIRES_REVIEW"].includes(inspected.diagnostic.status)) return null;
  return <section aria-label="Preparación de revisión histórica" aria-busy={busy} className="space-y-2 border-t pt-2">
    <button type="button" disabled={busy} onClick={() => void prepare()}>{busy ? "Preparando comparación…" : "Preparar candidato para revisión"}</button>
    {error && <p role="alert">{error}</p>}
    {review && <>
      <p role="status">Candidato HTML separado, aún sin aprobación ni publicación. La futura revisión histórica no se activará ni cambiará el borrador.</p>
      <p>Perfil original: {review.originalCompilationProfile ? Object.values(review.originalCompilationProfile).join(" / ") : "V1 sin perfil fijado"}.</p>
      <p>Perfil candidato: {Object.values(review.candidateCompilationProfile).join(" / ")}.</p>
      <p className="break-all">Bundle candidato SHA-256: {review.candidateBundleSha256}</p>
      <ul>{review.comparisons.map(comparison => <li key={comparison.clipId} className="break-all">
        {comparison.clipId}: {comparisonLabels[comparison.status]}
      </li>)}</ul>
      {review.unmatchedPriorClipIds.length > 0 && <p>Pins antiguos sin equivalente: {review.unmatchedPriorClipIds.join(", ")}.</p>}
      <p>Requiere comparación visual histórica, revisión de contenido/accesibilidad y autorización de republicación. Preparar no registra ninguna de ellas.</p>
    </>}
  </section>;
}
