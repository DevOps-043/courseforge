import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { CURATION_STATES, PLAN_STATES } from "@/lib/pipeline-constants";

export interface CurationPlanComponent {
  lesson_id: string;
  lesson_title: string;
  component: string;
  is_critical: boolean;
}

interface LessonPlanInput {
  id?: string;
  lesson_id?: string;
  title?: string;
  lesson_title?: string;
  components?: unknown[];
}

interface ComponentInput {
  component?: string;
  is_critical?: boolean;
  type?: string;
}

export function mapCurationStatus(status: string) {
  let finalStatus = status;
  let decision = "PENDING";

  if (
    status === PLAN_STATES.APPROVED ||
    status === CURATION_STATES.APPROVED
  ) {
    finalStatus = CURATION_STATES.APPROVED;
    decision = "APPROVED";
  } else if (
    status === PLAN_STATES.REJECTED ||
    status === CURATION_STATES.BLOCKED ||
    status === CURATION_STATES.REJECTED
  ) {
    finalStatus = CURATION_STATES.BLOCKED;
    decision = "BLOCKED";
  } else if (status === CURATION_STATES.PAUSED_REQUESTED) {
    finalStatus = CURATION_STATES.PAUSED_REQUESTED;
  } else if (status === CURATION_STATES.STOPPED_REQUESTED) {
    finalStatus = CURATION_STATES.STOPPED_REQUESTED;
  }

  return { finalStatus, decision };
}

export function extractPlanComponents(
  lessonPlans: unknown,
): CurationPlanComponent[] {
  if (!Array.isArray(lessonPlans)) return [];

  return lessonPlans.flatMap((lesson, lessonIndex) => {
    const normalizedLesson = lesson as LessonPlanInput;
    const lessonId =
      normalizedLesson.lesson_id ||
      normalizedLesson.id ||
      `lesson-${lessonIndex + 1}`;
    const lessonTitle =
      normalizedLesson.lesson_title ||
      normalizedLesson.title ||
      "Untitled Lesson";

    if (!Array.isArray(normalizedLesson.components)) {
      return [];
    }

    return normalizedLesson.components.map((component) => {
      const normalizedComponent = component as string | ComponentInput;
      const componentType =
        typeof normalizedComponent === "string"
          ? normalizedComponent
          : normalizedComponent.type ||
            normalizedComponent.component ||
            "UNKNOWN";

      return {
        lesson_id: lessonId,
        lesson_title: lessonTitle,
        component: componentType,
        is_critical:
          typeof normalizedComponent === "object" &&
          normalizedComponent?.is_critical === true,
      };
    });
  });
}

interface TriggerCurationGenerationParams {
  accessToken: string;
  artifactId: string;
  attemptNumber: number;
  components: CurationPlanComponent[];
  courseName: string;
  curationId?: string;
  gaps: string[];
  ideaCentral?: string | null;
  resume: boolean;
}

export async function triggerCurationGeneration({
  accessToken,
  artifactId,
  attemptNumber,
  components,
  courseName,
  curationId,
  gaps,
  ideaCentral,
  resume,
}: TriggerCurationGenerationParams) {
  return callBackgroundFunctionJson(
    "curation-background",
    {
      curationId,
      artifactId,
      components,
      courseName,
      ideaCentral,
      accessToken,
      attemptNumber,
      gaps,
      resume,
    },
    {
      fallbackError: "Error al iniciar la curaduria",
      localHandlerLoader: () =>
        import("../../../../netlify/functions/curation-background"),
    },
  );
}

export async function triggerCurationValidation(artifactId: string, userToken: string) {
  return callBackgroundFunctionJson(
    "validate-curation-background",
    {
      artifactId,
      userToken,
    },
    {
      fallbackError: "Error en el servicio de validacion de curaduria",
      localHandlerLoader: () =>
        import("../../../../netlify/functions/validate-curation-background"),
    },
  );
}
