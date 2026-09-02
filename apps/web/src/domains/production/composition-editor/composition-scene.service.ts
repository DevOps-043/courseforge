import type {
  CompositionClip,
  CompositionEditorDocument,
  CompositionTrackRole,
} from "./composition-document.types";

export interface CompositionSceneSummary {
  clipHfIds: string[];
  durationSeconds: number;
  id: string;
  label: string;
  primaryHfId: string;
  roles: CompositionTrackRole[];
  startSeconds: number;
  scriptText?: string;
  needsReview?: boolean;
  wordCues?: Array<{ word: string; start: number; end: number }>;
  visualsMatch?: boolean;
}

function overlaps(clip: CompositionClip, startSeconds: number, endSeconds: number) {
  const clipEnd = clip.startSeconds + clip.durationSeconds;
  return clip.startSeconds < endSeconds && clipEnd > startSeconds;
}

/** Builds scene navigation from the same document used by the timeline. */
export function deriveCompositionScenes(
  document: CompositionEditorDocument,
): CompositionSceneSummary[] {
  const roleByTrackId = new Map(
    document.tracks.map((track) => [track.id, track.semanticRole] as const),
  );
  const hiddenTracks = new Set(document.tracks.filter((track) => track.hidden).map((track) => track.id));
  const visibleClips = document.clips.filter((clip) => !clip.hidden && !hiddenTracks.has(clip.trackId));
  if (document.narrativeScenes?.length) {
    return document.narrativeScenes.map((scene) => {
      const media = visibleClips.filter((clip) => clip.sceneId === scene.id
        && ["VOICE", "AVATAR"].includes(roleByTrackId.get(clip.trackId) || ""));
      const voices = media.filter((clip) => roleByTrackId.get(clip.trackId) === "VOICE");
      const anchors = (voices.length ? voices : media).sort((a, b) => a.startSeconds - b.startSeconds);
      const startSeconds = anchors[0]?.startSeconds || 0;
      const endSeconds = Math.max(startSeconds, ...anchors.map((clip) => clip.startSeconds + clip.durationSeconds));
      const sceneClips = visibleClips.filter((clip) => overlaps(clip, startSeconds, endSeconds));
      const expectedKeys = scene.visualPlan?.slides.map((slide) => slide.key) || [];
      const actualKeys = sceneClips.filter((clip) => clip.source.type === "DECK_SLIDE")
        .sort((a, b) => a.startSeconds - b.startSeconds)
        .map((clip) => clip.source.type === "DECK_SLIDE" ? clip.source.slideKey : undefined);
      const wordCues = voices.flatMap((clip) => (scene.wordTimestamps || []).flatMap((word) => {
        const offset = clip.sourceOffsetSeconds || 0;
        if (word.end <= offset || word.start >= offset + clip.durationSeconds) return [];
        return [{ word: word.word, start: clip.startSeconds + Math.max(0, word.start - offset),
          end: clip.startSeconds + Math.min(clip.durationSeconds, word.end - offset) }];
      }));
      return {
        id: scene.id, label: scene.label, scriptText: scene.scriptText,
        startSeconds, durationSeconds: endSeconds - startSeconds,
        primaryHfId: anchors[0]?.hfId || "",
        clipHfIds: sceneClips.map((clip) => clip.hfId),
        roles: [...new Set(sceneClips.flatMap((clip) => { const role = roleByTrackId.get(clip.trackId); return role ? [role] : []; }))],
        needsReview: scene.needsReview || !anchors.length,
        visualsMatch: JSON.stringify(expectedKeys) === JSON.stringify(actualKeys),
        wordCues,
      };
    });
  }
  const deckAnchors = visibleClips.filter((clip) => clip.kind === "DECK_SLIDE");
  const rolePriority: CompositionTrackRole[] = ["AVATAR", "VOICE", "BROLL", "VISUAL"];
  const fallbackRole = rolePriority.find((role) =>
    visibleClips.some((clip) => roleByTrackId.get(clip.trackId) === role),
  );
  const anchors = (deckAnchors.length > 0
    ? deckAnchors
    : visibleClips.filter((clip) => roleByTrackId.get(clip.trackId) === fallbackRole))
    .sort((left, right) => left.startSeconds - right.startSeconds || left.id.localeCompare(right.id));

  return anchors.map((anchor, index) => {
    const startSeconds = anchor.startSeconds;
    const endSeconds = startSeconds + anchor.durationSeconds;
    const sceneClips = visibleClips.filter((clip) => overlaps(clip, startSeconds, endSeconds));
    const roles = Array.from(new Set(sceneClips.flatMap((clip) => {
      const role = roleByTrackId.get(clip.trackId);
      return role ? [role] : [];
    })));
    return {
      clipHfIds: sceneClips.map((clip) => clip.hfId),
      durationSeconds: anchor.durationSeconds,
      id: `scene-${anchor.id}`,
      label: `Escena ${index + 1}`,
      primaryHfId: anchor.hfId,
      roles,
      startSeconds,
    };
  });
}
