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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function firstStringFromArray(value: unknown): string | null {
  return Array.isArray(value) ? value.find(hasString) || null : null;
}

function getNestedRecord(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  return asRecord(asRecord(value)?.[key]);
}

function getStringField(value: unknown, keys: string[]): string | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const candidate = record[key];
    if (hasString(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getDescriptionFromDescripcion(value: unknown): string | null {
  if (hasString(value)) {
    return value;
  }

  return getStringField(value, [
    "description",
    "descripcion",
    "summary",
    "resumen",
    "idea",
  ]);
}

function uniqueStrings(values: string[], limit: number) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function buildKeywordsFromModules(syllabusModules: SyllabusContextLike["modules"]) {
  if (!Array.isArray(syllabusModules)) {
    return [];
  }

  const candidates = syllabusModules.flatMap((module) => [
    module.title || module.name || "",
    ...(Array.isArray(module.lessons)
      ? module.lessons.map((lesson) => lesson.title || "")
      : []),
  ]);

  return uniqueStrings(candidates.filter(hasString), 10);
}

function buildLearningObjectivesFromModules(
  syllabusModules: SyllabusContextLike["modules"],
) {
  if (!Array.isArray(syllabusModules)) {
    return [];
  }

  const candidates = syllabusModules.flatMap((module) => [
    module.objective || module.objective_specific || "",
    ...(Array.isArray(module.lessons)
      ? module.lessons.map((lesson) => lesson.objective_specific || "")
      : []),
  ]);

  return uniqueStrings(candidates.filter(hasString), 8);
}

export function buildCourseContextSummary(
  artifact: ArtifactContextLike | null | undefined,
  syllabus: SyllabusContextLike | null | undefined,
): CourseContextSummary {
  const originalInput = getNestedRecord(artifact?.generation_metadata, "original_input");
  const courseTitle =
    artifact?.title ||
    artifact?.main_topic ||
    artifact?.idea_central ||
    firstStringFromArray(artifact?.nombres) ||
    getStringField(originalInput, ["title", "courseTitle"]) ||
    "Unknown Course";
  const courseDescription =
    artifact?.description ||
    getDescriptionFromDescripcion(artifact?.descripcion) ||
    getStringField(originalInput, ["description", "courseDescription"]) ||
    "";
  const courseAudience =
    artifact?.audience ||
    getStringField(originalInput, [
      "targetAudience",
      "audience",
      "audienciaObjetivo",
    ]) ||
    "";
  const courseObjectives = Array.isArray(artifact?.objectives)
    ? artifact.objectives.filter(hasString)
    : Array.isArray(artifact?.objetivos)
      ? artifact.objetivos.filter(hasString)
      : [];
  const syllabusModules = Array.isArray(syllabus?.modules) ? syllabus.modules : [];
  const keywords = buildKeywordsFromModules(syllabusModules);
  const learningObjectives =
    courseObjectives.length > 0
      ? courseObjectives
      : buildLearningObjectivesFromModules(syllabusModules);
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

function collectOpenAiSources(value: unknown, sources: GroundingSource[]) {
  const record = asRecord(value);

  if (Array.isArray(value)) {
    value.forEach((item) => collectOpenAiSources(item, sources));
    return;
  }

  if (!record) {
    return;
  }

  const url =
    typeof record.url === "string"
      ? record.url
      : typeof record.uri === "string"
        ? record.uri
        : null;

  if (url?.startsWith("http")) {
    sources.push({
      uri: url,
      title:
        typeof record.title === "string"
          ? record.title
          : "Source from OpenAI web search",
    });
  }

  for (const item of Object.values(record)) {
    if (item && typeof item === "object") {
      collectOpenAiSources(item, sources);
    }
  }
}

function collectGeminiSources(value: unknown, sources: GroundingSource[]) {
  const record = asRecord(value);

  if (Array.isArray(value)) {
    value.forEach((item) => collectGeminiSources(item, sources));
    return;
  }

  if (!record) {
    return;
  }

  const web = asRecord(record.web);
  const url =
    typeof web?.uri === "string"
      ? web.uri
      : typeof record.uri === "string"
        ? record.uri
        : typeof record.url === "string"
          ? record.url
          : null;

  if (url?.startsWith("http")) {
    sources.push({
      uri: url,
      title:
        typeof web?.title === "string"
          ? web.title
          : typeof record.title === "string"
            ? record.title
            : "Source from Gemini Google Search",
    });
  }

  for (const item of Object.values(record)) {
    if (item && typeof item === "object") {
      collectGeminiSources(item, sources);
    }
  }
}

export async function extractOpenAiSearchSources(
  response: unknown,
  courseTitle: string,
): Promise<GroundingSource[]> {
  const collectedSources: GroundingSource[] = [];
  collectOpenAiSources(response, collectedSources);

  const uniqueSources = new Map<string, GroundingSource>();
  for (const source of collectedSources) {
    let finalUri = source.uri;
    if (
      finalUri.includes("grounding-api-redirect") ||
      finalUri.includes("vertexaisearch.cloud.google.com")
    ) {
      finalUri = await resolveRedirectUrl(finalUri);
    }

    if (isBlockedDomain(finalUri, courseTitle)) {
      continue;
    }

    uniqueSources.set(finalUri, {
      uri: finalUri,
      title: source.title,
    });
  }

  return Array.from(uniqueSources.values());
}

export async function extractGeminiSearchSources(
  response: unknown,
  courseTitle: string,
): Promise<GroundingSource[]> {
  const collectedSources: GroundingSource[] = [];
  collectGeminiSources(response, collectedSources);

  const uniqueSources = new Map<string, GroundingSource>();
  for (const source of collectedSources) {
    let finalUri = source.uri;
    if (
      finalUri.includes("grounding-api-redirect") ||
      finalUri.includes("vertexaisearch.cloud.google.com")
    ) {
      finalUri = await resolveRedirectUrl(finalUri);
    }

    if (isBlockedDomain(finalUri, courseTitle)) {
      continue;
    }

    uniqueSources.set(finalUri, {
      uri: finalUri,
      title: source.title,
    });
  }

  return Array.from(uniqueSources.values());
}

export function getOpenAiResponseText(response: unknown) {
  const record = asRecord(response);
  if (!record) {
    return "";
  }

  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  const output = Array.isArray(record.output) ? record.output : [];
  for (const item of output) {
    const outputItem = asRecord(item);
    const content = Array.isArray(outputItem?.content)
      ? outputItem.content
      : [];

    for (const contentItem of content) {
      const contentRecord = asRecord(contentItem);
      if (typeof contentRecord?.text === "string") {
        return contentRecord.text;
      }
    }
  }

  return "";
}

export function getGeminiResponseText(response: unknown) {
  const record = asRecord(response);
  if (!record) {
    return "";
  }

  if (typeof record.text === "string") {
    return record.text;
  }

  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  const candidates = Array.isArray(record.candidates) ? record.candidates : [];
  for (const candidate of candidates) {
    const candidateRecord = asRecord(candidate);
    const content = asRecord(candidateRecord?.content);
    const parts = Array.isArray(content?.parts) ? content.parts : [];

    const text = parts
      .map((part) => asRecord(part)?.text)
      .filter(hasString)
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  return "";
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
  providerLabel?: string;
  rationale: string;
  distributedStartIndex?: number;
}): Promise<CurationRowInsert | null> {
  const {
    curationId,
    lesson,
    groundingSources,
    activeModel,
    providerLabel = "Provider search",
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
      autoReason: `${providerLabel} fallback validated (${activeModel})`,
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
  providerLabel?: string;
  maxSourcesPerLesson: number;
}): Promise<CurationRowInsert[]> {
  const {
    curationId,
    lesson,
    sources,
    activeModel,
    providerLabel = "Provider",
    maxSourcesPerLesson,
  } = params;
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
      auto_reason: `Validated with ${providerLabel} (${activeModel})`,
    });
  }

  return rows;
}
