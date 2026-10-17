"use client";

import { useEffect, useRef, useState } from "react";
import type { CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import { narrativeExtractionSelectionKey, NARRATIVE_EXTRACTION_QUERY_TIMEOUT_MS } from "@/domains/production/composition-editor/composition-narrative-extraction-contract";
import { narrativeFragmentSelectionKey, type NarrativeFragmentQuery } from "@/domains/production/composition-editor/composition-narrative-fragment-contract";
import { NARRATIVE_FRAGMENT_MAX_TRACKS } from "@/domains/production/composition-editor/composition-narrative-fragment.types";
import { requestNarrativeFragmentReview, type NarrativeFragmentReviewResult } from "@/domains/production/composition-editor/composition-narrative-fragment.client";
import type { NarrativeRangeSelection } from "@/domains/production/composition-editor/composition-narrative-range.service";
import { useNarrativeExtractionHost } from "./CompositionNarrativeExtractionHost";

type Props = { document: CompositionEditorDocument; draftId: string; selection: NarrativeRangeSelection; anchorTrackId: string; enabled: boolean };
type ReviewState = { key: string; pending: boolean; result?: NarrativeFragmentReviewResult; retryAt?: number };

export function CompositionNarrativeFragmentReview(props: Props) {
  const identity = narrativeExtractionSelectionKey(props.draftId, props.selection);
  return <FragmentReviewSession key={`${identity}:${props.enabled}:${props.anchorTrackId}`} {...props} />;
}

function FragmentReviewSession({ document, draftId, selection, anchorTrackId, enabled }: Props) {
  const extraction = useNarrativeExtractionHost();
  const [confirmedIntent, setConfirmedIntent] = useState(false);
  const [confirmationFailed, setConfirmationFailed] = useState(false);
  // No overlapping track is included implicitly. The anchor itself is mandatory.
  const [selectedTrackIds, setSelectedTrackIds] = useState([anchorTrackId]);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [clock, setClock] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const request: NarrativeFragmentQuery = { contract: "NARRATIVE_FRAGMENT_QUERY_V1", selection, selectedTrackIds };
  const key = narrativeFragmentSelectionKey(draftId, request);
  const tracksAvailable = selectedTrackIds.every(id => document.tracks.some(track => track.id === id && !track.locked && !track.hidden));
  const visible = enabled && tracksAvailable && key && review?.key === key ? review : null;
  const coolingDown = Boolean(visible?.retryAt && visible.retryAt > clock);
  useEffect(() => () => { controllerRef.current?.abort(); }, []);
  useEffect(() => {
    if (!visible?.retryAt) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.max(0, visible.retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [visible?.retryAt]);

  const chooseTrack = (id: string, checked: boolean) => {
    setConfirmedIntent(false); setConfirmationFailed(false);
    controllerRef.current?.abort();
    setReview(null);
    setSelectedTrackIds(previous => checked ? [...new Set([...previous, id])] : previous.filter(trackId => trackId !== id));
  };
  const consult = async () => {
    if (!enabled || !tracksAvailable || !key || visible?.pending || coolingDown) return;
    setConfirmedIntent(false); setConfirmationFailed(false);
    controllerRef.current?.abort();
    const controller = new AbortController(); controllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort("TIMEOUT"), NARRATIVE_EXTRACTION_QUERY_TIMEOUT_MS);
    setReview({ key, pending: true });
    try {
      const result = await requestNarrativeFragmentReview({ draftId, request, signal: controller.signal });
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      setReview({ key, pending: false, result,
        retryAt: !result.ok && result.retryAfterSeconds ? Date.now() + result.retryAfterSeconds * 1000 : undefined });
    } catch {
      if (controllerRef.current !== controller || (controller.signal.aborted && controller.signal.reason !== "TIMEOUT")) return;
      setReview({ key, pending: false, result: { ok: false, message: "La consulta audiovisual no respondió correctamente. Vuelve a intentar." } });
    } finally { clearTimeout(timeout); }
  };
  const result = visible?.result;
  return <section className="space-y-2 rounded border border-slate-400/30 p-2" aria-label="Revisión de fragmento audiovisual">
    <fieldset className="space-y-1">
      <legend>Pistas del fragmento audiovisual</legend>
      <p className="text-[10px]">Incluye al menos una pista visual, además de la voz seleccionada. Elige también todas las dependencias de enlaces y grupos. Máximo {NARRATIVE_FRAGMENT_MAX_TRACKS} pistas.</p>
      {document.tracks.map(track => <label key={track.id} className="flex gap-2">
        <input type="checkbox" checked={selectedTrackIds.includes(track.id)}
          disabled={!enabled || track.id === anchorTrackId || track.locked || track.hidden || (!selectedTrackIds.includes(track.id) && selectedTrackIds.length >= NARRATIVE_FRAGMENT_MAX_TRACKS)}
          onChange={event => chooseTrack(track.id, event.currentTarget.checked)} />
        {track.label}{track.id === anchorTrackId ? " · voz obligatoria" : ""}{track.locked || track.hidden ? " · no disponible" : ""}
      </label>)}
    </fieldset>
    <button type="button" disabled={!enabled || !tracksAvailable || !key || visible?.pending || coolingDown}
      onClick={() => void consult()} className="rounded border px-2 py-1 disabled:opacity-50">
      {visible?.pending ? "Consultando…" : "Consultar fragmento audiovisual"}
    </button>
    <p className="text-[10px]">Consulta de solo lectura: no crea ni guarda fragmentos. Solo se copiarían clips visibles que intersecten el intervalo en las pistas elegidas.</p>
    {visible?.pending && <p role="status">Verificando clips, dependencias, registros y fuentes tipográficas…</p>}
    {result?.ok && <div role="status" className="space-y-1">
      <p>Fragmento elegible según los registros: {result.summary.clipCount} clips en {result.summary.trackCount} pistas.</p>
      <p>Intervalo: {result.summary.sourceStartSeconds.toFixed(2)}–{result.summary.sourceEndSeconds.toFixed(2)} s. Destino al final: {result.summary.destinationStartSeconds.toFixed(2)}–{result.summary.destinationEndSeconds.toFixed(2)} s.</p>
      <p>Captions parcialmente recortados: {result.summary.captionCuts}; palabras parcialmente recortadas: {result.summary.wordCuts}. El texto manual no se regeneraría.</p>
      <p className="text-amber-600">Se conservarán los originales. No verifica bytes de medios; requiere revalidación antes de guardar.{!extraction?.fragmentEnabled && " El guardado audiovisual no está habilitado actualmente."}</p>
      {extraction?.fragmentEnabled && <div className="space-y-2">
        <label className="flex gap-2"><input type="checkbox" checked={confirmedIntent}
          onChange={event => setConfirmedIntent(event.currentTarget.checked)} />
          Confirmo añadir una copia audiovisual al final con las pistas elegidas y captions compatibles, conservando los originales y el texto manual.</label>
        <button type="button" disabled={!confirmedIntent || !enabled || !tracksAvailable || !key || extraction.busy}
          className="rounded border px-2 py-1 disabled:opacity-50" onClick={() => {
            setConfirmedIntent(false); setConfirmationFailed(false);
            void extraction.confirmFragment(request, result.summary).then(saved => {
              setConfirmationFailed(!saved);
              if (!saved) setReview(null);
            });
          }}>Confirmar fragmento audiovisual</button>
      </div>}
    </div>}
    {result && !result.ok && <p role="alert">{result.message}</p>}
    {confirmationFailed && <p role="alert">El guardado no se confirmó. Si aparece un comando pendiente, consulta su resultado sin repetir la extracción; si fue rechazada, solicita una revisión nueva.</p>}
  </section>;
}
