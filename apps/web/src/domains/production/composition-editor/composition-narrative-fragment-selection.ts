import type { CompositionEditorDocument } from "./composition-document.types";

/** Same clip membership for registry reads and final planning; no hidden or exclusive-end overlap. */
export function selectNarrativeFragmentClips(document: CompositionEditorDocument, selectedTrackIds: readonly string[],
  startSeconds: number, endSeconds: number) {
  const selected = new Set(selectedTrackIds);
  return document.clips.filter(clip => selected.has(clip.trackId) && !clip.hidden
    && clip.startSeconds < endSeconds && clip.startSeconds + clip.durationSeconds > startSeconds)
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
}
