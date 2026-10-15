import type { CompositionEditorDocument } from "./composition-document.types";

export const NARRATIVE_OCCURRENCE_MAX_TOKENS = 50_000;

export interface NarrativeNavigationToken {
  sourceIndex: number;
  word: string;
  textStart: number;
  textEnd: number;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  timelineStartSeconds: number;
  timelineEndSeconds: number;
  partial: boolean;
}

/** These identities locate a current clip; they do not certify alignment to its asset bytes. */
export interface NarrativeNavigationOccurrence {
  id: string;
  sceneId: string;
  clipId: string;
  hfId: string;
  assetId: string;
  scriptHash: string;
  text: string;
  tokens: readonly NarrativeNavigationToken[];
  provenance: "SCENE_TIMESTAMPS_UNVERIFIED_ASSET_BINDING";
}

export interface NarrativeOccurrenceReport {
  occurrences: readonly NarrativeNavigationOccurrence[];
  invalidSceneIds: readonly string[];
  unsupportedClipIds: readonly string[];
  limited: boolean;
}

/** Read-only, rate-1 projection. Malformed timestamp sequences are rejected as a whole. */
export function deriveNarrativeNavigationOccurrences(document: CompositionEditorDocument): NarrativeOccurrenceReport {
  const occurrences: NarrativeNavigationOccurrence[] = [];
  const invalidSceneIds: string[] = [];
  const unsupportedClipIds: string[] = [];
  const voiceTracks = new Set(document.tracks.filter((track) => !track.hidden && track.semanticRole === "VOICE").map((track) => track.id));
  let remainingTokens = NARRATIVE_OCCURRENCE_MAX_TOKENS;
  for (const scene of document.narrativeScenes || []) {
    const words = scene.wordTimestamps;
    if (!words?.length) continue;
    if (words.length > remainingTokens) return { occurrences, invalidSceneIds, unsupportedClipIds, limited: true };
    remainingTokens -= words.length;
    const invalid = words.some((word, index) => !word.word.trim()
      || !Number.isFinite(word.start) || !Number.isFinite(word.end)
      || word.start < 0 || word.end <= word.start
      || (index > 0 && word.start < words[index - 1]!.end));
    if (invalid) { invalidSceneIds.push(scene.id); continue; }
    for (const clip of document.clips) {
      if (clip.hidden || clip.sceneId !== scene.id || !voiceTracks.has(clip.trackId)) continue;
      if (clip.source.type !== "PRODUCTION_ASSET"
        || (clip.playbackRate ?? 1) !== 1 || clip.freezeTailSeconds !== undefined
        || !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0
        || !Number.isFinite(clip.startSeconds) || clip.startSeconds < 0) {
        unsupportedClipIds.push(clip.id); continue;
      }
      const offset = clip.sourceOffsetSeconds ?? 0;
      const sourceEnd = offset + clip.durationSeconds;
      if (!Number.isFinite(offset) || offset < 0 || (clip.sourceDurationSeconds !== undefined
        && (!Number.isFinite(clip.sourceDurationSeconds) || sourceEnd > clip.sourceDurationSeconds))) {
        unsupportedClipIds.push(clip.id); continue;
      }
      const tokens: NarrativeNavigationToken[] = [];
      let text = "";
      for (let sourceIndex = 0; sourceIndex < words.length; sourceIndex += 1) {
        const word = words[sourceIndex]!;
        if (word.end <= offset || word.start >= sourceEnd) continue;
        if (remainingTokens <= 0) return { occurrences, invalidSceneIds, unsupportedClipIds, limited: true };
        remainingTokens -= 1;
        const sourceStartSeconds = Math.max(offset, word.start);
        const sourceEndSeconds = Math.min(sourceEnd, word.end);
        if (text) text += " ";
        const textStart = text.length;
        text += word.word;
        tokens.push({ sourceIndex, word: word.word, textStart, textEnd: text.length,
          sourceStartSeconds, sourceEndSeconds,
          timelineStartSeconds: clip.startSeconds + sourceStartSeconds - offset,
          timelineEndSeconds: clip.startSeconds + sourceEndSeconds - offset,
          partial: word.start < offset || word.end > sourceEnd });
      }
      if (tokens.length) occurrences.push({
        id: JSON.stringify([scene.id, clip.id, clip.source.productionAssetId]),
        sceneId: scene.id, clipId: clip.id, hfId: clip.hfId, assetId: clip.source.productionAssetId,
        scriptHash: scene.scriptHash, text, tokens,
        provenance: "SCENE_TIMESTAMPS_UNVERIFIED_ASSET_BINDING",
      });
    }
  }
  return { occurrences, invalidSceneIds, unsupportedClipIds, limited: false };
}
