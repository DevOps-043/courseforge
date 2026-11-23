"use client";

import { EngineSelect } from "@/components/ui/EngineSelect";
import { CompositionAutosaveBoundary } from "./CompositionAutosaveBoundary";

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

  return <CompositionAutosaveBoundary key={clip.id} value={rate} onCommit={() => onPatch([{ clipId: clip.id, playbackRate: rate, type: "clip.playback-rate" }], `Ajustó la velocidad de ${clip.label} a ${rate}×.`)} disabled={disabled}><section className="border-t border-slate-200 pt-3 dark:border-white/10">
    <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500" htmlFor={`rate-${clip.id}`}>Velocidad del video · experimental</label>
    <EngineSelect
      id={`rate-${clip.id}`}
      disabled={disabled || clip.freezeTailSeconds !== undefined}
      className="mt-1"
      size="compact"
      value={String(rate)}
      onValueChange={(nextValue) => {
        const selected = COMPOSITION_VIDEO_PLAYBACK_RATES.find((candidate) => candidate === Number(nextValue));
        if (selected !== undefined) setRate(selected);
      }}
      options={rates.map((candidate) => ({ value: String(candidate), label: `${candidate}×` }))}
    />
    <p className="mt-1 text-[10px] leading-4 text-slate-500 dark:text-gray-400">Solo B-roll sin audio. Conserva la duración del clip; el rango consumido de la fuente cambia. Restablece a 1× antes de cortar o recortar.</p>

  </section></CompositionAutosaveBoundary>;
}
