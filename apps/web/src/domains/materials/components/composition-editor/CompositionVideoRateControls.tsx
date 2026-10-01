"use client";

import { useEffect, useState } from "react";
import type { CompositionClip, CompositionTrack } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";
import { COMPOSITION_VIDEO_PLAYBACK_RATES, videoRateSourceWindowFits } from "@/domains/production/composition-editor/composition-video-rate";
import { areCompositionVideoRatesEnabled } from "@/domains/production/composition-editor/composition-advanced-capabilities";

export function CompositionVideoRateControls({ clip, disabled, onPatch, track }: {
  clip: CompositionClip;
  disabled: boolean;
  onPatch: (operations: CompositionEditorPatchOperation[], summary: string) => Promise<boolean>;
  track: CompositionTrack | null;
}) {
  const [rate, setRate] = useState(clip.playbackRate || 1);
  useEffect(() => setRate(clip.playbackRate || 1), [clip.id, clip.playbackRate]);
  if (clip.kind !== "VIDEO" || clip.source.type !== "PRODUCTION_ASSET"
    || clip.source.hasAudio !== false || !clip.sourceDurationSeconds || clip.sceneId !== undefined
    || (track?.semanticRole !== "BROLL" && track?.semanticRole !== "VISUAL")) return null;

  const sourceDurationSeconds = clip.sourceDurationSeconds;
  const rates = COMPOSITION_VIDEO_PLAYBACK_RATES.filter((candidate) => (
    candidate === 1 || (candidate === clip.playbackRate)
    || (areCompositionVideoRatesEnabled() && clip.freezeTailSeconds === undefined && videoRateSourceWindowFits({
    clipDurationSeconds: clip.durationSeconds,
    playbackRate: candidate,
    sourceDurationSeconds,
    sourceOffsetSeconds: clip.sourceOffsetSeconds || 0,
    }))
  ));

  return <section className="border-t border-slate-200 pt-3 dark:border-white/10">
    <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500" htmlFor={`rate-${clip.id}`}>Velocidad del video · experimental</label>
    <select
      id={`rate-${clip.id}`}
      value={rate}
      disabled={disabled || clip.freezeTailSeconds !== undefined}
      onChange={(event) => {
        const selected = COMPOSITION_VIDEO_PLAYBACK_RATES.find((candidate) => candidate === Number(event.target.value));
        if (selected !== undefined) setRate(selected);
      }}
      className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs dark:border-white/10 dark:bg-slate-950 dark:text-white"
    >
      {rates.map((candidate) => <option key={candidate} value={candidate}>{candidate}×</option>)}
    </select>
    <p className="mt-1 text-[10px] leading-4 text-slate-500 dark:text-gray-400">Solo B-roll sin audio. Conserva la duración del clip; el rango consumido de la fuente cambia. Restablece a 1× antes de cortar o recortar.</p>
    <button
      type="button"
      disabled={disabled || rate === (clip.playbackRate || 1)}
      onClick={() => void onPatch([{ clipId: clip.id, playbackRate: rate, type: "clip.playback-rate" }], `Ajustó la velocidad de ${clip.label} a ${rate}×.`)}
      className="mt-2 rounded border border-cyan-200 px-2 py-1 text-[10px] font-bold text-cyan-800 disabled:opacity-50 dark:border-cyan-400/30 dark:text-cyan-200"
    >Guardar velocidad</button>
  </section>;
}
