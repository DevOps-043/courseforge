export interface AudioReplacementRecord {
  id: string;
  asset_type: string;
  provider: string;
  material_component_id: string | null;
  mime_type: string | null;
  metadata: Record<string, unknown> | null;
}

/** Only a derivative of the same source may bypass the generic paired-scene replacement guard. */
export function isRelatedAudioProcessingReplacement(current: AudioReplacementRecord, replacement: AudioReplacementRecord): boolean {
  if (!current.material_component_id || current.material_component_id !== replacement.material_component_id
    || !current.mime_type?.startsWith("audio/") || !replacement.mime_type?.startsWith("audio/")) return false;
  const derivedFrom = (derived: AudioReplacementRecord, original: AudioReplacementRecord) => {
    const analysis = derived.metadata?.audio_analysis as { passed?: unknown } | undefined;
    return derived.asset_type === "PROCESSED_AUDIO" && derived.provider === "ffmpeg"
      && derived.metadata?.source_asset_id === original.id && analysis?.passed === true;
  };
  return derivedFrom(replacement, current) || derivedFrom(current, replacement);
}
