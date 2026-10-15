import type { CompositionClip } from "./composition-document.types";

/** Caption timestamps are local to each fragment, including karaoke words. */
export function retainCompositionNativeFragment(clip: CompositionClip, startSeconds: number, endSeconds: number): void {
  if (clip.source.type !== "NATIVE_TEXT" && clip.source.type !== "NATIVE_CAPTIONS") return;
  delete clip.sourceOffsetSeconds;
  if (clip.source.type !== "NATIVE_CAPTIONS") return;
  const rebase = (seconds: number) => seconds - startSeconds;
  clip.source.cues = clip.source.cues.flatMap((cue) => {
    const start = Math.max(cue.startSeconds, startSeconds);
    const end = Math.min(cue.endSeconds, endSeconds);
    if (end <= start) return [];
    return [{
      ...cue,
      startSeconds: rebase(start),
      endSeconds: rebase(end),
      ...(cue.words ? { words: cue.words.flatMap((word) => {
        const wordStart = Math.max(word.startSeconds, start);
        const wordEnd = Math.min(word.endSeconds, end);
        return wordEnd > wordStart
          ? [{ ...word, startSeconds: rebase(wordStart), endSeconds: rebase(wordEnd) }]
          : [];
      }) } : {}),
    }];
  });
}
