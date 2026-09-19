"use client";

import { Plus, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import {
  listCompositionTransitionEditPoints,
  resolveCompositionTransitionEligibility,
  type CompositionTransitionEditPoint,
} from "@/domains/production/composition-editor/composition-transition.service";
import {
  COMPOSITION_TRANSITION_ALIGNMENTS,
  COMPOSITION_TRANSITION_DIRECTIONS,
  COMPOSITION_TRANSITION_EASES,
  COMPOSITION_TRANSITION_TYPES,
  type CompositionTransition,
} from "@/domains/production/composition-editor/composition-transition.types";

export type CompositionTransitionUpdateSettings = Partial<Pick<
  CompositionTransition,
  "alignment" | "audioMode" | "durationSeconds" | "easing" | "type"
>> & { parameters?: CompositionTransition["parameters"] | null };

interface TransitionControlsProps {
  document: CompositionEditorDocument;
  onAdd: (transition: CompositionTransition) => void;
  onRemove: (transitionId: string) => void;
  onSelect: (transitionId: string | null) => void;
  onUpdate: (transitionId: string, settings: CompositionTransitionUpdateSettings) => void;
  saving: boolean;
  selectedTransitionId: string | null;
}

const TYPE_LABELS: Record<CompositionTransition["type"], string> = {
  BLUR_DISSOLVE: "Disolvencia con blur",
  CROSS_DISSOLVE: "Disolvencia",
  DIP_TO_COLOR: "Fundido a color",
  PUSH: "Empuje",
  SOFT_WIPE: "Barrido suave",
};

const ALIGNMENT_LABELS: Record<CompositionTransition["alignment"], string> = {
  CENTER_AT_CUT: "Centrada en el corte",
  END_AT_CUT: "Termina en el corte",
  START_AT_CUT: "Empieza en el corte",
};

export function TransitionControls({ document, onAdd, onRemove, onSelect, onUpdate, saving, selectedTransitionId }: TransitionControlsProps) {
  const editPoints = useMemo(() => listCompositionTransitionEditPoints(document), [document]);
  const emptyPoints = editPoints.filter((point) => !point.existingTransitionId);
  const [selectedCutKey, setSelectedCutKey] = useState<string>("");
  const selected = document.transitions?.items.find((transition) => transition.id === selectedTransitionId) || null;
  const selectedPoint = selected
    ? editPoints.find((point) => point.existingTransitionId === selected.id) || null
    : null;
  const selectedCandidate = emptyPoints.find((point) => cutKey(point) === selectedCutKey) || emptyPoints[0] || null;
  const candidateDefault = selectedCandidate ? buildDefaultTransition(document, selectedCandidate, "candidate-transition") : null;
  const candidateBlocker = selectedCandidate && !candidateDefault
    ? resolveCompositionTransitionEligibility({
        document,
        transition: buildTransitionProbe(document, selectedCandidate, "candidate-transition", "CENTER_AT_CUT"),
      }).issues[0]?.message || "Este corte no cumple las condiciones de transición."
    : null;
  const currentEligibility = selected
    ? resolveCompositionTransitionEligibility({ document, excludeTransitionId: selected.id, transition: selected })
    : null;
  const crossfadeAvailable = selected
    ? !resolveCompositionTransitionEligibility({
        document,
        excludeTransitionId: selected.id,
        transition: { ...selected, audioMode: "CROSSFADE" },
      }).issues.some((issue) => issue.code === "AUDIO_CROSSFADE_UNAVAILABLE")
    : false;

  const addTransition = () => {
    if (!selectedCandidate || !candidateDefault) return;
    const transition = buildDefaultTransition(
      document,
      selectedCandidate,
      `transition-${crypto.randomUUID()}`,
    );
    if (!transition) return;
    onAdd(transition);
    onSelect(transition.id);
  };

  const updateType = (type: CompositionTransition["type"]) => {
    if (!selected) return;
    onUpdate(selected.id, { parameters: defaultParameters(type), type });
  };

  const updateAlignment = (alignment: CompositionTransition["alignment"]) => {
    if (!selected) return;
    const probe = resolveCompositionTransitionEligibility({
      document,
      excludeTransitionId: selected.id,
      transition: { ...selected, alignment },
    });
    const durationSeconds = quantizeDuration(
      Math.min(selected.durationSeconds, probe.maximumDurationSeconds),
      document.canvas.fps,
    );
    onUpdate(selected.id, { alignment, durationSeconds });
  };

  return <div aria-label="Transiciones entre clips" className="space-y-3 text-[10px] text-slate-800 dark:text-cyan-50">
    <section className="space-y-2 rounded-lg border border-cyan-200 bg-cyan-50 p-3 dark:border-cyan-400/25 dark:bg-cyan-400/10">
      <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wide"><Sparkles size={12} /> Nueva transición</span>
      <Field label="Corte entre clips"><select
        aria-label="Corte donde añadir una transición"
        className="w-full rounded border border-cyan-200 bg-white px-2 py-1.5 dark:border-white/15 dark:bg-[#101720]"
        disabled={saving || emptyPoints.length === 0}
        onChange={(event) => setSelectedCutKey(event.target.value)}
        value={selectedCandidate ? cutKey(selectedCandidate) : ""}
      >
        {emptyPoints.length === 0 && <option value="">No hay cortes disponibles</option>}
        {emptyPoints.map((point) => <option key={cutKey(point)} value={cutKey(point)}>{formatEditPoint(point)}</option>)}
      </select></Field>
      <button type="button" disabled={saving || !candidateDefault} onClick={addTransition} className="inline-flex w-full items-center justify-center gap-1 rounded border border-cyan-300 bg-white px-2 py-1.5 font-bold disabled:opacity-40 dark:border-cyan-300/30 dark:bg-white/10"><Plus size={12} /> Añadir transición</button>
    </section>
    {(document.transitions?.items.length || 0) > 0 && <Field label="Transición a editar"><select aria-label="Transición a editar" className="w-full rounded border border-cyan-200 bg-white px-2 py-1.5 dark:border-white/15 dark:bg-[#101720]" onChange={(event) => onSelect(event.target.value || null)} value={selected?.id || ""}>
      <option value="">Selecciona una transición…</option>
      {document.transitions?.items.map((transition) => {
        const point = editPoints.find((candidate) => candidate.existingTransitionId === transition.id);
        return <option key={transition.id} value={transition.id}>{TYPE_LABELS[transition.type]}{point ? ` · ${formatClock(point.cutSeconds)}` : ""}</option>;
      })}
    </select></Field>}
    {candidateBlocker && <p role="status" className="text-[9px] text-amber-700 dark:text-amber-200">{candidateBlocker}</p>}

    {selected && selectedPoint && <div className="grid gap-3 rounded-lg border border-cyan-200/80 bg-white/80 p-3 dark:border-white/10 dark:bg-black/10">
      <Field label="Efecto"><select value={selected.type} disabled={saving} onChange={(event) => updateType(event.target.value as CompositionTransition["type"])} className={inputClass}>{COMPOSITION_TRANSITION_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}</select></Field>
      <Field label="Alineación"><select value={selected.alignment} disabled={saving} onChange={(event) => updateAlignment(event.target.value as CompositionTransition["alignment"])} className={inputClass}>{COMPOSITION_TRANSITION_ALIGNMENTS.map((alignment) => <option key={alignment} value={alignment}>{ALIGNMENT_LABELS[alignment]}</option>)}</select></Field>
      <Field label={`Duración · máx. ${currentEligibility?.maximumDurationSeconds.toFixed(2) || "0.00"} s`}><input type="number" min={1 / document.canvas.fps} max={currentEligibility?.maximumDurationSeconds || selected.durationSeconds} step={1 / document.canvas.fps} value={selected.durationSeconds} disabled={saving} onChange={(event) => onUpdate(selected.id, { durationSeconds: quantizeDuration(Math.min(Number(event.target.value), currentEligibility?.maximumDurationSeconds || selected.durationSeconds), document.canvas.fps) })} className={inputClass} /></Field>
      <Field label="Curva"><select value={selected.easing} disabled={saving} onChange={(event) => onUpdate(selected.id, { easing: event.target.value as CompositionTransition["easing"] })} className={inputClass}>{COMPOSITION_TRANSITION_EASES.map((easing) => <option key={easing} value={easing}>{easing}</option>)}</select></Field>
      <Field label="Audio"><select value={selected.audioMode} disabled={saving} onChange={(event) => onUpdate(selected.id, { audioMode: event.target.value as CompositionTransition["audioMode"] })} className={inputClass}><option value="CUT">Corte</option><option value="CROSSFADE" disabled={!crossfadeAvailable}>Crossfade</option></select></Field>
      <div className="flex items-end"><button type="button" disabled={saving} onClick={() => { onSelect(null); onRemove(selected.id); }} className="inline-flex w-full items-center justify-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1.5 font-bold text-red-700 disabled:opacity-40 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200"><Trash2 size={12} /> Quitar</button></div>
      {selected.type === "DIP_TO_COLOR" && <Field label="Color"><input type="color" value={selected.parameters?.color || "#000000"} disabled={saving} onChange={(event) => onUpdate(selected.id, { parameters: { color: event.target.value } })} className={inputClass} /></Field>}
      {(selected.type === "PUSH" || selected.type === "SOFT_WIPE") && <Field label="Dirección"><select value={selected.parameters?.direction || "LEFT"} disabled={saving} onChange={(event) => onUpdate(selected.id, { parameters: { direction: event.target.value as NonNullable<CompositionTransition["parameters"]>["direction"] } })} className={inputClass}>{COMPOSITION_TRANSITION_DIRECTIONS.map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></Field>}
      {selected.type === "BLUR_DISSOLVE" && <Field label="Desenfoque"><input type="number" min={0} max={40} step={1} value={selected.parameters?.blurPixels ?? 12} disabled={saving} onChange={(event) => onUpdate(selected.id, { parameters: { blurPixels: Number(event.target.value) } })} className={inputClass} /></Field>}
      <p className="self-end text-[9px] leading-4 text-slate-500 dark:text-cyan-100/70">{formatEditPoint(selectedPoint)} · el efecto ocupa ambos clips; no es una animación de entrada o salida.</p>
      {!crossfadeAvailable && <p className="self-end text-[9px] leading-4 text-amber-700 dark:text-amber-200">Crossfade disponible solo cuando ambos videos confirman una pista de audio.</p>}
    </div>}
    {!selected && (document.transitions?.items.length || 0) > 0 && <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-[10px] leading-4 text-slate-500 dark:border-white/15 dark:text-gray-400">Selecciona una transición aquí o desde el marcador ↔ del timeline para editarla.</p>}
  </div>;
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return <label className="space-y-1"><span className="block font-bold text-slate-500 dark:text-cyan-100/70">{label}</span>{children}</label>;
}

function buildDefaultTransition(document: CompositionEditorDocument, point: CompositionTransitionEditPoint, id: string): CompositionTransition | null {
  for (const alignment of COMPOSITION_TRANSITION_ALIGNMENTS) {
    const probe = buildTransitionProbe(document, point, id, alignment);
    const eligibility = resolveCompositionTransitionEligibility({ document, transition: probe });
    if (!eligibility.available) continue;
    return {
      ...probe,
      durationSeconds: quantizeDuration(Math.min(0.4, eligibility.maximumDurationSeconds), document.canvas.fps),
    };
  }
  return null;
}

function buildTransitionProbe(
  document: CompositionEditorDocument,
  point: CompositionTransitionEditPoint,
  id: string,
  alignment: CompositionTransition["alignment"],
): CompositionTransition {
  return {
    alignment,
    audioMode: "CUT",
    durationSeconds: 1 / document.canvas.fps,
    easing: "sine.inOut",
    fromClipId: point.fromClip.id,
    id,
    origin: "USER",
    toClipId: point.toClip.id,
    type: "CROSS_DISSOLVE",
  };
}

function defaultParameters(type: CompositionTransition["type"]): CompositionTransition["parameters"] | null {
  if (type === "DIP_TO_COLOR") return { color: "#000000" };
  if (type === "PUSH" || type === "SOFT_WIPE") return { direction: "LEFT" };
  if (type === "BLUR_DISSOLVE") return { blurPixels: 12 };
  return null;
}

function quantizeDuration(value: number, fps: number) {
  if (!Number.isFinite(value)) return 1 / fps;
  return Math.max(1 / fps, Math.round(value * fps) / fps);
}

function cutKey(point: CompositionTransitionEditPoint) {
  return `${point.fromClip.id}:${point.toClip.id}`;
}

function formatEditPoint(point: CompositionTransitionEditPoint) {
  return `${point.fromClip.label} → ${point.toClip.label} · ${formatClock(point.cutSeconds)}`;
}

function formatClock(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const inputClass = "w-full rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-800 disabled:opacity-50 dark:border-white/15 dark:bg-[#101720] dark:text-white";
