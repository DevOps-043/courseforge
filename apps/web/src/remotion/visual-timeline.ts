import type { AssemblyBrollClip } from "./types";

export interface BrollTimelineItem {
  clip: AssemblyBrollClip;
  startFrame: number;
  durationInFrames: number;
}

export function buildBrollTimeline(
  clips: AssemblyBrollClip[],
  totalDurationInFrames: number,
): BrollTimelineItem[] {
  if (clips.length === 0 || totalDurationInFrames <= 0) {
    return [];
  }

  const ordered = [...clips].sort((left, right) => left.order - right.order);
  const totalClipFrames = ordered.reduce(
    (sum, clip) => sum + clip.durationInFrames,
    0,
  );
  const availableGapFrames = Math.max(0, totalDurationInFrames - totalClipFrames);
  const gapFrames =
    availableGapFrames > 0
      ? Math.floor(availableGapFrames / (ordered.length + 1))
      : 0;

  const items: BrollTimelineItem[] = [];
  let cursor = gapFrames;

  for (const clip of ordered) {
    if (cursor >= totalDurationInFrames) {
      break;
    }

    const remainingFrames = totalDurationInFrames - cursor;
    const durationInFrames = Math.min(clip.durationInFrames, remainingFrames);

    if (durationInFrames > 0) {
      items.push({
        clip,
        startFrame: cursor,
        durationInFrames,
      });
    }

    cursor += durationInFrames + gapFrames;
  }

  return items;
}
