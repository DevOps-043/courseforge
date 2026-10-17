"use client";

import type { CompositionClip, CompositionTrack } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";
import { resolveVideoFreezeTailSeconds } from "@/domains/production/composition-editor/composition-video-freeze";

export function CompositionVideoFreezeControls({ clip, disabled, onPatch, track }: {
  clip: CompositionClip;
  disabled: boolean;
  onPatch: (operations: CompositionEditorPatchOperation[], summary: string) => Promise<boolean>;
  track: CompositionTrack | null;
}) {
  if (clip.kind !== "VIDEO" || clip.source.type !== "PRODUCTION_ASSET"
    || clip.source.hasAudio !== false || !clip.sourceDurationSeconds || clip.sceneId !== undefined
    || (track?.semanticRole !== "BROLL" && track?.semanticRole !== "VISUAL")) return null;

  const tailSeconds = resolveVideoFreezeTailSeconds({
    clipDurationSeconds: clip.durationSeconds,
    sourceDurationSeconds: clip.sourceDurationSeconds,
    sourceOffsetSeconds: clip.sourceOffsetSeconds || 0,
  });
  const enabled = clip.freezeTailSeconds !== undefined;
  return <section className="border-t border-slate-200 pt-3 dark:border-white/10">
    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Último frame · experimental</p>
    <p className="mt-1 text-[10px] leading-4 text-slate-500 dark:text-gray-400">
      {tailSeconds === null ? "Deja que el clip exceda el final de la fuente entre 0 y 3 segundos para congelar su último frame." : `Cola disponible: ${tailSeconds.toFixed(2)} s. La duración del clip no cambia.`}
    </p>
    <button type="button" disabled={disabled || (!enabled && (tailSeconds === null || clip.playbackRate !== undefined))}
      onClick={() => void onPatch([{ clipId: clip.id, enabled: !enabled, type: "clip.freeze-tail" }], `${enabled ? "Desactivó" : "Activó"} la congelación de ${clip.label}.`)}
      className="mt-2 rounded border border-cyan-200 px-2 py-1 text-[10px] font-bold text-cyan-800 disabled:opacity-50 dark:border-cyan-400/30 dark:text-cyan-200">
      {enabled ? "Volver al loop" : "Congelar último frame"}
    </button>
  </section>;
}
