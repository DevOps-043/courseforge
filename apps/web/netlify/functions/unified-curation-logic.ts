import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import type { CurationRowInsert } from "../../src/shared/types/curation.types";
import {
  DEFAULT_FALLBACK_MODEL,
  DEFAULT_MODEL,
  DELAY_BETWEEN_BATCHES_MS,
  LESSONS_PER_BATCH,
  delay,
} from "./shared/curation-runtime";
import { getErrorMessage } from "./shared/errors";
import { generateSystemPrompt } from "./shared/curation-prompts";
import { processLessonBatch } from "./shared/unified-curation-batch";
import {
  buildCourseContextSummary,
  buildLessonsToProcess,
} from "./shared/unified-curation-helpers";
import type { LessonToProcess } from "./shared/unified-curation-types";
import { CURATION_MODEL_COOLDOWN_DELAY_MS } from "./shared/timing";

interface UnifiedCurationParams {
  artifactId: string;
  curationId: string;
  customPrompt?: string;
  supabaseUrl: string;
  supabaseKey: string;
  geminiApiKey: string;
  resume?: boolean;
}

interface CurationStateRecord {
  state?: string | null;
}

async function syncCurationSignal(
  supabase: SupabaseClient,
  curationId: string,
) {
  const { data } = await supabase
    .from("curation")
    .select("state")
    .eq("id", curationId)
    .single();

  const state = (data as CurationStateRecord | null)?.state;
  if (state === "PAUSED_REQUESTED") {
    await supabase.from("curation").update({ state: "PAUSED" }).eq("id", curationId);
    console.log("[Signal] Paused by user.");
    return "PAUSED";
  }

  if (state === "PAUSED") {
    console.log("[Signal] Already PAUSED. Exiting.");
    return "PAUSED";
  }

  if (state === "STOPPED_REQUESTED") {
    await supabase
      .from("curation")
      .update({ state: "STOPPED" })
      .eq("id", curationId);
    console.log("[Signal] Stopped by user.");
    return "STOPPED";
  }

  if (state === "STOPPED") {
    console.log("[Signal] Already STOPPED. Exiting.");
    return "STOPPED";
  }

  return "ACTIVE";
}

function buildSystemPromptWithOverride(
  courseTitle: string,
  fullCourseContext: string,
  customPrompt?: string,
) {
  if (!customPrompt) {
    return generateSystemPrompt(courseTitle, fullCourseContext);
  }

  return `${generateSystemPrompt(courseTitle, fullCourseContext)}\n\nCUSTOM INSTRUCTIONS:\n${customPrompt}`;
}

