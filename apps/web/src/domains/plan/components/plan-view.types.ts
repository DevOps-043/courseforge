export interface PlanComponentItem {
  type: string;
  description?: string;
  summary?: string;
  duration?: string;
  [key: string]: unknown;
}

export interface PlanLessonItem {
  lesson_id?: string;
  lesson_order?: number;
  lesson_title: string;
  duration?: string;
  module_index?: number | string;
  module_title?: string;
  learning_objective?: string;
  oa_text?: string;
  bloom_taxonomy_level?: string;
  oa_bloom_verb?: string;
  measurable_criteria?: string;
  alignment_notes?: string;
  components: PlanComponentItem[];
  [key: string]: unknown;
}

export interface PlanModuleGroup {
  title: string;
  index: number;
  key: string;
  lessons: PlanLessonItem[];
}

export interface InstructionalPlanRecord {
  iteration_count?: number;
  lesson_plans: PlanLessonItem[];
  state: string;
  upstream_dirty?: boolean;
  upstream_dirty_source?: string;
  validation?: Record<string, unknown> | null;
  qa_decision?: {
    notes?: string;
  };
  [key: string]: unknown;
}

function isUsableKey(value: unknown): value is string | number {
  return (
    (typeof value === "string" &&
      value.trim() !== "" &&
      value !== "undefined") ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

export function getPlanLessonStableId(
  lesson: PlanLessonItem,
  lessonPosition = 0,
) {
  if (isUsableKey(lesson.lesson_id)) {
    return String(lesson.lesson_id);
  }

  const modulePart = isUsableKey(lesson.module_index)
    ? String(lesson.module_index)
    : lesson.module_title || "module";
  const orderPart = isUsableKey(lesson.lesson_order)
    ? String(lesson.lesson_order)
    : String(lessonPosition + 1);
  const titlePart = lesson.lesson_title || "lesson";

  return `${modulePart}-${orderPart}-${titlePart}-${lessonPosition}`;
}

export function groupPlanModules(lessonPlans: PlanLessonItem[] = []) {
  const grouped = lessonPlans.reduce(
    (accumulator: Record<string, PlanModuleGroup>, lesson) => {
      const moduleTitle = lesson.module_title || "Modulo General";
      const parsedModuleIndex =
        typeof lesson.module_index === "string"
          ? Number.parseInt(lesson.module_index, 10)
          : lesson.module_index;
      const moduleIndex =
        typeof parsedModuleIndex === "number" &&
        Number.isFinite(parsedModuleIndex)
          ? parsedModuleIndex
          : 999;
      const moduleKey =
        moduleIndex === 999 ? `module-${moduleTitle}` : `module-${moduleIndex}`;

      if (!accumulator[moduleKey]) {
        accumulator[moduleKey] = {
          title: moduleTitle,
          index: moduleIndex,
          key: moduleKey,
          lessons: [],
        };
      }

      accumulator[moduleKey].lessons.push(lesson);
      return accumulator;
    },
    {},
  );

  return Object.values(grouped)
    .sort((left, right) => left.index - right.index)
    .map((module) => ({
      ...module,
      lessons: module.lessons.sort(
        (left, right) =>
          (left.lesson_order ?? Number.MAX_SAFE_INTEGER) -
          (right.lesson_order ?? Number.MAX_SAFE_INTEGER),
      ),
    }));
}
