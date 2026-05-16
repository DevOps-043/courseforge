import type { PackageFile } from "@/domains/materials/types/materials.types";
import { selectLatestComponentsByType } from "@/domains/materials/lib/material-component-versions";
import type {
  LessonVideoData,
  PublicationArtifactRecord,
  PublicationComponent,
  PublicationLesson,
  PublicationPayloadActivity,
  PublicationPayloadLesson,
  PublicationPayloadMaterial,
  PublicationPreviewLesson,
  PublicationRequestRecord,
} from "@/domains/publication/types/publication.types";
import {
  SOFLIA_DIALOGUE_ACTIVITY_SCHEMA_VERSION,
  buildSofliaDialogueActivityData,
  isSofliaDialogueRuntimeConfig,
  validateSofliaDialogueRuntimeConfig,
} from "./soflia-dialogue-runtime-contract";

export const VIDEO_COMPONENT_TYPES = new Set([
  "VIDEO_THEORETICAL",
  "VIDEO_DEMO",
  "VIDEO_GUIDE",
]);

export function sortLessonsNaturally<T extends { lesson_id: string }>(lessons: T[]): T[] {
  return [...lessons].sort((a, b) => {
    const partsA = a.lesson_id.split(/\D+/).filter(Boolean).map(Number);
    const partsB = b.lesson_id.split(/\D+/).filter(Boolean).map(Number);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

export function hasVideoComponent(
  components: PublicationComponent[] | null | undefined,
): boolean {
  return selectLatestComponentsByType(components).some((component) =>
    VIDEO_COMPONENT_TYPES.has(component.type),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function buildExercisePlainText(content: Record<string, unknown>): string {
  const parts: string[] = [];

  const body = stripHtml(getString(content.body_html));
  if (body) parts.push(body);

  const instructions = getString(content.instructions);
  if (instructions) parts.push(`Instrucciones:\n${instructions}`);

  const expectedOutcome = getString(content.expected_outcome);
  if (expectedOutcome) parts.push(`Resultado esperado:\n${expectedOutcome}`);

  return parts.join("\n\n");
}

function getNumber(value: unknown) {
  return typeof value === "number" && !Number.isNaN(value) ? value : 0;
}

function buildVideoUrl(mapping?: LessonVideoData, fallbackUrl?: string) {
  if (!mapping?.video_id) {
    return fallbackUrl || "";
  }

  if (mapping.video_provider === "youtube") {
    return `https://www.youtube.com/watch?v=${mapping.video_id}`;
  }

  if (mapping.video_provider === "vimeo") {
    return `https://vimeo.com/${mapping.video_id}`;
  }

  return mapping.video_id;
}

export function getArtifactDescription(artifact: PublicationArtifactRecord) {
  if (!artifact.description) {
    return artifact.title || "";
  }

  if (typeof artifact.description === "string") {
    return artifact.description;
  }

  const description = artifact.description as Record<string, unknown>;
  return (
    getString(description.texto) ||
    getString(description.resumen) ||
    getString(description.overview) ||
    getString(description.description) ||
    JSON.stringify(description)
  );
}

function transformQuizContent(content: unknown) {
  if (!isRecord(content)) {
    return {};
  }

  const rawQuestions = Array.isArray(content.questions)
    ? content.questions
    : Array.isArray(content.items)
      ? content.items
      : [];

  let totalPoints = 0;
  const questions = rawQuestions.map((rawQuestion, index) => {
    const question = isRecord(rawQuestion) ? rawQuestion : {};
    const options = Array.isArray(question.options)
      ? question.options.map((option) =>
          typeof option === "string" ? option : String(option),
        )
      : [];
    const points = Number(question.points) || 10;
    totalPoints += points;

    const rawCorrect =
      question.correctAnswer !== undefined
        ? question.correctAnswer
        : question.correct_answer;

    let correctAnswer = "";
    if (typeof rawCorrect === "number") {
      if (rawCorrect >= 0 && rawCorrect < options.length) {
        correctAnswer = options[rawCorrect];
      }
    } else {
      correctAnswer = String(rawCorrect || "");
    }

    return {
      id: getString(question.id) || `question-${index + 1}`,
      question: getString(question.question) || getString(question.questionText),
      questionType:
        getString(question.questionType || question.question_type || question.type)
          .toLowerCase() || "multiple_choice",
      options,
      correctAnswer,
      explanation: getString(question.explanation),
      points,
    };
  });

  return {
    passing_score: Number(content.passing_score) || 80,
    totalPoints:
      totalPoints > 0
        ? totalPoints
        : Number(content.totalPoints || content.total_points) || 100,
    questions,
  };
}

function buildTranscription(components: PublicationComponent[]) {
  const latestComponents = selectLatestComponentsByType(components);
  let transcription = "";

  for (const component of latestComponents) {
    if (!VIDEO_COMPONENT_TYPES.has(component.type)) {
      continue;
    }

    const content = isRecord(component.content) ? component.content : null;
    const script = content && isRecord(content.script) ? content.script : null;
    const sections = script && Array.isArray(script.sections) ? script.sections : [];

    if (sections.length === 0) {
      continue;
    }

    const serialized = sections
      .filter(isRecord)
      .map((section) => {
        const timecode = getString(section.timecode_start);
        const narration = getString(section.narration_text);
        return timecode || narration ? `[${timecode}] ${narration}`.trim() : "";
      })
      .filter(Boolean)
      .join("\n\n");

    if (!serialized) {
      continue;
    }

    transcription += `${transcription ? "\n\n" : ""}${serialized}`;
  }

  return transcription;
}

function buildActivities(components: PublicationComponent[]) {
  const latestComponents = selectLatestComponentsByType(components);
  const activities: PublicationPayloadActivity[] = [];

  for (const component of latestComponents) {
    const content = component.content;
    if (!content || !isRecord(content)) {
      continue;
    }

    if (component.type === "DIALOGUE") {
      if (isSofliaDialogueRuntimeConfig(content)) {
        const validation = validateSofliaDialogueRuntimeConfig(content);
        if (!validation.valid) {
          throw new Error(
            `No se puede publicar DIALOGUE SOFLIA_DIALOGUE invalido: ${validation.errors.join("; ")}`,
          );
        }

        activities.push({
          title: getString(content.title) || "Dialogo con SofLIA",
          type: "ai_chat",
          data: buildSofliaDialogueActivityData(content),
          activity_schema_version: SOFLIA_DIALOGUE_ACTIVITY_SCHEMA_VERSION,
          requires_soflia_validation: false,
          activity_config: content,
          external_tool_key: null,
        });
        continue;
      }

      throw new Error(
        "No se puede publicar DIALOGUE legacy. Regenera este componente para SOFLIA_DIALOGUE antes de publicar.",
      );
    }

    if (component.type === "EXERCISE") {
      const plainText = buildExercisePlainText(content);
      if (!plainText) {
        continue;
      }

      activities.push({
        title: getString(content.title) || "Ejercicio",
        type: "exercise",
        data: plainText,
      });
      continue;
    }

    if (!["READING", "DEMO_GUIDE"].includes(component.type)) {
      continue;
    }

    let contentHtml = getString(content.body_html);
    if (
      component.type === "DEMO_GUIDE" &&
      !contentHtml &&
      Array.isArray(content.steps)
    ) {
      const items = content.steps
        .filter(isRecord)
        .map((step) => {
          const stepNumber = getNumber(step.step_number);
          const instruction = getString(step.instruction);
          return `<li><strong>Paso ${stepNumber}:</strong> ${instruction}</li>`;
        })
        .join("");
      contentHtml = `<h3>${getString(content.title)}</h3><ul>${items}</ul>`;
    }

    if (!contentHtml) {
      continue;
    }

    activities.push({
      title:
        getString(content.title) ||
        (component.type === "READING" ? "Lectura" : "Guía"),
      type: component.type === "READING" ? "reflection" : "exercise",
      data: { content: contentHtml },
    });
  }

  return activities;
}

function buildMaterials(
  lessonId: string,
  components: PublicationComponent[],
  files: PackageFile[],
) {
  const latestComponents = selectLatestComponentsByType(components);
  const materials: PublicationPayloadMaterial[] = [];

  for (const component of latestComponents) {
    const content = component.content;
    if (component.type !== "QUIZ" || !content) {
      continue;
    }

    materials.push({
      title:
        isRecord(content) && getString(content.title)
          ? getString(content.title)
          : "Evaluacion",
      type: "quiz",
      data: transformQuizContent(content),
      description:
        isRecord(content) && getString(content.instructions)
          ? getString(content.instructions)
          : "",
    });
  }

  for (const file of files.filter((entry) => entry.lesson_id === lessonId)) {
    materials.push({
      title: `Recurso: ${file.component}`,
      type: "download",
      url: file.path,
    });
  }

  return materials;
}

export function groupLessonsByModule(lessons: PublicationLesson[]) {
  const groups = new Map<string, PublicationLesson[]>();

  for (const lesson of lessons) {
    const key = lesson.module_title || "Modulo General";
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(lesson);
      continue;
    }

    groups.set(key, [lesson]);
  }

  return groups;
}

export function buildPublicationLesson(params: {
  lesson: PublicationLesson;
  request: PublicationRequestRecord;
  orderIndex: number;
  files: PackageFile[];
}) {
  const { lesson, request, orderIndex, files } = params;
  const mapping = request.lesson_videos?.[lesson.id];
  const videoUrl = buildVideoUrl(mapping, lesson.auto_video_url);
  const videoId = mapping?.video_id || videoUrl;
  const provider = mapping?.video_provider || "youtube";

  if (!videoId || !videoUrl) {
    return null;
  }

  if (
    Array.isArray(request.selected_lessons) &&
    !request.selected_lessons.includes(lesson.id)
  ) {
    return null;
  }

  const duration = Math.round(Math.max(Number(mapping?.duration) || 0, 60));
  const activeComponents = selectLatestComponentsByType(lesson.components || []);
  const payloadLesson: PublicationPayloadLesson = {
    title: lesson.title,
    order_index: orderIndex,
    duration_seconds: duration,
    duration,
    summary: lesson.summary || "",
    description: lesson.summary || "",
    transcription: buildTranscription(activeComponents),
    video_url: videoUrl,
    video_provider: provider,
    video_provider_id: videoId,
    is_free: false,
    content_blocks: [],
    activities: buildActivities(activeComponents),
    materials: buildMaterials(lesson.id, activeComponents, files),
  };

  return payloadLesson;
}

export function buildPreviewLesson(params: {
  lesson: PublicationLesson;
  request: PublicationRequestRecord;
  orderIndex: number;
}) {
  const { lesson, request, orderIndex } = params;
  const mapping = request.lesson_videos?.[lesson.id];
  const videoUrl = buildVideoUrl(mapping, lesson.auto_video_url);
  const videoProvider = mapping?.video_provider || "youtube";
  const videoProviderId = mapping?.video_id || videoUrl;

  if (!videoProviderId || !videoUrl) {
    return null;
  }

  const previewLesson: PublicationPreviewLesson = {
    title: lesson.title,
    order_index: orderIndex,
    video_provider: videoProvider,
    video_provider_id: videoProviderId,
    has_transcription:
      buildTranscription(selectLatestComponentsByType(lesson.components || [])).length > 0,
  };

  return previewLesson;
}
