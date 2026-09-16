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

function alternateLayoutsForSlideType(
  type: CourseSlideSpec["type"],
  hasEvidence: boolean,
): CourseSlideLayout[] {
  if (["data_explainer", "cover", "quote", "transition", "summary"].includes(type)) {
    return [];
  }
  if (["objectives", "exercise", "knowledge_check", "diagram"].includes(type)) {
    return hasEvidence ? ["split_reverse", "split"] : ["split", "split_reverse"];
  }
  return hasEvidence ? ["split_reverse", "split"] : ["split", "split_reverse"];
}

function selectLayout(params: {
  assignments: VisualSlideAssignment[];
  hasEvidence: boolean;
  type: CourseSlideSpec["type"];
}) {
  const preferred = layoutForSlideType(params.type, params.hasEvidence);
  const previous = params.assignments.at(-1)?.layout;
  if (previous !== preferred) return preferred;

  const counts = params.assignments.reduce<Partial<Record<CourseSlideLayout, number>>>((totals, assignment) => {
    totals[assignment.layout] = (totals[assignment.layout] || 0) + 1;
    return totals;
  }, {});
  const alternatives = alternateLayoutsForSlideType(params.type, params.hasEvidence)
    .filter((layout) => layout !== previous);
  return alternatives.sort((left, right) => (counts[left] || 0) - (counts[right] || 0))[0] || preferred;
}

export function buildVisualAssignmentMap(slidePlan: SlidePlan): VisualAssignmentMap {
  const assignments = slidePlan.slides.reduce<VisualSlideAssignment[]>((planned, slide) => {
    planned.push({
      layout: selectLayout({
        assignments: planned,
        hasEvidence: slide.sourceRefs.length > 0,
        type: slide.type,
      }),
      purpose: slide.purpose,
      slideId: slide.id,
    });
    return planned;
  }, []);
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
