import type { CompositionCaptionCue } from "./composition-text-layer.types";
import { DEFAULT_CAPTION_EFFECTS, type CompositionCaptionEffects } from "./composition-caption-effects.types";
import { resolveCompositionCaptionWordGaps } from "./composition-text-presentation";

export { isCaptionTextBoundary, captionEmphasisIssues } from "./composition-caption-text-boundaries";

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

export function resolveCaptionEffects(cue: CompositionCaptionCue, effects?: CompositionCaptionEffects): CompositionCaptionEffects {
  return { ...DEFAULT_CAPTION_EFFECTS, ...effects, ...cue.effects, version: 1 };
}

export function captionHasEffects(cue: CompositionCaptionCue, effects?: CompositionCaptionEffects) {
  return effects !== undefined || cue.effects !== undefined || Boolean(cue.emphasis?.length);
}

export function resolveCaptionWordRanges(cue: CompositionCaptionCue) {
  const gaps = resolveCompositionCaptionWordGaps(cue);
  if (!gaps) return [];
  let cursor = 0;
  return (cue.words || []).map((word, index) => {
    const start = cursor + gaps.prefixes[index]!.length;
    cursor = start + word.text.length;
    return { start, end: cursor, word };
  });
}

/** Editing wording invalidates authored offsets and acoustic alignment together. */
export function invalidateChangedCaptionText(previous: CompositionCaptionCue | undefined, candidate: CompositionCaptionCue): CompositionCaptionCue {
  if (!previous || previous.text === candidate.text) return candidate;
  const { words: _words, emphasis: _emphasis, ...retained } = candidate;
  void _words; void _emphasis;
  return retained;
}

/** Inspector edits retain acoustic times only within the authored phrase window. */
export function retainCaptionCueWordWindow(cue: CompositionCaptionCue): CompositionCaptionCue {
  if (!cue.words) return cue;
  return { ...cue, words: cue.words.flatMap((word) => {
    const startSeconds = Math.max(cue.startSeconds, word.startSeconds);
    const endSeconds = Math.min(cue.endSeconds, word.endSeconds);
    return endSeconds > startSeconds ? [{ ...word, startSeconds, endSeconds }] : [];
  }) };
}

/** A simple selectable token list; preserves punctuation, whitespace and non-Latin text. */
export function captionSelectionTokens(text: string) {
  return [...wordSegmenter.segment(text)].filter((segment) => segment.isWordLike || /\p{Extended_Pictographic}/u.test(segment.segment))
    .map((segment) => ({ start: segment.index, end: segment.index + segment.segment.length, text: segment.segment }));
}
