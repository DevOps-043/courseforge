"use client";

import { useDeferredValue, useId, useMemo, useState } from "react";
import type { CompositionSceneSummary } from "@/domains/production/composition-editor/composition-scene.service";
import type { CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import { deriveNarrativeNavigationOccurrences } from "@/domains/production/composition-editor/composition-narrative-occurrence.service";
import type { NarrativeRangeSelection } from "@/domains/production/composition-editor/composition-narrative-range.service";
import { CompositionNarrativeRangeControls } from "./CompositionNarrativeRangeControls";
import {
  buildNarrativeSearchIndex, NARRATIVE_SEARCH_LIMITS, searchNarrativeIndex,
  type NarrativeSearchResponse,
} from "@/domains/production/composition-editor/composition-narrative-search.service";

export function CompositionNarrativeSearch({ document, documentHash, draftId, scenes, onSeek, onSelect, canPreviewRange, onPreviewRange, onStopRange }: {
  document: CompositionEditorDocument;
  documentHash: string;
  draftId: string;
  scenes: CompositionSceneSummary[];
  onSeek: (seconds: number) => void;
  onSelect: (hfId: string) => void;
  canPreviewRange: boolean;
  onPreviewRange: (selection: NarrativeRangeSelection) => boolean;
  onStopRange: () => void;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [ignoreAccents, setIgnoreAccents] = useState(true);
  const [activeResult, setActiveResult] = useState<{ response: NarrativeSearchResponse; id: string } | null>(null);
  const deferredQuery = useDeferredValue(query);
  const scopeMissing = Boolean(sceneId && !scenes.some((scene) => scene.id === sceneId));
  const occurrences = useMemo(() => deriveNarrativeNavigationOccurrences(document), [document]);
  const index = useMemo(() => buildNarrativeSearchIndex(scenes, { sceneId, ignoreAccents, occurrences: occurrences.occurrences }), [scenes, sceneId, ignoreAccents, occurrences]);
  const result = useMemo(() => searchNarrativeIndex(index, deferredQuery), [index, deferredQuery]);
  const pending = query !== deferredQuery;
  const activeIndex = activeResult?.response === result ? result.matches.findIndex((match) => match.id === activeResult.id) : -1;
  const activeMatch = result.matches[activeIndex];
  const activeOccurrence = occurrences.occurrences.find((occurrence) => occurrence.id === activeMatch?.occurrenceId);
  const navigateResult = (position: number) => {
    const match = result.matches[position];
    if (!match || pending || scopeMissing) return;
    setActiveResult({ response: result, id: match.id });
    onSeek(match.navigationSeconds);
    if (match.primaryHfId) onSelect(match.primaryHfId);
  };
  return <div className="space-y-2 border-b border-slate-300/20 py-3" aria-label="Búsqueda en guion">
    <label htmlFor={inputId} className="block font-semibold">Buscar en guion y palabras temporizadas</label>
    <input id={inputId} type="search" value={query} maxLength={NARRATIVE_SEARCH_LIMITS.queryCharacters}
      onChange={(event) => setQuery(event.target.value)} aria-describedby={`${inputId}-help`}
      className="w-full rounded border border-slate-400/30 bg-transparent px-2 py-1" />
    <select aria-label="Ámbito de búsqueda" value={scopeMissing ? "missing" : sceneId}
      onChange={(event) => setSceneId(event.target.value)} className="w-full rounded border border-slate-400/30 bg-transparent px-2 py-1">
      <option value="">Todas las escenas</option>
      {scopeMissing && <option value="missing" disabled>La escena seleccionada ya no existe</option>}
      {scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.label}</option>)}
    </select>
    <label className="flex items-center gap-2"><input type="checkbox" checked={ignoreAccents}
      onChange={(event) => setIgnoreAccents(event.target.checked)} />Ignorar acentos en vocales</label>
    <p id={`${inputId}-help`} className="text-[10px] text-slate-500">Guion/título: inicio de escena. Palabras temporizadas: posición en su toma. No verifica lo pronunciado ni autoriza cortes.</p>
    {query.trim() && <>
      <p role="status" aria-live="polite">{pending ? "Buscando…" : `${result.matches.length} coincidencias${result.limited ? " (límite alcanzado; precisa la búsqueda)" : ""}`}</p>
      {result.incomplete && <p className="text-amber-600">El guion supera el presupuesto de búsqueda. Algunas entradas no se indexaron; selecciona una escena para buscar en ella.</p>}
      {scopeMissing && <p className="text-amber-600">Selecciona un ámbito vigente para continuar.</p>}
      {(occurrences.limited || occurrences.invalidSceneIds.length > 0 || occurrences.unsupportedClipIds.length > 0) && <p className="text-amber-600">Algunas palabras temporizadas no están disponibles por límites, tiempos inválidos o transformaciones no compatibles. El guion sigue disponible.</p>}
      <div className="flex gap-2">
        <button type="button" disabled={pending || scopeMissing || !result.matches.length} onClick={() => navigateResult(activeIndex <= 0 ? result.matches.length - 1 : activeIndex - 1)} className="rounded border border-slate-400/30 px-2 py-1 disabled:opacity-50">Anterior</button>
        <button type="button" disabled={pending || scopeMissing || !result.matches.length} onClick={() => navigateResult((activeIndex + 1) % result.matches.length)} className="rounded border border-slate-400/30 px-2 py-1 disabled:opacity-50">Siguiente</button>
        {activeIndex >= 0 && <span role="status">{activeIndex + 1} / {result.matches.length}</span>}
      </div>
      {!scopeMissing && <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Resultados de búsqueda">
        {result.matches.map((match, position) => <li key={match.id}><button type="button" disabled={pending} aria-current={position === activeIndex ? "true" : undefined}
          onClick={() => navigateResult(position)}
          className="w-full rounded border border-slate-400/20 p-2 text-left disabled:opacity-50">
          <span className="block font-semibold">{match.sceneLabel} · {match.field === "TITLE" ? "Título" : match.field === "SCRIPT" ? "Guion" : "Palabras temporizadas"}</span>
          {match.field === "TIMED_WORDS" && <span className="block text-[10px]">Tiempo: {match.navigationSeconds.toFixed(2)} s · vínculo al audio sin verificar{match.tokenRange?.partial ? " · palabra parcialmente recortada" : ""}</span>}
          <span dir="auto">{match.before}<mark>{match.matched}</mark>{match.after}</span>
        </button></li>)}
      </ul>}
      {!pending && !scopeMissing && activeMatch?.tokenRange && activeOccurrence && <CompositionNarrativeRangeControls
        key={`${documentHash}:${activeMatch.id}`} document={document} documentHash={documentHash} draftId={draftId} occurrence={activeOccurrence}
        initialRange={activeMatch.tokenRange} canPreview={canPreviewRange} onPreview={onPreviewRange} onStop={onStopRange} />}
    </>}
  </div>;
}
