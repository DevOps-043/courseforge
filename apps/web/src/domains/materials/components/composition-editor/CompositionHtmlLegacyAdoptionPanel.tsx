"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CompositionHtmlEditorialHost } from "@/domains/production/composition-editor/composition-html-editing-native-host.client";
import type { HtmlSnapshotLocatorScope } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";
import { consultHtmlLegacyReview } from "@/domains/production/composition-editor/composition-html-editing-legacy-review.client";
import { describeHtmlLegacySourceChange, htmlLegacyReviewCommandSchema, type HtmlLegacyReviewView } from "@/domains/production/composition-editor/composition-html-editing-legacy-review.contract";

const reviewEnabled = process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED === "true"
  && process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_LEGACY_ADOPTION_RECEIPTS_ENABLED === "true";
const adoptionEnabled = reviewEnabled && process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_LEGACY_ADOPTION_ENABLED === "true"
  && process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED === "true";

/** Installed, operator-reviewed candidate locator; not another template catalogue.
 * Source is escaped text, never iframe/srcDoc/innerHTML. Commit reauthorizes CAS. */
export function CompositionHtmlLegacyAdoptionPanel({ scope, target, host }: {
  scope: HtmlSnapshotLocatorScope; target: { clipId: string; documentHash: string }; host: CompositionHtmlEditorialHost;
}) {
  const candidateInputId = useId(), confirmationId = useId();
  const [candidateId, setCandidateId] = useState(""), [reviewed, setView] = useState<HtmlLegacyReviewView | null>(null);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  // Invalidate a displayed review on base changes without aborting the host's
  // own verified payload adoption before it can close its journal.
  const view = reviewed?.request.expectedDocumentHash === target.documentHash && reviewed.request.candidateId === candidateId
    && reviewed.actorId === scope.actorId && reviewed.organizationId === scope.organizationId
    && reviewed.documentId === scope.draftId && reviewed.clipId === target.clipId ? reviewed : null;
  async function review() {
    if (requestRef.current) return;
    const command = htmlLegacyReviewCommandSchema.safeParse({ actorId: scope.actorId, organizationId: scope.organizationId,
      documentId: scope.draftId, clipId: target.clipId, expectedDocumentHash: target.documentHash, candidateId });
    setView(null); setConfirmed(false); setMessage(null);
    if (!command.success) { setMessage("Indica el UUID del candidato aprobado por el operador."); return; }
    const controller = new AbortController(); requestRef.current = controller; setBusy(true);
    try {
      const result = await consultHtmlLegacyReview({ command: command.data, signal: controller.signal });
      if (!controller.signal.aborted) setView(result);
    } catch {
      if (!controller.signal.aborted) setMessage("Candidato no disponible o base incompatible. No se ha adoptado ni enviado ninguna modificación.");
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; if (!controller.signal.aborted) setBusy(false); }
    }
  }
  async function adopt() {
    if (requestRef.current || !view || !confirmed || !adoptionEnabled || !host.adoptLegacy
      || view.request.candidateId !== candidateId || view.request.expectedDocumentHash !== target.documentHash
      || host.legacyAdoptionTracking?.(scope).status !== "EMPTY") return;
    const controller = new AbortController(); requestRef.current = controller; setBusy(true); setMessage(null); setConfirmed(false);
    try {
      await host.adoptLegacy({ scope, action: { mode: "SEND", clipId: target.clipId, request: view.request }, signal: controller.signal });
      if (!controller.signal.aborted) { setView(null); setMessage("Adopción verificada. El original permanece en el historial documental; consulta los campos editables actuales."); }
    } catch {
      if (!controller.signal.aborted) { setView(null); setMessage("No se pudo confirmar la adopción. Revisa el centro de recuperación del borrador; no repitas el envío pendiente."); }
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; if (!controller.signal.aborted) setBusy(false); }
    }
  }
  if (!reviewEnabled) return null;
  const tracking = host.legacyAdoptionTracking?.(scope);
  const change = view ? describeHtmlLegacySourceChange(view.originalSource, view.candidateSource) : null;
  return <section className="space-y-2 rounded border p-3 text-xs" aria-label="Revisión de adopción HTML" aria-busy={busy}>
    <h3>Adoptar HTML instrumentado</h3>
    <p>Solo para un clip aún no editable y un candidato instalado y revisado por el operador. Esta consulta no aprueba ni instala plantillas.</p>
    <form onSubmit={event => { event.preventDefault(); void review(); }}>
      <label htmlFor={candidateInputId}>UUID del candidato aprobado</label>
      <input id={candidateInputId} value={candidateId} disabled={busy} required className="w-full rounded border p-1"
        onChange={event => { setCandidateId(event.target.value); setView(null); setConfirmed(false); setMessage(null); }} />
      <button type="submit" disabled={busy || tracking?.status !== "EMPTY"}>Consultar candidato y cambios</button>
    </form>
    {tracking?.status !== "EMPTY" && <p>Hay seguimiento pendiente o no disponible. Revisa el centro de recuperación antes de adoptar.</p>}
    {view && change && <>
      <p>Plantilla {view.templateId} · versión {view.templateVersion} · {view.fields.length} campos declarados.</p>
      <p className="break-all">Evidencia de revisión del operador: {view.evidenceSha256}.</p>
      <p>Revisiones registradas: comparación visual, manifest/accesibilidad e instalación autorizada. No sustituyen QA de este entorno.</p>
      <p>Se reemplaza únicamente la fuente del clip seleccionado y se añade su referencia editorial. No se genera un render. El cambio de fuente establece una barrera para undo nativo incompatible.</p>
      <details><summary>Cambios de fuente como texto (no comparación visual)</summary>
        <p>{change.unchangedPrefix.length} caracteres iniciales y {change.unchangedSuffix.length} finales sin cambios.</p>
        <p>Retirado del candidato:</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{change.removed || "Sin texto retirado"}</pre>
        <p>Añadido al candidato:</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{change.added || "Sin texto añadido"}</pre>
      </details>
      <details><summary>Fuentes completas y campos declarados</summary>
        <p className="break-all">Original SHA-256: {view.originalSourceSha256}</p>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{view.originalSource}</pre>
        <p className="break-all">Candidato SHA-256: {view.candidateSourceSha256}</p>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{view.candidateSource}</pre>
        <ul>{view.fields.map(field => <li key={field.elementId}>{field.label} · {field.kind} · {field.elementId}</li>)}</ul>
      </details>
      <label htmlFor={confirmationId}><input id={confirmationId} type="checkbox" checked={confirmed} disabled={busy || !adoptionEnabled}
        onChange={event => setConfirmed(event.target.checked)} /> Revisé este candidato y confirmo su adopción en esta base documental.</label>
      <button type="button" disabled={busy || !confirmed || !adoptionEnabled || tracking?.status !== "EMPTY" || !host.adoptLegacy}
        onClick={() => void adopt()}>Confirmar adopción con guardado coordinado</button>
      {!adoptionEnabled && <p>Las nuevas adopciones están deshabilitadas; la consulta no las activa.</p>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
