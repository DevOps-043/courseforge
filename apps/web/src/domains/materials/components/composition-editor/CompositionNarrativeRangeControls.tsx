"use client";

import { useEffect, useMemo, useState } from "react";
import type { CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import type { NarrativeNavigationOccurrence } from "@/domains/production/composition-editor/composition-narrative-occurrence.service";
import { resolveNarrativeRangePreview, NARRATIVE_RANGE_PREVIEW_MAX_SECONDS, NARRATIVE_RANGE_TEXT_PREVIEW_CHARACTERS, type NarrativeRangeSelection } from "@/domains/production/composition-editor/composition-narrative-range.service";
import { CompositionNarrativeExtractionReview } from "./CompositionNarrativeExtractionReview";
import { CompositionNarrativeFragmentReview } from "./CompositionNarrativeFragmentReview";

export function CompositionNarrativeRangeControls({ document, documentHash, draftId, occurrence, initialRange, canPreview, onPreview, onStop }: {
  document: CompositionEditorDocument;
  documentHash: string;
  draftId: string;
  occurrence: NarrativeNavigationOccurrence;
  initialRange: { firstSourceIndex: number; lastSourceIndex: number };
  canPreview: boolean;
  onPreview: (selection: NarrativeRangeSelection) => boolean;
  onStop: () => void;
}) {
  const [firstSourceIndex, setFirstSourceIndex] = useState(initialRange.firstSourceIndex);
  const [lastSourceIndex, setLastSourceIndex] = useState(initialRange.lastSourceIndex);
  const [previewRejected, setPreviewRejected] = useState(false);
  const [adjustedInterval, setAdjustedInterval] = useState<{ adjustedStartSeconds: number; adjustedEndSeconds: number } | null>(null);
  const wordSelection = useMemo(() => ({ documentHash, occurrenceId: occurrence.id, firstSourceIndex, lastSourceIndex }),
    [documentHash, occurrence.id, firstSourceIndex, lastSourceIndex]);
  const selection = useMemo(() => ({ ...wordSelection, ...adjustedInterval }), [wordSelection, adjustedInterval]);
  const wordResolution = useMemo(() => resolveNarrativeRangePreview(document, documentHash, wordSelection), [document, documentHash, wordSelection]);
  const resolution = useMemo(() => adjustedInterval ? resolveNarrativeRangePreview(document, documentHash, selection) : wordResolution,
    [adjustedInterval, document, documentHash, selection, wordResolution]);
  const clip = document.clips.find((candidate) => candidate.id === occurrence.clipId);
  useEffect(() => () => onStop(), [onStop]);
  const changeBound = (bound: "FIRST" | "LAST", ordinal: number) => {
    onStop();
    setPreviewRejected(false);
    setAdjustedInterval(null);
    if (bound === "FIRST") setFirstSourceIndex(ordinal - 1);
    else setLastSourceIndex(ordinal - 1);
  };
  const changeTime = (bound: "START" | "END", seconds: number) => {
    if (!wordResolution.ok) return;
    onStop();
    setPreviewRejected(false);
    const previous = adjustedInterval || { adjustedStartSeconds: wordResolution.range.startSeconds, adjustedEndSeconds: wordResolution.range.endSeconds };
    setAdjustedInterval({ ...previous, ...(bound === "START" ? { adjustedStartSeconds: seconds } : { adjustedEndSeconds: seconds }) });
  };
  return <section className="space-y-2 rounded border border-cyan-500/40 p-2" aria-label="Rango de palabras de la toma">
    <p className="font-semibold">Seleccionar rango de esta toma</p>
    <p className="text-[10px]">Números de palabra en la fuente original. No se permite cruzar a otra toma.</p>
    <div className="grid grid-cols-2 gap-2">
      <label>Palabra inicial<input type="number" step={1} min={occurrence.tokens[0]!.sourceIndex + 1} max={occurrence.tokens.at(-1)!.sourceIndex + 1}
        value={Number.isFinite(firstSourceIndex) ? firstSourceIndex + 1 : ""} onChange={(event) => changeBound("FIRST", event.currentTarget.valueAsNumber)} className="w-full rounded border bg-transparent px-1" /></label>
      <label>Palabra final<input type="number" step={1} min={occurrence.tokens[0]!.sourceIndex + 1} max={occurrence.tokens.at(-1)!.sourceIndex + 1}
        value={Number.isFinite(lastSourceIndex) ? lastSourceIndex + 1 : ""} onChange={(event) => changeBound("LAST", event.currentTarget.valueAsNumber)} className="w-full rounded border bg-transparent px-1" /></label>
    </div>
    {wordResolution.ok && clip && <div className="grid grid-cols-2 gap-2">
      <label>Inicio (s)<input type="number" step="any" min={clip.startSeconds} max={clip.startSeconds + clip.durationSeconds}
        value={Number.isFinite(adjustedInterval?.adjustedStartSeconds ?? wordResolution.range.startSeconds) ? (adjustedInterval?.adjustedStartSeconds ?? wordResolution.range.startSeconds) : ""}
        onChange={(event) => changeTime("START", event.currentTarget.valueAsNumber)} className="w-full rounded border bg-transparent px-1" /></label>
      <label>Fin (s)<input type="number" step="any" min={clip.startSeconds} max={clip.startSeconds + clip.durationSeconds}
        value={Number.isFinite(adjustedInterval?.adjustedEndSeconds ?? wordResolution.range.endSeconds) ? (adjustedInterval?.adjustedEndSeconds ?? wordResolution.range.endSeconds) : ""}
        onChange={(event) => changeTime("END", event.currentTarget.valueAsNumber)} className="w-full rounded border bg-transparent px-1" /></label>
      <button type="button" onClick={() => { onStop(); setAdjustedInterval(null); setPreviewRejected(false); }} className="col-span-2 rounded border px-2 py-1">Restablecer tiempos de palabras</button>
    </div>}
    {resolution.ok ? <>
      <p dir="auto">Palabras seleccionadas: {resolution.range.text.slice(0, NARRATIVE_RANGE_TEXT_PREVIEW_CHARACTERS)}{resolution.range.text.length > NARRATIVE_RANGE_TEXT_PREVIEW_CHARACTERS ? "…" : ""}</p>
      {adjustedInterval && <p className="text-[10px]">Intervalo ajustado manualmente: puede incluir contexto o recortar las palabras seleccionadas.</p>}
      <p>{resolution.range.startSeconds.toFixed(2)}–{resolution.range.endSeconds.toFixed(2)} s{resolution.range.partial ? " · incluye palabra parcialmente recortada" : ""}</p>
    </> : <p role="alert">Selecciona palabras consecutivas disponibles y tiempos válidos dentro de esta toma, hasta {NARRATIVE_RANGE_PREVIEW_MAX_SECONDS} segundos.</p>}
    <p className="text-[10px]">Preescucha la mezcla de la composición, no voz aislada. El vínculo de timestamps al audio sigue sin verificar; no habilita extracción.</p>
    <div className="flex gap-2">
      <button type="button" disabled={!resolution.ok || !canPreview} onClick={() => setPreviewRejected(!onPreview(selection))} className="rounded border px-2 py-1 disabled:opacity-50">Escuchar intervalo</button>
      <button type="button" onClick={onStop} className="rounded border px-2 py-1">Detener intervalo</button>
    </div>
    {!canPreview && <p className="text-amber-600">La preescucha requiere un preview guardado y listo, sin propuestas o comparación activas.</p>}
    {previewRejected && <p role="alert">El preview o la revisión cambió. Vuelve a seleccionar el rango.</p>}
    <CompositionNarrativeExtractionReview draftId={draftId} selection={selection} enabled={resolution.ok && canPreview} />
    {clip && <CompositionNarrativeFragmentReview document={document} draftId={draftId} selection={selection}
      anchorTrackId={clip.trackId} enabled={resolution.ok && canPreview} />}
  </section>;
}
