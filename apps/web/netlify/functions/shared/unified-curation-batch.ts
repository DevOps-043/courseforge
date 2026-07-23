import type { GoogleGenAI } from "@google/genai";
import type OpenAI from "openai";
import type { CurationRowInsert } from "../../../src/shared/types/curation.types";
import { SOURCES_PER_LESSON } from "./curation-runtime";
import { generateFreshnessReminder } from "./curation-prompts";
import {
  buildGroundingFallbackForLesson,
  buildValidatedRowsFromModelSources,
  extractGeminiSearchSources,
  extractOpenAiSearchSources,
  findLessonResult,
  getGeminiResponseText,
  getOpenAiResponseText,
  parseLessonsResponse,
} from "./unified-curation-helpers";
import type {
  GroundingSource,
  LessonResult,
  LessonToProcess,
} from "./unified-curation-types";

interface ProcessOpenAiLessonBatchParams {
  activeModel: string;
  attempt: number;
  batch: LessonToProcess[];
  batchNum: number;
  client: OpenAI;
  courseTitle: string;
  curationId: string;
  fullCourseContext: string;
  reasoningEffort: string;
  systemPrompt: string;
}

interface ProcessGeminiLessonBatchParams {
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

const CURATION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          lesson_id: { type: "string" },
          lesson_title: { type: "string" },
          sources: {
            type: "array",
            minItems: 1,
            maxItems: SOURCES_PER_LESSON,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                url: { type: "string" },
                title: { type: "string" },
                rationale: { type: "string" },
                key_topics_covered: {
                  type: "array",
                  items: { type: "string" },
                },
                estimated_quality: {
                  type: "number",
                  minimum: 1,
                  maximum: 10,
                },
              },
              required: [
                "url",
                "title",
                "rationale",
                "key_topics_covered",
                "estimated_quality",
              ],
            },
          },
        },
        required: ["lesson_id", "lesson_title", "sources"],
      },
    },
  },
  required: ["lessons"],
} as const;

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
- Prefer articles from major publications, official documentation, .edu sites, or established productivity/business blogs
- REJECT: Reddit, forums, unrelated PDFs, social media, inaccessible pages
`.trim();
}

async function buildFallbackRowsForBatch(params: {
  activeModel: string;
  batch: LessonToProcess[];
  curationId: string;
  groundingSources: GroundingSource[];
  providerLabel: string;
  rationale: string;
  useDistributedStartIndex?: boolean;
}) {
  const {
    activeModel,
    batch,
    curationId,
    groundingSources,
    providerLabel,
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
      providerLabel,
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

async function buildRowsFromModelOutput(params: {
  activeModel: string;
  batch: LessonToProcess[];
  curationId: string;
  groundingSources: GroundingSource[];
  providerLabel: string;
  responseText: string;
}) {
  const {
    activeModel,
    batch,
    curationId,
    groundingSources,
    providerLabel,
    responseText,
  } = params;

  if (!responseText) {
    const fallback = await buildFallbackRowsForBatch({
      activeModel,
      batch,
      curationId,
      groundingSources,
      providerLabel,
      rationale: `Fuente de ${providerLabel} (respuesta vacia del modelo)`,
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
      providerLabel,
      rationale: `Fuente de ${providerLabel} (error de parseo)`,
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
        providerLabel,
        rationale: `Fuente de ${providerLabel} (sin resultado especifico)`,
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
      providerLabel,
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
      providerLabel,
      rationale: `Fuente alternativa de ${providerLabel} (URLs del modelo fallaron)`,
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

export async function processOpenAiLessonBatch({
  activeModel,
  attempt,
  batch,
  batchNum,
  client,
  courseTitle,
  curationId,
  fullCourseContext,
  reasoningEffort,
  systemPrompt,
}: ProcessOpenAiLessonBatchParams): Promise<ProcessLessonBatchResult> {
  const batchPrompt = buildBatchPrompt({
    attempt,
    batch,
    batchNum,
    courseTitle,
    fullCourseContext,
  });

  const response = await client.responses.create(({
    model: activeModel,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: batchPrompt },
    ],
    max_output_tokens: 4000,
    reasoning: { effort: reasoningEffort },
    text: {
      format: {
        type: "json_schema",
        name: "courseforge_curation_sources",
        strict: true,
        schema: CURATION_RESPONSE_SCHEMA,
      },
    },
    tool_choice: "required",
    tools: [
      {
        type: "web_search",
        external_web_access: true,
        return_token_budget: "default",
      },
    ],
  } as unknown) as Parameters<typeof client.responses.create>[0]);

  const groundingSources = await extractOpenAiSearchSources(response, courseTitle);
  const responseText = getOpenAiResponseText(response);

  return buildRowsFromModelOutput({
    activeModel,
    batch,
    curationId,
    groundingSources,
    providerLabel: "OpenAI web search",
    responseText,
  });
}

export async function processGeminiLessonBatch({
  activeModel,
  attempt,
  batch,
  batchNum,
  client,
  courseTitle,
  curationId,
  fullCourseContext,
  systemPrompt,
}: ProcessGeminiLessonBatchParams): Promise<ProcessLessonBatchResult> {
  const batchPrompt = buildBatchPrompt({
    attempt,
    batch,
    batchNum,
    courseTitle,
    fullCourseContext,
  });

  const response = await client.models.generateContent({
    model: activeModel,
    contents: `${systemPrompt}

${batchPrompt}

Return ONLY valid JSON matching this shape:
{
  "lessons": [
    {
      "lesson_id": "string",
      "lesson_title": "string",
      "sources": [
        {
          "url": "https://example.com",
          "title": "string",
          "rationale": "string",
          "key_topics_covered": ["string"],
          "estimated_quality": 8
        }
      ]
    }
  ]
}`,
    config: {
      temperature: 0.1,
      tools: [{ googleSearch: {} }],
    },
  } as Parameters<typeof client.models.generateContent>[0]);

  const groundingSources = await extractGeminiSearchSources(response, courseTitle);
  const responseText = getGeminiResponseText(response);

  return buildRowsFromModelOutput({
    activeModel,
    batch,
    curationId,
    groundingSources,
    providerLabel: "Gemini Google Search",
    responseText,
  });
}
