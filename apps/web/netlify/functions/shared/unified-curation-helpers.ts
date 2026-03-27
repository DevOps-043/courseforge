import type { CurationRowInsert } from "../../../src/shared/types/curation.types";
import {
  resolveRedirectUrl,
  validateUrlWithContent,
} from "./curation-runtime";
import { isBlockedDomain } from "./curation-prompts";
import type {
  ArtifactContextLike,
  CourseContextSummary,
  GroundingSource,
  LessonPlanLike,
  LessonResult,
  LessonSource,
  LessonToProcess,
  SyllabusContextLike,
} from "./unified-curation-types";

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function buildCourseContextSummary(
  artifact: ArtifactContextLike | null | undefined,
  syllabus: SyllabusContextLike | null | undefined,
): CourseContextSummary {
  const courseTitle =
    artifact?.title || artifact?.main_topic || "Unknown Course";
  const courseDescription = artifact?.description || "";
  const courseAudience = artifact?.audience || "";
  const courseObjectives = Array.isArray(artifact?.objectives)
    ? artifact.objectives.filter(hasString)
    : [];
  const syllabusModules = Array.isArray(syllabus?.modules) ? syllabus.modules : [];
  const keywords = Array.isArray(syllabus?.keywords)
    ? syllabus.keywords.filter(hasString).slice(0, 10)
    : [];
  const learningObjectives = Array.isArray(syllabus?.learning_objectives)
    ? syllabus.learning_objectives.filter(hasString)
    : courseObjectives;
  const moduleNames = syllabusModules
    .slice(0, 5)
    .map((module) => module.title || module.name || "")
    .filter(hasString);

  const fullCourseContext = `
COURSE TITLE: ${courseTitle}
${courseDescription ? `DESCRIPTION: ${courseDescription.substring(0, 300)}` : ""}
${courseAudience ? `TARGET AUDIENCE: ${courseAudience}` : ""}
${moduleNames.length > 0 ? `MAIN MODULES: ${moduleNames.join(", ")}` : ""}
${keywords.length > 0 ? `KEY TOPICS/KEYWORDS: ${keywords.join(", ")}` : ""}
${learningObjectives.length > 0 ? `LEARNING OBJECTIVES: ${learningObjectives.slice(0, 3).join("; ")}` : ""}
`.trim();

  return {
    courseTitle,
    courseDescription,
    courseAudience,
    learningObjectives,
    moduleNames,
    keywords,
    fullCourseContext,
  };
}

export function buildLessonsToProcess(
  lessonPlans: unknown,
): LessonToProcess[] {
  if (!Array.isArray(lessonPlans)) {
    return [];
  }

  return lessonPlans.map((rawLesson, index) => {
    const lesson = (rawLesson || {}) as LessonPlanLike;
    const baseId = lesson.lesson_id || lesson.id || "";
    const isValidId =
      hasString(baseId) &&
      baseId !== "undefined" &&
      baseId !== "null";

    return {
      lesson_id: isValidId ? baseId : `lesson-${index + 1}`,
      lesson_title:
        lesson.lesson_title || lesson.title || `Leccion ${index + 1}`,
      lesson_objective:
        lesson.objective || lesson.summary || lesson.description || "",
      module_title: lesson.module_title || "",
      component_count: Array.isArray(lesson.components)
        ? lesson.components.length
        : 0,
    };
  });
}

export function parseLessonsResponse(responseText: string): LessonResult[] {
  let jsonStr = responseText.trim();

  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  const lessonsMatch = jsonStr.match(/\{"lessons"\s*:\s*\[[\s\S]*\]\s*\}/);
  if (lessonsMatch) {
    jsonStr = lessonsMatch[0];
  } else {
    const jsonStart = jsonStr.indexOf("{");
    const jsonEnd = jsonStr.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1);
    }
  }

  jsonStr = jsonStr.replace(/,\s*}/g, "}");
  jsonStr = jsonStr.replace(/,\s*]/g, "]");

  const parsed = JSON.parse(jsonStr) as { lessons?: LessonResult[] };
  if (!Array.isArray(parsed.lessons)) {
    throw new Error("Invalid structure: missing lessons array");
  }

  return parsed.lessons;
}

function getGroundingChunks(
  response: unknown,
): Array<{ web?: { uri?: string; title?: string } }> {
  if (
    !response ||
    typeof response !== "object" ||
    !("candidates" in response) ||
    !Array.isArray((response as { candidates?: unknown[] }).candidates)
  ) {
    return [];
  }

  const firstCandidate = (response as { candidates?: unknown[] }).candidates?.[0];
  if (
    !firstCandidate ||
    typeof firstCandidate !== "object" ||
    !("groundingMetadata" in firstCandidate)
  ) {
    return [];
  }

  const groundingMetadata = (
    firstCandidate as { groundingMetadata?: { groundingChunks?: unknown[] } }
  ).groundingMetadata;

  return Array.isArray(groundingMetadata?.groundingChunks)
    ? (groundingMetadata.groundingChunks as Array<{
        web?: { uri?: string; title?: string };
      }>)
    : [];
}

