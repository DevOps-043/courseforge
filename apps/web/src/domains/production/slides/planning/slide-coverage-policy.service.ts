/**
 * Single coverage contract for script-backed decks. The same target is carried
 * into the spec and validated by QA, so the planner can always satisfy it.
 */
export const MAX_SLIDES_PER_DECK = 24;

export interface ScriptCoverageSection {
  visibleBeatCount?: number;
}

export interface ScriptSlideSegment {
  part: number;
  sectionIndex: number;
  totalParts: number;
}

export function targetSlideCountForScript(sections: ScriptCoverageSection[]) {
  // Duration is useful to plan the video, but must not force repeated visual
  // copy or leak avatar narration. A script section is the smallest approved
  // semantic beat for a slide, with the cover included.
  const supportingSlides = sections.reduce(
    (total, section) => total + Math.min(Math.max(section.visibleBeatCount || 1, 1), 3),
    0,
  );
  return Math.min(Math.max(supportingSlides + 1, 1), MAX_SLIDES_PER_DECK);
}

/** Builds one to three slides from explicit visual beats; never from narration. */
export function buildScriptSlideSegments(sections: ScriptCoverageSection[]): ScriptSlideSegment[] {
  let remaining = MAX_SLIDES_PER_DECK - 1;
  return sections.flatMap((section, sectionIndex) => {
    const totalParts = Math.min(Math.max(section.visibleBeatCount || 1, 1), 3, remaining);
    remaining -= totalParts;
    return Array.from({ length: totalParts }, (_, partIndex) => ({
      part: partIndex + 1,
      sectionIndex,
      totalParts,
    }));
  });
}
