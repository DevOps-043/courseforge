"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import type { CompositionClip } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionColorGrading } from "@/domains/production/composition-editor/composition-color-grading.types";
import {
  fromCompositionColorGradingControlValues,
  NEUTRAL_COMPOSITION_COLOR_GRADING_CONTROLS,
  toCompositionColorGradingControlValues,
  type CompositionColorGradingControlValues,
} from "@/domains/production/composition-editor/composition-color-grading.controls";
import type { CompositionColorGradingRuntimeStatus } from "@/domains/production/composition-editor/composition-preview-protocol";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";

type PatchHandler = (
  operations: CompositionEditorPatchOperation[],
  summary: string,
) => Promise<boolean>;

interface CompositionColorCorrectionControlsProps {
  clip: CompositionClip;
  disabled: boolean;
  onPatch: PatchHandler;
  onPreview: (hfId: string, colorGrading: CompositionColorGrading | null) => void;
  runtimeStatus: CompositionColorGradingRuntimeStatus | null;
}

const CONTROL_FIELDS: Array<{
  key: keyof CompositionColorGradingControlValues;
  label: string;
}> = [
  { key: "brightness", label: "Brillo (exposición)" },
  { key: "contrast", label: "Contraste" },
  { key: "saturation", label: "Saturación" },
];

export function CompositionColorCorrectionControls({
  clip,
  ...props
}: CompositionColorCorrectionControlsProps) {
  const stateKey = `${clip.id}:${JSON.stringify(clip.colorGrading || null)}`;
  return <CompositionColorCorrectionControlState key={stateKey} clip={clip} {...props} />;
}

function CompositionColorCorrectionControlState({
  clip,
  disabled,
  onPatch,
  onPreview,
  runtimeStatus,
}: CompositionColorCorrectionControlsProps) {
  const [values, setValues] = useState(() => toCompositionColorGradingControlValues(clip.colorGrading));
  const [dirty, setDirty] = useState(false);
  const [persisting, setPersisting] = useState(false);
  const baselineRef = useRef<CompositionColorGrading | null>(clip.colorGrading || null);
  const dirtyRef = useRef(false);
  const onPreviewRef = useRef(onPreview);

  useEffect(() => {
    onPreviewRef.current = onPreview;
  }, [onPreview]);

  useEffect(() => {
    return () => {
      if (dirtyRef.current) onPreviewRef.current(clip.hfId, baselineRef.current);
    };
  }, [clip.hfId]);

  const preview = (next: CompositionColorGradingControlValues) => {
    setValues(next);
    dirtyRef.current = true;
    setDirty(true);
    onPreview(clip.hfId, fromCompositionColorGradingControlValues(next) || null);
  };

  const persist = async (colorGrading: CompositionColorGrading | null, summary: string) => {
    const previousBaseline = baselineRef.current;
    dirtyRef.current = false;
    setDirty(false);
    setPersisting(true);
    const saved = await onPatch([{
      clipId: clip.id,
      colorGrading,
      type: "clip.color-grading",
    }], summary);
    setPersisting(false);
    if (saved) {
      baselineRef.current = colorGrading;
      return;
    }

    baselineRef.current = previousBaseline;
    setValues(toCompositionColorGradingControlValues(previousBaseline));
    onPreviewRef.current(clip.hfId, previousBaseline);
  };

  const save = () => persist(
    fromCompositionColorGradingControlValues(values) || null,
    `Ajustó brillo, contraste y saturación de ${clip.label}.`,
  );
  const reset = () => {
    setValues(NEUTRAL_COMPOSITION_COLOR_GRADING_CONTROLS);
    onPreview(clip.hfId, null);
    return persist(null, `Restableció la corrección de color de ${clip.label}.`);
  };
  const statusMessage = resolveStatusMessage(runtimeStatus);
  const runtimeReady = runtimeStatus?.state === "active" || runtimeStatus?.state === "fallback" || runtimeStatus?.state === "inactive";
  const controlsDisabled = disabled || persisting || !runtimeReady;

  return <section className="border-t border-slate-200 pt-3 dark:border-white/10">
    <div className="flex items-center justify-between gap-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Corrección de color</p>
      <span aria-live="polite" className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${dirty ? "bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200" : clip.colorGrading ? "bg-cyan-100 text-cyan-800 dark:bg-cyan-400/10 dark:text-cyan-200" : "bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-gray-400"}`}>
        {dirty ? "Sin guardar" : clip.colorGrading ? "Ajustado" : "Neutro"}
      </span>
    </div>
    <p className="mt-1 text-[10px] leading-4 text-slate-500 dark:text-gray-400">Ajustes no destructivos por clip. Los tres controles usan una escala editorial de −100 a 100.</p>
    <div className="mt-3 space-y-3">
      {CONTROL_FIELDS.map((field) => <ColorControl
        key={field.key}
        disabled={controlsDisabled}
        label={field.label}
        onChange={(value) => preview({ ...values, [field.key]: value })}
        value={values[field.key]}
      />)}
    </div>
    {statusMessage && <p role={runtimeStatus?.state === "unavailable" ? "alert" : undefined} className={`mt-2 rounded-md px-2 py-1.5 text-[10px] leading-4 ${runtimeStatus?.state === "unavailable" ? "bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200" : runtimeStatus?.state === "fallback" ? "bg-cyan-50 text-cyan-800 dark:bg-cyan-400/10 dark:text-cyan-200" : "bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-gray-400"}`}>{statusMessage}</p>}
    <div className="mt-3 flex flex-wrap gap-1.5">
      <button type="button" disabled={controlsDisabled || !dirty} onClick={() => void save()} className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50 dark:bg-cyan-400 dark:text-slate-950"><Save size={12} /> {persisting ? "Guardando…" : "Guardar color"}</button>
      <button type="button" disabled={controlsDisabled || (!dirty && !clip.colorGrading)} onClick={() => void reset()} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[10px] font-bold text-slate-600 disabled:opacity-50 dark:border-white/15 dark:text-gray-300"><RotateCcw size={12} /> Restablecer</button>
    </div>
    {disabled && <p className="mt-2 text-[10px] text-slate-500 dark:text-gray-400">Desbloquea la pista para modificar el color.</p>}
  </section>;
}

function ColorControl({ disabled, label, onChange, value }: {
  disabled: boolean;
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return <label className="block text-[10px] font-medium text-slate-600 dark:text-gray-300">
    <span className="flex items-center justify-between gap-2"><span>{label}</span><span className="font-mono tabular-nums">{value}</span></span>
    <div className="mt-1 flex items-center gap-2">
      <input aria-label={label} type="range" min="-100" max="100" step="1" value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} className="min-w-0 flex-1 accent-cyan-500" />
      <input aria-label={`${label}, valor`} type="number" min="-100" max="100" step="1" value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} className="w-16 rounded-md border border-slate-300 bg-white px-1.5 py-1 text-right font-mono text-[10px] text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white" />
    </div>
  </label>;
}

function resolveStatusMessage(status: CompositionColorGradingRuntimeStatus | null) {
  if (!status) return "Conectando los controles con el preview de color…";
  if (status.state === "active" || status.state === "inactive") return null;
  if (status.state === "fallback") {
    return "Vista previa aproximada de Courseforge. El ajuste guardado se conserva para el render final.";
  }
  if (status.state === "unavailable") {
    return "La corrección en vivo no está disponible. Se muestra el medio original; el ajuste guardado seguirá disponible para render.";
  }
  if (status.state === "pending") return "Preparando la corrección de color del medio…";
  return "No se encontró el medio visual para aplicar la corrección.";
}
