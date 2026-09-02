"use client";

import type { CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionSceneSummary } from "@/domains/production/composition-editor/composition-scene.service";
import { formatCompositionTimecode } from "@/domains/production/composition-editor/composition-timecode";

export function CompositionNarrativePanel({ document, scenes, currentTime, onSeek, onSelect, applying = false, onApply, onOpenSceneBuilder }: {
  document: CompositionEditorDocument; scenes: CompositionSceneSummary[]; currentTime: number;
  onSeek: (seconds: number) => void; onSelect: (hfId: string) => void;
  applying?: boolean; onApply?: () => void; onOpenSceneBuilder?: () => void;
}) {
  if (!document.narrativeScenes?.length) return null;
  const active = scenes.find((scene) => currentTime >= scene.startSeconds && currentTime < scene.startSeconds + scene.durationSeconds);
  const reviewCount = scenes.filter((scene) => scene.needsReview).length;
  return <section className="flex min-h-full flex-col text-xs" aria-label="Guion y visuales">
    <header className="border-b border-slate-300/20 px-1 pb-3">
      <p className="font-semibold text-slate-900 dark:text-white">Guion y visuales</p>
      <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">{scenes.length} escenas · {reviewCount} por revisar</p>
    </header>
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-300/20 py-3">
      <button type="button" onClick={onOpenSceneBuilder} className="rounded border border-slate-400/30 px-2.5 py-1 font-semibold">Asociar slides</button>
      <button type="button" disabled={applying || scenes.some((scene) => scene.needsReview)} onClick={onApply} className="rounded bg-cyan-700 px-2.5 py-1 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{applying ? "Aplicando…" : "Aplicar preensamble"}</button>
      {reviewCount > 0 && <span className="leading-relaxed text-amber-600 dark:text-amber-300">Revisa cada asociación y guarda las escenas antes de aplicarla.</span>}
    </div>
    <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" aria-label="Correspondencia entre guion y visuales">
      {scenes.map((scene) => {
        const visuals = document.clips.filter((clip) => scene.clipHfIds.includes(clip.hfId) && clip.kind !== "AUDIO");
        return <article key={scene.id} className={`rounded border p-2 ${active?.id === scene.id ? "border-cyan-500 bg-cyan-500/10" : "border-slate-400/20"}`}>
          <div className="grid gap-1"><button type="button" disabled={!scene.primaryHfId} onClick={() => { onSeek(scene.startSeconds); onSelect(scene.primaryHfId); }} className="text-left font-semibold leading-relaxed">{scene.label} · {formatCompositionTimecode(scene.startSeconds)}–{formatCompositionTimecode(scene.startSeconds + scene.durationSeconds)}</button>
            <span className={scene.needsReview || scene.visualsMatch === false ? "text-amber-600 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-300"}>{scene.needsReview ? "Revisar asociación" : scene.visualsMatch === false ? "Preensamble pendiente" : "Visuales asociados"}</span></div>
          {scene.wordCues?.length ? <p className="mt-1 leading-relaxed">{scene.wordCues.map((cue, index) => <button key={index} type="button" onClick={() => onSeek(cue.start)} className={`mr-1 rounded ${currentTime >= cue.start && currentTime < cue.end ? "bg-cyan-600 px-1 text-white" : "hover:underline"}`}>{cue.word}</button>)}</p>
            : <p className="mt-1 whitespace-pre-wrap leading-relaxed">{scene.scriptText}</p>}
          <div className="mt-2 grid gap-2">{visuals.map((clip) => <button key={clip.id} type="button" onClick={() => { onSeek(Math.max(scene.startSeconds, clip.startSeconds)); onSelect(clip.hfId); }} className="w-full rounded border border-slate-400/30 bg-slate-400/5 px-2 py-1 text-left"><span className="block font-semibold">{clip.label}</span><span className="block text-[10px] opacity-70">{clip.kind === "DECK_SLIDE" ? "Slide" : "Video / visual"} · {formatCompositionTimecode(clip.durationSeconds)}</span></button>)}{!visuals.length && <span className="text-amber-600">Sin visual en este intervalo</span>}</div>
        </article>;
      })}
    </div>
  </section>;
}
