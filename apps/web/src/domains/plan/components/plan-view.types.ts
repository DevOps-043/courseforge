export interface PlanComponentItem {
  type: string;
  description?: string;
  summary?: string;
  duration?: string;
  [key: string]: any;
}

export interface PlanLessonItem {
  lesson_id: string;
  lesson_order?: number;
  lesson_title: string;
  duration?: string;
  module_index?: number;
  module_title?: string;
  learning_objective?: string;
  oa_text?: string;
  bloom_taxonomy_level?: string;
  oa_bloom_verb?: string;
  measurable_criteria?: string;
  alignment_notes?: string;
  components: PlanComponentItem[];
  [key: string]: any;
}

export interface PlanModuleGroup {
  title: string;
  index: number;
  lessons: PlanLessonItem[];
}

export interface InstructionalPlanRecord {
  iteration_count?: number;
  lesson_plans: PlanLessonItem[];
  state: string;
  upstream_dirty?: boolean;
  upstream_dirty_source?: string;
  validation?: any;
  qa_decision?: {
    notes?: string;
  };
  [key: string]: any;
}

export function groupPlanModules(lessonPlans: PlanLessonItem[] = []) {
  const grouped = lessonPlans.reduce(
    (accumulator: Record<number, PlanModuleGroup>, lesson) => {
      const moduleTitle = lesson.module_title || "Módulo General";
      const moduleIndex = lesson.module_index ?? 999;

      if (!accumulator[moduleIndex]) {
        accumulator[moduleIndex] = {
          title: moduleTitle,
          index: moduleIndex,
          lessons: [],
        };
      }

      accumulator[moduleIndex].lessons.push(lesson);
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