export async function processUnifiedCuration({
  artifactId,
  curationId,
  customPrompt,
  supabaseUrl,
  supabaseKey,
  geminiApiKey,
  resume,
}: UnifiedCurationParams) {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const client = new GoogleGenAI({ apiKey: geminiApiKey });

  console.log(
    `[Lesson Curation] Starting for Artifact: ${artifactId}, Curation: ${curationId}`,
  );

  const [settingsResult, planResult, artifactResult, syllabusResult] =
    await Promise.all([
      supabase
        .from("model_settings")
        .select("*")
        .eq("setting_type", "CURATION")
        .eq("is_active", true)
        .single(),
      supabase
        .from("instructional_plans")
        .select("lesson_plans")
        .eq("artifact_id", artifactId)
        .single(),
      supabase
        .from("artifacts")
        .select("title, description, main_topic, audience, objectives")
        .eq("id", artifactId)
        .single(),
      supabase
        .from("syllabus")
        .select("modules, learning_objectives, keywords")
        .eq("artifact_id", artifactId)
        .single(),
    ]);

  const courseContext = buildCourseContextSummary(
    artifactResult.data,
    syllabusResult.data,
  );
  const systemPrompt = buildSystemPromptWithOverride(
    courseContext.courseTitle,
    courseContext.fullCourseContext,
    customPrompt,
  );

  console.log(`[Lesson Curation] Course: "${courseContext.courseTitle}"`);
  console.log(
    `[Lesson Curation] Modules: ${courseContext.moduleNames.join(", ") || "N/A"}`,
  );
  console.log(
    `[Lesson Curation] Keywords: ${courseContext.keywords.join(", ") || "N/A"}`,
  );

  let activeModel = settingsResult.data?.model_name || DEFAULT_MODEL;
  const fallbackModel =
    settingsResult.data?.fallback_model || DEFAULT_FALLBACK_MODEL;
  console.log(
    `[Lesson Curation] Using model: ${activeModel}, Fallback: ${fallbackModel}`,
  );

  const lessonsToProcess = buildLessonsToProcess(planResult.data?.lesson_plans);
  console.log(
    `[Lesson Curation] Found ${lessonsToProcess.length} lessons to process.`,
  );
  console.log(
    `[Lesson Curation] Lesson Titles: ${lessonsToProcess
      .map((lesson) => lesson.lesson_title)
      .slice(0, 5)
      .join(" | ")}...`,
  );

  let lessonsToSearch = [...lessonsToProcess];
  if (resume) {
    const { data: existingRows } = await supabase
      .from("curation_rows")
      .select("lesson_id")
      .eq("curation_id", curationId);

    const processedLessonIds = new Set(
      (existingRows || []).map((row) => row.lesson_id),
    );
    lessonsToSearch = lessonsToProcess.filter(
      (lesson) => !processedLessonIds.has(lesson.lesson_id),
    );
    console.log(
      `[Resume] Skipping ${lessonsToProcess.length - lessonsToSearch.length} completed lessons. Remaining: ${lessonsToSearch.length}`,
    );
  }

  const curatedResults: CurationRowInsert[] = [];
  const maxRetries = 3;
  let remainingLessons = [...lessonsToSearch];
  let attempt = 0;

  while (remainingLessons.length > 0 && attempt <= maxRetries) {
    console.log(
      `[Lesson Curation] Pass ${attempt + 1}/${maxRetries + 1}. Remaining lessons: ${remainingLessons.length}`,
    );

    const failedInThisPass: LessonToProcess[] = [];

    for (
      let lessonOffset = 0;
      lessonOffset < remainingLessons.length;
      lessonOffset += LESSONS_PER_BATCH
    ) {
      const signal = await syncCurationSignal(supabase, curationId);
      if (signal !== "ACTIVE") {
        return curatedResults.length;
      }

      const batch = remainingLessons.slice(
        lessonOffset,
        lessonOffset + LESSONS_PER_BATCH,
      );
      const batchNum = Math.floor(lessonOffset / LESSONS_PER_BATCH) + 1;
      console.log(
        `[Lesson Curation] Processing batch ${batchNum} (${batch.length} lessons)...`,
      );

      if (lessonOffset > 0) {
        console.log(
          `[Lesson Curation] Waiting ${DELAY_BETWEEN_BATCHES_MS}ms...`,
        );
        await delay(DELAY_BETWEEN_BATCHES_MS);
      }

      try {
        console.log(`[Lesson Curation] Calling ${activeModel}...`);
        const batchResult = await processLessonBatch({
          activeModel,
          attempt,
          batch,
          batchNum,
          client,
          courseTitle: courseContext.courseTitle,
          curationId,
          fullCourseContext: courseContext.fullCourseContext,
          systemPrompt,
        });

        if (batchResult.parsedLessonIds.length > 0) {
          console.log(
            `[Lesson Curation] Model returned lessons: ${batchResult.parsedLessonIds.join(", ")}`,
          );
          console.log(
            `[Lesson Curation] Expected lessons: ${batch.map((lesson) => lesson.lesson_id).join(", ")}`,
          );
        }

        if (batchResult.rows.length > 0) {
          const { error: insertError } = await supabase
            .from("curation_rows")
            .insert(batchResult.rows);

          if (insertError) {
            console.error(
              "[Lesson Curation] Incremental Insert Error:",
              insertError,
            );
          } else {
            curatedResults.push(...batchResult.rows);
            console.log(
              `[Lesson Curation] Saved ${batchResult.rows.length} rows for batch ${batchNum}.`,
            );
          }
        }

        failedInThisPass.push(...batchResult.failedLessons);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        console.error(
          `[Lesson Curation] Batch Error (${activeModel}):`,
          errorMessage,
        );

        if (attempt < maxRetries) {
          failedInThisPass.push(...batch);

          if (
            errorMessage.includes("503") ||
            errorMessage.includes("overloaded")
          ) {
            console.warn(
              `[Lesson Curation] Model overloaded. Switching to: ${fallbackModel}`,
            );
            activeModel = fallbackModel;
            await delay(CURATION_MODEL_COOLDOWN_DELAY_MS);
          }
        }
      }
    }

    remainingLessons = failedInThisPass;
    attempt += 1;
    if (remainingLessons.length === 0) {
      break;
    }
  }

  const lessonsWithSources = new Set(
    curatedResults.map((row) => row.lesson_id),
  );
  const lessonsWithoutSources = lessonsToProcess.filter(
    (lesson) => !lessonsWithSources.has(lesson.lesson_id),
  );

  console.log("[Lesson Curation] SUMMARY:");
  console.log(`[Lesson Curation]   Total lessons: ${lessonsToProcess.length}`);
  console.log(
    `[Lesson Curation]   Lessons with sources: ${lessonsWithSources.size}`,
  );
  console.log(
    `[Lesson Curation]   Lessons without sources: ${lessonsWithoutSources.length}`,
  );
  console.log(
    `[Lesson Curation]   Total sources found: ${curatedResults.length}`,
  );

  if (lessonsWithoutSources.length > 0) {
    console.log(
      `[Lesson Curation]   Failed lessons: ${lessonsWithoutSources.map((lesson) => lesson.lesson_id).join(", ")}`,
    );
  }

  await supabase
    .from("curation")
    .update({
      state: "PHASE2_GENERATED",
      updated_at: new Date().toISOString(),
    })
    .eq("id", curationId);

  console.log(
    `[Lesson Curation] Complete. Processed ${lessonsToProcess.length} lessons.`,
  );
  return curatedResults.length;
}
