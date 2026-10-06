"use client";

import { useEffect, useRef, useState } from "react";
import { narrativeExtractionSelectionKey, NARRATIVE_EXTRACTION_QUERY_TIMEOUT_MS } from "@/domains/production/composition-editor/composition-narrative-extraction-contract";
import { requestNarrativeExtractionReview, type NarrativeExtractionReviewResult } from "@/domains/production/composition-editor/composition-narrative-extraction-client";
import type { NarrativeRangeSelection } from "@/domains/production/composition-editor/composition-narrative-range.service";
import { useNarrativeExtractionHost } from "./CompositionNarrativeExtractionHost";

type ReviewState = { key: string; pending: boolean; result?: NarrativeExtractionReviewResult; retryAt?: number };
type ReviewProps = { draftId: string; selection: NarrativeRangeSelection; enabled: boolean };

export function CompositionNarrativeExtractionReview(props: ReviewProps) {
  const identity = narrativeExtractionSelectionKey(props.draftId, props.selection);
  // A selection or eligibility change starts a new session; old results cannot reappear after re-enabling.
  return <NarrativeExtractionReviewSession key={`${identity}:${props.enabled}`} {...props} />;
}

function NarrativeExtractionReviewSession({ draftId, selection, enabled }: ReviewProps) {
  const extraction = useNarrativeExtractionHost();
  const [confirmedIntent, setConfirmedIntent] = useState(false);
  const [confirmationFailed, setConfirmationFailed] = useState(false);
  const key = narrativeExtractionSelectionKey(draftId, selection);
  const controllerRef = useRef<AbortController | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [clock, setClock] = useState(0);
  const visible = enabled && key !== null && review?.key === key ? review : null;
  const coolingDown = Boolean(visible?.retryAt && visible.retryAt > clock);

  // Old responses are also hidden synchronously by their selection key, before effect cleanup runs.
  useEffect(() => {
    controllerRef.current?.abort();
    return () => { controllerRef.current?.abort(); };
  }, [key, enabled]);
  useEffect(() => {
    if (!visible?.retryAt) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.max(0, visible.retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [visible?.retryAt]);

  const requestReview = async () => {
    if (!enabled || !key || visible?.pending || coolingDown) return;
    setConfirmedIntent(false);
    setConfirmationFailed(false);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort("TIMEOUT"), NARRATIVE_EXTRACTION_QUERY_TIMEOUT_MS);
    setReview({ key, pending: true });
    try {
      const result = await requestNarrativeExtractionReview({ draftId, selection, signal: controller.signal });
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      setReview({ key, pending: false, result,
        retryAt: !result.ok && result.retryAfterSeconds ? Date.now() + result.retryAfterSeconds * 1000 : undefined });
    } catch {
      if (controllerRef.current !== controller || (controller.signal.aborted && controller.signal.reason !== "TIMEOUT")) return;
      setReview({ key, pending: false, result: { ok: false, message: "La consulta no respondió correctamente. Vuelve a intentar." } });
    } finally {
      clearTimeout(timeout);
    }
  };
  const result = visible?.result;
  return <section className="space-y-2 rounded border border-slate-400/30 p-2" aria-label="Revisión de extracción de voz">
    <button type="button" disabled={!enabled || !key || visible?.pending || coolingDown} onClick={() => void requestReview()}
      className="rounded border px-2 py-1 disabled:opacity-50">{visible?.pending ? "Consultando…" : "Consultar extracción de voz"}</button>
    <p className="text-[10px]">Consulta de solo lectura. No crea ni guarda fragmentos.</p>
    {visible?.pending && <p role="status">Verificando la revisión y los metadatos del audio…</p>}
    {result?.ok && <div role="status" className="space-y-1">
      <p>Fragmento de voz elegible según los registros actuales.</p>
      <p>Fuente: {result.summary.sourceStartSeconds.toFixed(2)}–{result.summary.sourceEndSeconds.toFixed(2)} s.</p>
      <p>Se añadiría al final: {result.summary.destinationStartSeconds.toFixed(2)}–{result.summary.destinationEndSeconds.toFixed(2)} s. La toma original se conservaría.</p>
      <p className="text-amber-600">No incluye visuales ni avatar. No verifica los bytes del audio; requiere nueva validación antes de guardar.{!extraction?.enabled && " El guardado no está habilitado actualmente."}</p>
      {extraction?.enabled && <div className="space-y-2">
        <label className="flex gap-2"><input type="checkbox" checked={confirmedIntent} onChange={event => setConfirmedIntent(event.currentTarget.checked)} />Confirmo añadir una copia solo de voz al final; conservar el original y no incluir captions ni visuales.</label>
        <button type="button" disabled={!confirmedIntent || !enabled || extraction.busy} className="rounded border px-2 py-1 disabled:opacity-50"
          onClick={() => { setConfirmedIntent(false); setConfirmationFailed(false);
            void extraction.confirm(selection, result.summary).then(saved => {
              setConfirmationFailed(!saved);
              if (!saved) setReview(null);
            }); }}>Confirmar extracción de voz</button>
      </div>}
    </div>}
    {result && !result.ok && <p role="alert">{result.message}</p>}
    {confirmationFailed && <p role="alert">La extracción no se confirmó. Consulta una revisión nueva si fue rechazada; si aparece un comando pendiente, recupera su resultado sin repetir el guardado.</p>}
  </section>;
}
