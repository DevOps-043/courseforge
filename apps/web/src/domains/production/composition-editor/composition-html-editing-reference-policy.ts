import type { CompositionEditorDocument } from "./composition-document.types";

/** Generic native edits may remove a clip, but cannot add/retarget/drop its HTML
 * pointer while that clip remains. Dedicated revision CAS owns those changes. */
export function preservesCompositionHtmlRevisionReferences(before: CompositionEditorDocument, after: CompositionEditorDocument): boolean {
  const prior = new Map((before.htmlEditing?.items || []).map(reference => [reference.clipId, reference]));
  const next = new Map((after.htmlEditing?.items || []).map(reference => [reference.clipId, reference]));
  for (const reference of prior.values()) {
    if (after.clips.some(clip => clip.id === reference.clipId) && !next.has(reference.clipId)) return false;
  }
  for (const reference of next.values()) {
    const previous = prior.get(reference.clipId);
    const beforeClip = before.clips.find(clip => clip.id === reference.clipId);
    const afterClip = after.clips.find(clip => clip.id === reference.clipId);
    if (!previous || Object.entries(previous).some(([key, value]) => reference[key as keyof typeof reference] !== value)
      || beforeClip?.source.type !== "DECK_SLIDE" || afterClip?.source.type !== "DECK_SLIDE"
      || beforeClip.source.html !== afterClip.source.html) return false;
  }
  return true;
}
