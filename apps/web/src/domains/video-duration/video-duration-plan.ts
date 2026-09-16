import {
  buildVideoDurationContract,
  formatVideoDurationRange,
  isVideoComponentType,
  type VideoDurationContract,
  type VideoDurationPolicy,
} from "./video-duration-policy";

interface DurationPlanComponent {
  duration?: string;
  duration_contract?: unknown;
  summary?: string;
  type: string;
  [key: string]: unknown;
}

interface DurationPlanLesson {
  components: DurationPlanComponent[];
  [key: string]: unknown;
}

export function applyVideoDurationPolicyToPlan<TLesson extends DurationPlanLesson>(
  lessons: TLesson[],
  policy: VideoDurationPolicy,
): TLesson[] {
  const durationRange = formatVideoDurationRange(policy);

  return lessons.map((lesson) => ({
    ...lesson,
    components: lesson.components.map((component) => {
      if (!isVideoComponentType(component.type)) return component;
      const contract = buildVideoDurationContract(policy, component.type);

      return {
        ...component,
        duration: `${formatMinutes(contract.targetDurationSeconds)} min`,
        duration_contract: contract,
        summary: withDurationSummary(
          component.summary || "",
          durationRange,
          contract.targetDurationSeconds,
        ),
      };
    }),
  })) as TLesson[];
}

export function applyVideoDurationContractToPlanComponent<TLesson extends DurationPlanLesson>(
  lessons: TLesson[],
  lessonId: string,
  componentType: string,
  contract: VideoDurationContract,
): TLesson[] {
  const durationRange = formatVideoDurationRange(contract);
  return lessons.map((lesson) => {
    const currentLessonId = typeof lesson.lesson_id === "string" ? lesson.lesson_id : "";
    if (currentLessonId !== lessonId) return lesson;

    return {
      ...lesson,
      components: lesson.components.map((component) => component.type !== componentType
        ? component
        : {
            ...component,
            duration: `${formatMinutes(contract.targetDurationSeconds)} min`,
            duration_contract: contract,
            summary: withDurationSummary(
              component.summary || "",
              durationRange,
              contract.targetDurationSeconds,
            ),
          }),
    } as TLesson;
  });
}

export function withDurationSummary(
  summary: string,
  durationRange: string,
  targetDurationSeconds: number,
) {
  const withoutPreviousContract = summary
    .replace(/\s*Duraci[oó]n objetivo:\s*\d+(?:[.,]\d+)?\s*min\s*\(rango permitido:\s*[^)]+\)\.?/giu, "")
    .trim();
  const sentence = `Duración objetivo: ${formatMinutes(targetDurationSeconds)} min (rango permitido: ${durationRange}).`;
  return `${withoutPreviousContract} ${sentence}`.trim();
}

function formatMinutes(seconds: number) {
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
}
