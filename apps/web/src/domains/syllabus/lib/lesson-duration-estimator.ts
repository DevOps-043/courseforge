import {
  DEFAULT_VIDEO_DURATION_POLICY,
  resolveVideoDurationPolicy,
} from "../../video-duration/video-duration-policy";
import type {
  SyllabusLesson,
  SyllabusModule,
} from "../types/syllabus.types";

export type LessonComplexity =
  | "FOUNDATIONAL"
  | "APPLIED"
  | "ANALYTICAL"
  | "CREATIVE";

export const LESSON_DURATION_POLICY = Object.freeze({
  dialogueMinutes: 5,
  readingMinutes: 8,
  quizMinutes: 5,
  transitionMinutes: 2,
  practiceMinutesByComplexity: {
    FOUNDATIONAL: 0,
    APPLIED: 10,
    ANALYTICAL: 12,
    CREATIVE: 18,
  } satisfies Record<LessonComplexity, number>,
  minimumMinutes: 15,
  maximumMinutes: 90,
  roundingIncrementMinutes: 5,
});

const BLOOM_VERBS: Record<LessonComplexity, readonly string[]> = {
  FOUNDATIONAL: [
    "clasificar",
    "comparar",
    "comprender",
    "definir",
    "describir",
    "explicar",
    "identificar",
    "interpretar",
    "listar",
    "reconocer",
    "recordar",
  ],
  APPLIED: [
    "aplicar",
    "configurar",
    "demostrar",
    "emplear",
    "ejecutar",
    "implementar",
    "operar",
    "practicar",
    "resolver",
    "usar",
  ],
  ANALYTICAL: [
    "analizar",
    "argumentar",
    "auditar",
    "categorizar",
    "contrastar",
    "criticar",
    "diagnosticar",
    "diferenciar",
    "evaluar",
    "examinar",
    "validar",
    "verificar",
  ],
  CREATIVE: [
    "construir",
    "crear",
    "desarrollar",
    "diseñar",
    "formular",
    "integrar",
    "planear",
    "proponer",
  ],
};

export interface LessonDurationEstimate {
  complexity: LessonComplexity;
  estimatedMinutes: number;
  videoMinutes: number;
  practiceMinutes: number;
}

export function estimateLessonDuration(
  lesson: Pick<SyllabusLesson, "title" | "objective_specific">,
  videoPolicyInput: unknown = DEFAULT_VIDEO_DURATION_POLICY,
): LessonDurationEstimate {
  const videoPolicy = resolveVideoDurationPolicy(videoPolicyInput);
  const complexity = detectLessonComplexity(lesson);
  const videoMinutes = videoPolicy.targetDurationSeconds / 60;
  const practiceMinutes =
    LESSON_DURATION_POLICY.practiceMinutesByComplexity[complexity];
  const rawMinutes =
    videoMinutes +
    LESSON_DURATION_POLICY.dialogueMinutes +
    LESSON_DURATION_POLICY.readingMinutes +
    LESSON_DURATION_POLICY.quizMinutes +
    LESSON_DURATION_POLICY.transitionMinutes +
    practiceMinutes;

  return {
    complexity,
    estimatedMinutes: clampAndRoundMinutes(rawMinutes),
    videoMinutes,
    practiceMinutes,
  };
}

export function estimateLessonDurationMinutes(
  lesson: Pick<SyllabusLesson, "title" | "objective_specific">,
  videoPolicyInput?: unknown,
) {
  return estimateLessonDuration(lesson, videoPolicyInput).estimatedMinutes;
}

/** Replaces model-provided estimates so generated syllabi use one policy. */
export function applyGeneratedLessonDurationEstimates(
  modules: SyllabusModule[],
  videoPolicyInput?: unknown,
): SyllabusModule[] {
  return modules.map((module) => ({
    ...module,
    lessons: module.lessons.map((lesson) => ({
      ...lesson,
      estimated_minutes: estimateLessonDurationMinutes(
        lesson,
        videoPolicyInput,
      ),
    })),
  }));
}

/** Fills incomplete legacy data without overwriting reviewed manual estimates. */
export function fillMissingLessonDurationEstimates(
  modules: SyllabusModule[],
  videoPolicyInput?: unknown,
): SyllabusModule[] {
  return modules.map((module) => ({
    ...module,
    lessons: module.lessons.map((lesson) => ({
      ...lesson,
      estimated_minutes: isValidEstimate(lesson.estimated_minutes)
        ? lesson.estimated_minutes
        : estimateLessonDurationMinutes(lesson, videoPolicyInput),
    })),
  }));
}

export function calculateEstimatedCourseHours(
  modules: SyllabusModule[],
  videoPolicyInput?: unknown,
) {
  const totalMinutes = fillMissingLessonDurationEstimates(
    modules,
    videoPolicyInput,
  ).reduce(
    (courseMinutes, module) =>
      courseMinutes +
      module.lessons.reduce(
        (moduleMinutes, lesson) =>
          moduleMinutes + (lesson.estimated_minutes ?? 0),
        0,
      ),
    0,
  );

  return Math.round((totalMinutes / 60) * 10) / 10;
}

function detectLessonComplexity(
  lesson: Pick<SyllabusLesson, "title" | "objective_specific">,
): LessonComplexity {
  const normalizedText = normalizeText(
    `${lesson.objective_specific} ${lesson.title}`,
  );
  const precedence: LessonComplexity[] = [
    "CREATIVE",
    "ANALYTICAL",
    "APPLIED",
    "FOUNDATIONAL",
  ];

  return (
    precedence.find((complexity) =>
      BLOOM_VERBS[complexity].some((verb) =>
        new RegExp(`\\b${normalizeText(verb)}\\w*\\b`, "i").test(
          normalizedText,
        ),
      ),
    ) ?? "FOUNDATIONAL"
  );
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function clampAndRoundMinutes(minutes: number) {
  const increment = LESSON_DURATION_POLICY.roundingIncrementMinutes;
  const rounded = Math.ceil(minutes / increment) * increment;
  return Math.min(
    LESSON_DURATION_POLICY.maximumMinutes,
    Math.max(LESSON_DURATION_POLICY.minimumMinutes, rounded),
  );
}

function isValidEstimate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
