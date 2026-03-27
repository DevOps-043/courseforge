import type { GoogleGenAI } from "@google/genai";
import type { CurationRowInsert } from "../../../src/shared/types/curation.types";
import {
  SOURCES_PER_LESSON,
} from "./curation-runtime";
import { generateFreshnessReminder } from "./curation-prompts";
import {
  buildGroundingFallbackForLesson,
  buildValidatedRowsFromModelSources,
  extractGroundingSources,
  findLessonResult,
  getResponseText,
  parseLessonsResponse,
} from "./unified-curation-helpers";
import type { GroundingSource, LessonResult, LessonToProcess } from "./unified-curation-types";

interface ProcessLessonBatchParams {
  activeModel: string;
  attempt: number;
  batch: LessonToProcess[];
  batchNum: number;
  client: GoogleGenAI;
  courseTitle: string;
  curationId: string;
  fullCourseContext: string;
  systemPrompt: string;
}

interface ProcessLessonBatchResult {
  failedLessons: LessonToProcess[];
  parsedLessonIds: string[];
  rows: CurationRowInsert[];
}

function buildBatchPrompt(params: {
  attempt: number;
  batch: LessonToProcess[];
  batchNum: number;
  courseTitle: string;
  fullCourseContext: string;
}) {
  const { attempt, batch, batchNum, courseTitle, fullCourseContext } = params;
  const freshnessReminder = generateFreshnessReminder(batchNum);
  const retryNote =
    attempt > 0
      ? "\nPREVIOUS ATTEMPT FAILED. Use DIFFERENT search terms.\n"
      : "";

  return `
${freshnessReminder}
${retryNote}

COURSE CONTEXT (All sources MUST be relevant to this topic)
${fullCourseContext}

LESSONS TO RESEARCH
${JSON.stringify(
    batch.map((lesson) => ({
      lesson_id: lesson.lesson_id,
      title: lesson.lesson_title,
      objective: lesson.lesson_objective,
      module: lesson.module_title,
    })),
    null,
    2,
  )}

TASK: Find 1-2 HIGH-QUALITY sources for EACH lesson above.

SEARCH STRATEGY:
- Search for: "${courseTitle}" + [lesson topic] + "guide" OR "tutorial" OR "tips"
- Sources MUST directly relate to ${courseTitle}
- Prefer articles from major publications, .edu sites, or established productivity blogs
- REJECT: Reddit, forums, unrelated PDFs, social media
`.trim();
}

async function buildFallbackRowsForBatch(params: {
  activeModel: string;
  batch: LessonToProcess[];
  curationId: string;
  groundingSources: GroundingSource[];
  rationale: string;
  useDistributedStartIndex?: boolean;
}) {
  const {
    activeModel,
    batch,
    curationId,
    groundingSources,
    rationale,
    useDistributedStartIndex,
  } = params;
  const rows: CurationRowInsert[] = [];
  const failedLessons: LessonToProcess[] = [];

  for (let lessonIndex = 0; lessonIndex < batch.length; lessonIndex++) {
    const lesson = batch[lessonIndex];
    const row = await buildGroundingFallbackForLesson({
      curationId,
      lesson,
      groundingSources,
      activeModel,
      rationale,
      distributedStartIndex: useDistributedStartIndex ? lessonIndex : undefined,
    });

    if (!row) {
      failedLessons.push(lesson);
      continue;
    }

    rows.push(row);
  }

  return { rows, failedLessons };
}

export async function processLessonBatch({
  activeModel,
  attempt,
  batch,
  batchNum,
  client,
  courseTitle,
  curationId,
  fullCourseContext,
  systemPrompt,
}: ProcessLessonBatchParams): Promise<ProcessLessonBatchResult> {
  const batchPrompt = buildBatchPrompt({
    attempt,
    batch,
    batchNum,
    courseTitle,
    fullCourseContext,
  });

  const response = await client.models.generateContent({
    model: activeModel,
    contents: [{ role: "user", parts: [{ text: batchPrompt }] }],
    config: {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      tools: [{ googleSearch: {} }],
      temperature: 0.3,
    },
  });

  const groundingSources = await extractGroundingSources(response, courseTitle);
  const responseText = getResponseText(response);

  if (!responseText) {
    const fallback = await buildFallbackRowsForBatch({
      activeModel,
      batch,
      curationId,
      groundingSources,
      rationale: "Fuente de Google Search (respuesta vacia del modelo)",
    });

    return {
      failedLessons: fallback.failedLessons,
      parsedLessonIds: [],
      rows: fallback.rows,
    };
  }

  let parsedLessons: LessonResult[];
  try {
    parsedLessons = parseLessonsResponse(responseText);
  } catch (error) {
    console.error("[Lesson Curation] JSON parse error:", error);
    console.error(
      "[Lesson Curation] Raw response (first 500 chars):",
      responseText.substring(0, 500),
    );

    const fallback = await buildFallbackRowsForBatch({
      activeModel,
      batch,
      curationId,
      groundingSources,
      rationale: "Fuente de Google Search (error de parseo)",
    });

    return {
      failedLessons: fallback.failedLessons,
      parsedLessonIds: [],
      rows: fallback.rows,
    };
  }

  const rows: CurationRowInsert[] = [];
  const failedLessons: LessonToProcess[] = [];

  for (let lessonIndex = 0; lessonIndex < batch.length; lessonIndex++) {
    const lesson = batch[lessonIndex];
    const lessonResult = findLessonResult(parsedLessons, lesson, lessonIndex);

    if (!lessonResult?.sources?.length) {
      const fallbackRow = await buildGroundingFallbackForLesson({
        curationId,
        lesson,
        groundingSources,
        activeModel,
        rationale: "Fuente de Google Search (sin resultado especifico)",
        distributedStartIndex: lessonIndex,
      });

      if (!fallbackRow) {
        failedLessons.push(lesson);
      } else {
        rows.push(fallbackRow);
      }
      continue;
    }

    const validatedRows = await buildValidatedRowsFromModelSources({
      curationId,
      lesson,
      sources: lessonResult.sources,
      activeModel,
      maxSourcesPerLesson: SOURCES_PER_LESSON,
    });

    if (validatedRows.length > 0) {
      rows.push(...validatedRows);
      continue;
    }

    const fallbackRow = await buildGroundingFallbackForLesson({
      curationId,
      lesson,
      groundingSources,
      activeModel,
      rationale: "Fuente alternativa de Google Search (URLs del modelo fallaron)",
    });

    if (!fallbackRow) {
      failedLessons.push(lesson);
    } else {
      rows.push(fallbackRow);
    }
  }

  return {
    failedLessons,
    parsedLessonIds: parsedLessons.map((lesson) => lesson.lesson_id),
    rows,
  };
}
