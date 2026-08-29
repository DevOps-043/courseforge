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
  const visibleClips = document.clips.filter((clip) => !clip.hidden);
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