export async function extractGroundingSources(
  response: unknown,
  courseTitle: string,
): Promise<GroundingSource[]> {
  const sources: GroundingSource[] = [];

  for (const chunk of getGroundingChunks(response)) {
    if (!chunk.web?.uri) {
      continue;
    }

    let finalUri = chunk.web.uri;
    if (finalUri.includes("grounding-api-redirect")) {
      finalUri = await resolveRedirectUrl(finalUri);
    }

    if (isBlockedDomain(finalUri, courseTitle)) {
      continue;
    }

    sources.push({
      uri: finalUri,
      title: chunk.web.title || "Source from Google Search",
    });
  }

  return sources;
}

export function getResponseText(response: unknown) {
  if (
    !response ||
    typeof response !== "object" ||
    !("candidates" in response) ||
    !Array.isArray((response as { candidates?: unknown[] }).candidates)
  ) {
    return "";
  }

  const firstCandidate = (response as { candidates?: unknown[] }).candidates?.[0];
  if (
    !firstCandidate ||
    typeof firstCandidate !== "object" ||
    !("content" in firstCandidate)
  ) {
    return "";
  }

  const content = (firstCandidate as {
    content?: { parts?: Array<{ text?: string }> };
  }).content;

  return content?.parts?.[0]?.text || "";
}

function buildGroundingRow(params: {
  curationId: string;
  lesson: LessonToProcess;
  source: GroundingSource;
  rationale: string;
  autoReason: string;
}): CurationRowInsert {
  const { curationId, lesson, source, rationale, autoReason } = params;
  return {
    curation_id: curationId,
    lesson_id: lesson.lesson_id,
    lesson_title: lesson.lesson_title,
    component: "LESSON_SOURCE",
    is_critical: true,
    source_ref: source.uri,
    source_title: source.title,
    source_rationale: rationale,
    url_status: "OK",
    apta: true,
    cobertura_completa: true,
    auto_evaluated: true,
    auto_reason: autoReason,
  };
}

export async function buildGroundingFallbackForLesson(params: {
  curationId: string;
  lesson: LessonToProcess;
  groundingSources: GroundingSource[];
  activeModel: string;
  rationale: string;
  distributedStartIndex?: number;
}): Promise<CurationRowInsert | null> {
  const {
    curationId,
    lesson,
    groundingSources,
    activeModel,
    rationale,
    distributedStartIndex,
  } = params;

  if (groundingSources.length === 0) {
    return null;
  }

  const indexes =
    distributedStartIndex === undefined
      ? groundingSources.map((_, index) => index)
      : groundingSources.map((_, index) =>
          (distributedStartIndex + index) % groundingSources.length,
        );

  for (const sourceIndex of indexes) {
    const source = groundingSources[sourceIndex];
    const validation = await validateUrlWithContent(source.uri);
    if (!validation.isValid) {
      continue;
    }

    return buildGroundingRow({
      curationId,
      lesson,
      source,
      rationale,
      autoReason: `Grounding fallback validated (${activeModel})`,
    });
  }

  return null;
}

export function findLessonResult(
  parsedLessons: LessonResult[],
  lesson: LessonToProcess,
  lessonIndex: number,
) {
  const directMatch = parsedLessons.find(
    (candidate) =>
      candidate.lesson_id === lesson.lesson_id ||
      candidate.lesson_id?.toLowerCase() === lesson.lesson_id.toLowerCase(),
  );

  if (directMatch) {
    return directMatch;
  }

  return parsedLessons[lessonIndex] || null;
}

export async function buildValidatedRowsFromModelSources(params: {
  curationId: string;
  lesson: LessonToProcess;
  sources: LessonSource[];
  activeModel: string;
  maxSourcesPerLesson: number;
}): Promise<CurationRowInsert[]> {
  const { curationId, lesson, sources, activeModel, maxSourcesPerLesson } = params;
  const rows: CurationRowInsert[] = [];

  for (const source of sources) {
    if (rows.length >= maxSourcesPerLesson) {
      break;
    }

    let urlToValidate = source.url;
    if (urlToValidate.includes("grounding-api-redirect")) {
      urlToValidate = await resolveRedirectUrl(urlToValidate);
    }

    const validation = await validateUrlWithContent(urlToValidate);
    if (!validation.isValid) {
      continue;
    }

    rows.push({
      curation_id: curationId,
      lesson_id: lesson.lesson_id,
      lesson_title: lesson.lesson_title,
      component: "LESSON_SOURCE",
      is_critical: true,
      source_ref: urlToValidate,
      source_title: source.title,
      source_rationale: source.rationale,
      url_status: "OK",
      apta: true,
      cobertura_completa: true,
      notes: `Quality: ${source.estimated_quality}/10. Topics: ${source.key_topics_covered?.join(", ") || "N/A"}`,
      auto_evaluated: true,
      auto_reason: `Validated (${activeModel})`,
    });
  }

  return rows;
}
