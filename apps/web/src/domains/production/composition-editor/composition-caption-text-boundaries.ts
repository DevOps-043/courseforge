import type { CompositionCaptionEmphasis } from "./composition-caption-effects.types";

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** UTF-16 offsets match textarea selections, but boundaries must preserve full graphemes. */
export function isCaptionTextBoundary(text: string, index: number) {
  return index === text.length || [...graphemeSegmenter.segment(text)].some((segment) => segment.index === index);
}

export function captionEmphasisIssues(text: string, ranges: CompositionCaptionEmphasis[]) {
  const ordered = [...ranges].sort((left, right) => left.start - right.start);
  const boundaries = new Set([...graphemeSegmenter.segment(text)].map((segment) => segment.index));
  boundaries.add(text.length);
  return ordered.some((range, index) => !boundaries.has(range.start) || !boundaries.has(range.end)
    || (index > 0 && range.start < ordered[index - 1]!.end));
}
