"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthStore } from "@/core/stores/authStore";
import { useOrganizationStore } from "@/core/stores/organizationStore";
import { consultHistoricalHtmlCandidate } from "@/domains/production/composition-editor/composition-html-editing-historical-candidate.client";
import type { HtmlHistoricalCandidateView } from "@/domains/production/composition-editor/composition-html-editing-historical-candidate.contract";
import { htmlHistoricalPublicationRequestSchema, type HtmlHistoricalPublicationReceipt } from "@/domains/production/composition-editor/composition-html-editing-historical-publication.contract";
import { coordinateHistoricalHtmlPublication, type HtmlHistoricalPublicationAction } from "@/domains/production/composition-editor/composition-html-editing-historical-publication-coordinator.client";
import { readHistoricalHtmlJournal, historicalHtmlJournalStorageKey, type HtmlHistoricalJournalState } from "@/domains/production/composition-editor/composition-html-editing-historical-publication-journal.client";
import { resolveHtmlSnapshotLocatorStorage, type HtmlSnapshotLocatorScope } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";
import { resolveHtmlSnapshotPublicationLock } from "@/domains/production/composition-editor/composition-html-snapshot-publication-lock.client";

const readsEnabled = process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED === "true"
  && process.env.NEXT_PUBLIC_COMPOSITION_HTML_SNAPSHOT_RECOVERY_ENABLED === "true";
const writesEnabled = readsEnabled && process.env.NEXT_PUBLIC_COMPOSITION_HTML_SNAPSHOT_PUBLICATION_ENABLED === "true"
  && process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED === "true";

/** Operator supplies candidate IDs, never approval/source/ZIP. Root-level panel
 * remains available for durable recovery independently of selected clip/history
 * pages and write flags. No calls to native apply, selection, preview or undo. */
