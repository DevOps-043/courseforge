import { Handler } from "@netlify/functions";
import {
  createGeminiClient,
  createServiceRoleClient,
} from "./shared/bootstrap";
import { getErrorMessage } from "./shared/errors";
import { methodNotAllowedResponse, parseJsonBody } from "./shared/http";
import {
  findOrCreateMaterialLesson,
  type MaterialLessonRecord,
} from "./shared/materials-generation-helpers";
import {
  generateLessonMaterials,
  loadLessonPlans,
  loadMaterialsGenerationContext,
  markMaterialsValidating,
  PROCESS_NEXT_DELAY_MS,
  resetGeneratingLessons,
  setLessonState,
  START_JITTER_MS,
  touchMaterialsRecord,
  triggerNextLesson,
  wait,
} from "./shared/materials-generation-runtime";

interface RequestBody {
  artifactId?: string;
  materialsId: string;
  lessonId?: string;
  fixInstructions?: string;
  iterationNumber?: number;
  mode?: "init" | "process-next" | "single-lesson";
}

interface MaterialsLookupRecord {
  artifact_id: string;
  id: string;
}

function buildExecutionId(materialsId: string) {
  return `${materialsId.substring(0, 8)}-${Date.now().toString(36)}`;
}

async function loadMaterialsRecord(materialsId: string) {
  const supabase = createServiceRoleClient();
  const { data: materials, error } = await supabase
    .from("materials")
    .select("id, artifact_id")
    .eq("id", materialsId)
    .single();

  if (error || !materials) {
    throw new Error(`Materials not found: ${error?.message}`);
  }

  return {
    supabase,
    materials: materials as MaterialsLookupRecord,
  };
}

async function loadSingleLesson(
  materialsId: string,
  lessonId: string,
) {
  const supabase = createServiceRoleClient();
  const { data: rawLesson } = await supabase
    .from("material_lessons")
    .select("*")
    .eq("materials_id", materialsId)
    .eq("id", lessonId)
    .single();

  if (!rawLesson) {
    throw new Error("Lesson not found");
  }

  return {
    supabase,
    lesson: rawLesson as MaterialLessonRecord,
  };
}

async function setupMaterialsLessons(params: {
  materialsId: string;
  artifactId: string;
  logPrefix: string;
}) {
  const { materialsId, artifactId, logPrefix } = params;
  const supabase = createServiceRoleClient();
  const lessonPlans = await loadLessonPlans(supabase, artifactId);

  if (lessonPlans.length === 0) {
    throw new Error("Instructional plan not found");
  }

  console.log(`${logPrefix} Creating ${lessonPlans.length} lesson records`);
  for (let index = 0; index < lessonPlans.length; index++) {
    await findOrCreateMaterialLesson(
      supabase,
      materialsId,
      lessonPlans[index],
      index + 1,
      logPrefix,
    );
  }

  return lessonPlans.length;
}

async function processSingleLesson(params: {
  materialsId: string;
  lessonId: string;
  artifactId: string;
  logPrefix: string;
  fixInstructions?: string;
  iterationNumber?: number;
}) {
  const {
    materialsId,
    lessonId,
    artifactId,
    logPrefix,
    fixInstructions,
    iterationNumber,
  } = params;
  const genAI = createGeminiClient();
  const { supabase, lesson } = await loadSingleLesson(materialsId, lessonId);
  const generationContext = await loadMaterialsGenerationContext(
    supabase,
    artifactId,
  );

  await setLessonState(supabase, lessonId, "GENERATING");

  const output = await generateLessonMaterials({
    supabase,
    genAI,
    lesson,
    generationContext,
    fixInstructions,
    iterationNumber,
    logPrefix,
  });

  return {
    statusCode: 200,
    body: JSON.stringify(output),
  };
}

async function processNextPendingLesson(params: {
  materialsId: string;
  artifactId: string;
  logPrefix: string;
}) {
  const { materialsId, artifactId, logPrefix } = params;
  const supabase = createServiceRoleClient();
  const genAI = createGeminiClient();

  await wait(Math.random() * START_JITTER_MS);

  const { data: pendingLessons } = await supabase
    .from("material_lessons")
    .select("*")
    .eq("materials_id", materialsId)
    .eq("state", "PENDING")
    .order("created_at", { ascending: true })
    .limit(1);

  if (!pendingLessons || pendingLessons.length === 0) {
    const { data: stuckLessons } = await supabase
      .from("material_lessons")
      .select("id")
      .eq("materials_id", materialsId)
      .eq("state", "GENERATING");

    if (stuckLessons && stuckLessons.length > 0) {
      console.log(`${logPrefix} Resetting ${stuckLessons.length} stuck lessons`);
      await resetGeneratingLessons(supabase, materialsId);
      await triggerNextLesson(materialsId, artifactId, logPrefix);
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, action: "reset-stuck" }),
      };
    }

    console.log(`${logPrefix} All lessons done. Setting VALIDATING.`);
    await markMaterialsValidating(supabase, materialsId);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, completed: true }),
    };
  }

  const lesson = pendingLessons[0] as MaterialLessonRecord;
  console.log(`${logPrefix} Processing: ${lesson.lesson_title}`);

  await setLessonState(supabase, lesson.id, "GENERATING");
  await touchMaterialsRecord(supabase, materialsId);

  const generationContext = await loadMaterialsGenerationContext(
    supabase,
    artifactId,
  );
  await generateLessonMaterials({
    supabase,
    genAI,
    lesson,
    generationContext,
    logPrefix,
  });

  console.log(`${logPrefix} Waiting ${PROCESS_NEXT_DELAY_MS}ms before next...`);
  await wait(PROCESS_NEXT_DELAY_MS);
  await triggerNextLesson(materialsId, artifactId, logPrefix);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, lesson: lesson.lesson_title }),
  };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return methodNotAllowedResponse();
  }

  let logPrefix = "[Mat unknown]";

  try {
    const body = parseJsonBody<RequestBody>(event);
    const {
      artifactId,
      materialsId,
      lessonId,
      fixInstructions,
      iterationNumber,
      mode = "init",
    } = body;

    if (!materialsId) {
      return {
        statusCode: 400,
        body: "Missing required field: materialsId",
      };
    }

    logPrefix = `[Mat ${buildExecutionId(materialsId)}]`;
    console.log(`${logPrefix} Mode: ${mode}, materialsId: ${materialsId}`);

    const { materials } = await loadMaterialsRecord(materialsId);
    const targetArtifactId = artifactId || materials.artifact_id;

    if (mode === "single-lesson" && lessonId) {
      return processSingleLesson({
        materialsId,
        lessonId,
        fixInstructions,
        iterationNumber,
        artifactId: targetArtifactId,
        logPrefix,
      });
    }

    if (mode === "init") {
      console.log(`${logPrefix} INIT: Setting up lessons`);
      const totalLessons = await setupMaterialsLessons({
        materialsId,
        artifactId: targetArtifactId,
        logPrefix,
      });

      await triggerNextLesson(materialsId, targetArtifactId, logPrefix);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          totalLessons,
        }),
      };
    }

    if (mode === "process-next") {
      return processNextPendingLesson({
        materialsId,
        artifactId: targetArtifactId,
        logPrefix,
      });
    }

    throw new Error(`Unknown mode: ${mode}`);
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: getErrorMessage(error),
      }),
    };
  }
};
