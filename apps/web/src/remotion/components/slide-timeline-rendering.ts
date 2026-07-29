import { getSlideItemLayerId } from "../layout-override-styles";
import type { AssemblySlide } from "../types";
import type { VisualTimelineSegment } from "../visual-timeline";

export interface SlideTimelineRenderItem {
  slide: AssemblySlide;
  segment: VisualTimelineSegment;
}

function getSlidePositionKey(slide: AssemblySlide, position: number) {
  return Math.max(0, Math.round(slide.index ?? position));
}

export function resolveSlideTimelineRenderItems(
  slides: AssemblySlide[],
  segments: VisualTimelineSegment[] | null | undefined,
): SlideTimelineRenderItem[] {
  if (!segments || segments.length === 0) {
    return [];
  }

  const orderedSlides = [...slides].sort((left, right) => left.index - right.index);
  const segmentById = new Map(segments.map((segment) => [segment.id, segment] as const));
  const segmentByLayerId = new Map(
    segments.flatMap((segment) => (segment.layerId ? [[segment.layerId, segment] as const] : [])),
  );

  return orderedSlides.flatMap((slide, position) => {
    const slideKey = getSlidePositionKey(slide, position);
    const segment =
      segmentById.get(`slide-${slideKey}`) ||
      segmentByLayerId.get(getSlideItemLayerId(slideKey));

    return segment ? [{ slide, segment }] : [];
  });
}