export function CompositionHtmlHistoricalPublicationPanel({scope, compositionId}: {scope: HtmlSnapshotLocatorScope; compositionId: string}) {
  const context = useMemo(() => ({...scope, compositionId}), [scope, compositionId]);
  const storage = useMemo(() => resolveHtmlSnapshotLocatorStorage(), []), lock = useMemo(() => resolveHtmlSnapshotPublicationLock(), []);
  const [tracking, setTracking] = useState<HtmlHistoricalJournalState>({status: "UNAVAILABLE"});
  const [candidateId, setCandidateId] = useState(""), [candidateSha256, setCandidateSha256] = useState("");
  const [candidate, setCandidate] = useState<HtmlHistoricalCandidateView | null>(null);
  const [receipt, setReceipt] = useState<HtmlHistoricalPublicationReceipt | null>(null);
  const [confirmed, setConfirmed] = useState(false), [closeConfirmed, setCloseConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const mounted = useRef(false), generation = useRef(0), controllerRef = useRef<AbortController | null>(null);
  const isCurrent = useCallback(() => mounted.current && useAuthStore.getState().user?.id === context.actorId
    && useOrganizationStore.getState().activeOrganizationId === context.organizationId, [context]);
  const refresh = useCallback(async () => {
    const current = ++generation.current, state = await readHistoricalHtmlJournal(storage, context);
    if (isCurrent() && current === generation.current) setTracking(state);
  }, [context, isCurrent, storage]);
  useEffect(() => {
    mounted.current = true; void refresh();
    const changed = (event: StorageEvent) => {
      if (event.key !== null && event.key !== historicalHtmlJournalStorageKey(context) || event.storageArea !== null && event.storageArea !== storage) return;
      controllerRef.current?.abort(); setCandidate(null); setConfirmed(false); setCloseConfirmed(false); setReceipt(null); void refresh();
    };
    window.addEventListener("storage", changed);
    return () => {mounted.current = false; controllerRef.current?.abort(); window.removeEventListener("storage", changed);};
  }, [context, refresh, storage]);

  async function run(action: "CONSULT" | HtmlHistoricalPublicationAction) {
    if (controllerRef.current || !isCurrent()) return;
    const controller = new AbortController(); controllerRef.current = controller; setBusy(true); setError(null); setReceipt(null);
    try {
      if (action === "CONSULT") {
        setCandidate(null); setConfirmed(false);
        const request = htmlHistoricalPublicationRequestSchema.parse({candidateId, candidateSha256});
        const view = await consultHistoricalHtmlCandidate({request: {...context, request}, signal: controller.signal});
        if (isCurrent() && !controller.signal.aborted) setCandidate(view);
      } else {
        const result = await coordinateHistoricalHtmlPublication({scope: context, action, storage, lock, signal: controller.signal,
          isCurrent: () => isCurrent() && !controller.signal.aborted});
        if (isCurrent() && !controller.signal.aborted) {
          setReceipt(result); setConfirmed(false); setCloseConfirmed(false);
          if (action.mode === "CLOSE_HISTORY") {setCandidate(null); setCandidateId(""); setCandidateSha256("");}
        }
      }
    } catch {
      if (isCurrent() && !controller.signal.aborted) setError("Resultado sin confirmar. Conserva el seguimiento y consulta su recibo. No repitas el registro ni reconstruyas el candidato automáticamente.");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        if (isCurrent()) {setBusy(false); await refresh();}
      }
    }
  }
  function resetCandidate() {setCandidate(null); setConfirmed(false); setError(null); setReceipt(null);}
  if (!readsEnabled && tracking.status === "EMPTY") return null;
  return <section className="space-y-2 rounded border p-3 text-xs" aria-label="Registro y recuperación histórica HTML" aria-busy={busy}>
    <h3>Revisión histórica sin activación</h3>
    <p>Registra una revisión nueva del candidato aprobado por el operador. No cambia el borrador, la publicación activa ni el historial undo. No acredita render ni QA visual.</p>
    {tracking.status === "UNAVAILABLE" && <p role="alert">Seguimiento local no disponible o inválido. No se permite registrar otra operación. No borres sus datos para reintentar.</p>}
    {tracking.status === "EMPTY" && readsEnabled && <>
      <label className="block">ID del candidato entregado por el operador
        <input className="block w-full" value={candidateId} maxLength={36} disabled={busy} onChange={event => {setCandidateId(event.target.value); resetCandidate();}} />
      </label>
      <label className="block">SHA-256 del candidato entregado por el operador
        <input className="block w-full" value={candidateSha256} maxLength={64} disabled={busy} onChange={event => {setCandidateSha256(event.target.value); resetCandidate();}} />
      </label>
      <button type="button" disabled={busy || !htmlHistoricalPublicationRequestSchema.safeParse({candidateId, candidateSha256}).success}
        onClick={() => void run("CONSULT")}>Consultar candidato aprobado</button>
      {candidate && <>
        <p className="break-all">Snapshot original: {candidate.provenance.originalRevisionId} · SHA-256 {candidate.provenance.originalProjectHash}</p>
        <p className="break-all">Documento histórico: {candidate.provenance.documentId} · SHA-256 {candidate.provenance.documentHash}</p>
        <p className="break-all">ZIP revisado SHA-256: {candidate.projectHash}</p>
        <p className="break-all">Bundle vigente SHA-256: {candidate.provenance.candidateBundleSha256}</p>
        <p className="break-all">Reviewer: {candidate.approval.reviewerId} · evidencia SHA-256: {candidate.approval.evidenceSha256}</p>
        <p>Registradas por el operador: comparación visual histórica, contenido/accesibilidad y autorización de republicación. Esta consulta no las realiza de nuevo.</p>
        <label className="block"><input type="checkbox" checked={confirmed} disabled={busy || !writesEnabled}
          onChange={event => setConfirmed(event.target.checked)} />Confirmo registrar este candidato como revisión histórica nueva, sin activarlo ni cambiar el borrador.</label>
        <button type="button" disabled={busy || !confirmed || !writesEnabled || !storage || !lock}
          onClick={() => void run({mode: "SEND", candidate, confirmedHistoricalOnly: true})}>Registrar revisión histórica</button>
        {!writesEnabled && <p>Las escrituras históricas están deshabilitadas; la consulta no autoriza activarlas.</p>}
        {!lock && <p>El navegador no ofrece el bloqueo requerido. No se enviará el registro.</p>}
      </>}
    </>}
    {tracking.status === "PENDING" && <>
      {!lock && <p>El navegador no ofrece el bloqueo requerido para consultar y cerrar este seguimiento de forma coordinada.</p>}
      <p className="break-all">Operación en seguimiento: {tracking.entry.command.operationId}</p>
      <p className="break-all">Digest de solicitud: {tracking.entry.requestSha256}</p>
      <p>{tracking.entry.receipt ? "Recibo local disponible; aún requiere consulta autorizada." : "Resultado pendiente de consulta autorizada. No se permite otro envío."}</p>
      <button type="button" disabled={busy || !lock} onClick={() => void run({mode: "RECOVER", operationId: tracking.entry.command.operationId})}>Consultar recibo histórico</button>
      {tracking.entry.receipt && <>
        <label className="block"><input type="checkbox" checked={closeConfirmed} disabled={busy} onChange={event => setCloseConfirmed(event.target.checked)} />Confirmo cerrar solo el seguimiento local; conservar la revisión histórica y el borrador actual.</label>
        <button type="button" disabled={busy || !closeConfirmed || !lock} onClick={() => void run({mode: "CLOSE_HISTORY",
          operationId: tracking.entry.command.operationId, confirmedHistoryOnly: true})}>Verificar recibo y cerrar seguimiento</button>
      </>}
    </>}
    {error && <p role="alert">{error}</p>}
    {receipt && <p role="status" className="break-all">Recibo verificado: operación {receipt.operationId} · revisión {receipt.revisionNumber} · {receipt.revisionId} · ZIP SHA-256 {receipt.projectHash}. Sin activación ni cambio de borrador en ese commit; no describe el estado actual.</p>}
  </section>;
}
