"use client";

import { diagnoseAudioClip } from "@/domains/production/audio-processing/audio-clip-diagnostics";
import type { AudioLoudnessAnalysis } from "@/domains/production/audio-processing/audio-processing.types";
import {
  compositionClipHasConfigurableAudio,
  resolveCompositionClipAudioVolume,
} from "@/domains/production/composition-editor/composition-clip-audio.service";
import type { CompositionClip, CompositionTrack } from "@/domains/production/composition-editor/composition-document.types";

const STATUS_MESSAGES = {
  MEASURED: "Fuente medida. Verifica la mezcla final al exportar.",
  MUTED: "El clip está silenciado por su visibilidad, volumen o pista.",
  PEAK_ABOVE_TARGET: "El pico estimado supera el objetivo de la fuente. Revisa el volumen.",
  REVIEW_SOURCE: "La fuente requiere revisión de nivel antes de exportar.",
  SILENT: "El análisis de la fuente detectó silencio.",
  UNMEASURED: "Esta fuente todavía no tiene medición de loudness y true peak.",
} as const;

export function CompositionAudioDiagnostics({ analysis, clip, track }: {
  analysis?: AudioLoudnessAnalysis;
  clip: CompositionClip | null;
  track: CompositionTrack | undefined;
}) {
  if (!clip || !compositionClipHasConfigurableAudio(clip, track)) return null;
  const effectiveVolume = clip.hidden || track?.hidden ? 0 : resolveCompositionClipAudioVolume(clip, track);
  const diagnostics = diagnoseAudioClip(analysis, effectiveVolume);
  const needsReview = ["PEAK_ABOVE_TARGET", "REVIEW_SOURCE", "SILENT"].includes(diagnostics.status);
  return (
    <section aria-label="Diagnóstico de audio" className="mb-3 space-y-2 rounded-lg border border-slate-200 p-3 text-[11px] dark:border-white/10">
      <p className="font-semibold text-slate-900 dark:text-white">Nivel de audio</p>
      {analysis && <dl className="grid grid-cols-2 gap-2 text-slate-600 dark:text-gray-300">
        <dt>Loudness de la fuente</dt><dd>{formatMeasurement(analysis.integratedLufs, "LUFS")}</dd>
        <dt>True peak de la fuente</dt><dd>{formatMeasurement(analysis.truePeakDbtp, "dBTP")}</dd>
        <dt>Objetivo de la fuente</dt><dd>{analysis.targetIntegratedLufs.toFixed(1)} LUFS ±{analysis.toleranceLu.toFixed(1)} LU</dd>
        <dt>Objetivo de pico</dt><dd>{analysis.targetTruePeakDbtp.toFixed(1)} dBTP</dd>
      </dl>}
      <dl className="grid grid-cols-2 gap-2 text-slate-600 dark:text-gray-300">
        <dt>Volumen efectivo guardado</dt><dd>{Math.round(effectiveVolume * 100)}%</dd>
        <dt>Pico estimado del clip</dt><dd>{formatMeasurement(diagnostics.estimatedTruePeakDbtp, "dBTP")}</dd>
      </dl>
      <p className={needsReview ? "text-amber-700 dark:text-amber-300" : "text-slate-500 dark:text-gray-400"}>{STATUS_MESSAGES[diagnostics.status]}</p>
      {analysis && <p className="text-[10px] leading-4 text-slate-500 dark:text-gray-400">La medición corresponde al archivo completo. El pico estimado aplica el volumen guardado del clip y la pista; recortes, fades, ducking y otras pistas requieren medir la mezcla exportada.</p>}
    </section>
  );
}

function formatMeasurement(value: number | null, unit: string): string {
  return value === null ? "No medible" : `${value.toFixed(1)} ${unit}`;
}
