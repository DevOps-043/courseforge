"use client";

import { useEffect, useMemo, useState } from "react";
import type { AudioWaveformPreview } from "@/domains/production/audio-processing/audio-processing.types";
import type { CompositionStudioAsset } from "./composition-studio.types";
import type { CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";

const MAX_SIMULTANEOUS_READS = 3;

export function useCompositionWaveforms(componentId: string | null, assets: CompositionStudioAsset[], document: CompositionEditorDocument) {
  const audioAssetFingerprint = document.clips.flatMap((clip) => (
    clip.kind === "AUDIO" && clip.source.type === "PRODUCTION_ASSET"
      ? [clip.source.productionAssetId]
      : []
  )).sort().join("|");
  const audioAssetIds = useMemo(() => new Set(audioAssetFingerprint.split("|")), [audioAssetFingerprint]);
  const referenced = useMemo(() => assets.filter((asset) => asset.waveform && audioAssetIds.has(asset.id)), [assets, audioAssetIds]);
  const [waveforms, setWaveforms] = useState<Record<string, AudioWaveformPreview>>({});
  const [failedAssetIds, setFailedAssetIds] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    let nextIndex = 0;
    setWaveforms({});
    setFailedAssetIds([]);
    if (componentId === null) return () => controller.abort();
    const readNext = async () => {
      while (!controller.signal.aborted && nextIndex < referenced.length) {
        const asset = referenced[nextIndex++];
        try {
          const response = await fetch(
            `/api/production/audio-analysis/assets/${encodeURIComponent(asset.id)}/waveform?componentId=${encodeURIComponent(componentId)}`,
            { signal: controller.signal },
          );
          if (!response.ok) throw new Error("AUDIO_WAVEFORM_READ_FAILED");
          const payload = await response.json() as { data?: AudioWaveformPreview };
          if (payload.data && !controller.signal.aborted) {
            setWaveforms((current) => ({ ...current, [asset.id]: payload.data! }));
          }
        } catch {
          if (!controller.signal.aborted) {
            setFailedAssetIds((current) => [...current, asset.id]);
          }
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(MAX_SIMULTANEOUS_READS, referenced.length) }, readNext));
    return () => controller.abort();
  }, [componentId, referenced]);

  return { failedAssetIds, waveforms };
}
