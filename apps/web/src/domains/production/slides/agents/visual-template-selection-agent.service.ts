import type { CourseSlideSpec } from "../specs/course-deck.schema";
import type { SlidePlan } from "./slide-strategy-agent.service";

export type CourseSlideLayout = NonNullable<CourseSlideSpec["renderHints"]>["layout"];

export interface VisualSlideAssignment {
  layout: CourseSlideLayout;
  purpose: string;
  slideId: string;
}

export interface VisualAssignmentMap {
  assignments: VisualSlideAssignment[];
  layoutCounts: Record<CourseSlideLayout, number>;
}

function layoutForSlideType(type: CourseSlideSpec["type"], hasEvidence: boolean): CourseSlideLayout {
  if (type === "data_explainer") {
    return "data";
  }
  if (type === "cover" || type === "quote" || type === "transition") {
    return "center";
  }
  if (type === "summary") {
    return "closing";
  }
  if (["objectives", "exercise", "knowledge_check", "diagram"].includes(type)) {
    return "framework";
  }
  if (hasEvidence && type === "worked_example") {
    return "split_reverse";
  }
  return "split";
}

export function buildVisualAssignmentMap(slidePlan: SlidePlan): VisualAssignmentMap {
  const assignments = slidePlan.slides.map((slide): VisualSlideAssignment => ({
    layout: layoutForSlideType(slide.type, slide.sourceRefs.length > 0),
    purpose: slide.purpose,
    slideId: slide.id,
  }));
  const layoutCounts = assignments.reduce<Record<CourseSlideLayout, number>>(
    (totals, assignment) => {
      totals[assignment.layout] += 1;
      return totals;
    },
    {
      center: 0,
      closing: 0,
      data: 0,
      framework: 0,
      split: 0,
      split_reverse: 0,
    },
  );

  return {
    assignments,
    layoutCounts,
  };
}

export function visualAssignmentForSlide(
  visualAssignments: VisualAssignmentMap,
  slideId: string,
): VisualSlideAssignment | undefined {
  return visualAssignments.assignments.find((assignment) => assignment.slideId === slideId);
}
