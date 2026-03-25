import { Handler } from "@netlify/functions";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { INSTRUCTIONAL_PLAN_SYSTEM_PROMPT } from "../../src/config/prompts/instructional-plan";

// Constants
const MAX_RETRIES = 3;

// Schemas for Phase 3 (Instructional Plan)
const ComponentSchema = z.object({
  type: z
    .enum([
      "DIALOGUE",
      "READING",
      "QUIZ",
      "VIDEO_THEORETICAL",
      "VIDEO_DEMO",
      "VIDEO_GUIDE",
      "EXERCISE",
      "DEMO_GUIDE",
    ])
    .describe(
      "El tipo exacto de componente. CRÍTICO: Usa 'VIDEO_THEORETICAL' para conceptos abstractos, 'VIDEO_DEMO' para mostrar ejemplos reales, y 'VIDEO_GUIDE' para tutoriales paso a paso.",
    ),
  summary: z
    .string()
    .describe(
      "Descripción detallada del componente (2-3 oraciones). Debe justificar por qué se eligió este formato específico.",
    ),
});

const LessonPlanSchema = z.object({
  lesson_id: z.string(),
  lesson_title: z.string(),
  lesson_order: z.number(),
  module_id: z.string(),
  module_title: z.string(),
  module_index: z.number(),
  oa_text: z.string().describe("Objetivo de Aprendizaje específico"),
  oa_bloom_verb: z.string().optional(),
  measurable_criteria: z.string().optional(),
  course_type_detected: z.string().optional(),
  components: z.array(ComponentSchema),
  alignment_notes: z.string().optional(),
});

const GeneratedPlanSchema = z.object({
  lesson_plans: z.array(LessonPlanSchema),
  blockers: z.array(z.any()).optional().default([]),
});

// Setup Clients
const googleAI = createGoogleGenerativeAI({
  apiKey:
    process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY,
});

export const handler: Handler = async (event, context) => {
  // 1. Parsing Request
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: "Bad Request: Invalid JSON" };
  }

  const { artifactId, userToken, customPrompt, useCustomPrompt } = body;

  if (!artifactId || !userToken) {
    return { statusCode: 400, body: "Missing required fields" };
  }

  console.log(
    `[Background Job] Starting Instructional Plan generation for artifacts/${artifactId}`,
  );

  // 2. Setup Supabase Client
  // 2. Setup Supabase Client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  // Use Service Role Key to avoid JWT expiration during long runs
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const options: any = {};

  // Only use user token if we don't have the service role key (fallback)
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    options.global = {
      headers: { Authorization: `Bearer ${userToken}` },
    };
    console.log("[Background Job] Warn: Using User Token (Risk of JWT expiry)");
  } else {
    console.log("[Background Job] Using Service Role Key (Safe from expiry)");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, options);

  try {
    // --- STEP 1: FETCH ARTIFACT & SYLLABUS ---
    const { data: artifact, error: artifactError } = await supabase
      .from("artifacts")
      .select("*")
      .eq("id", artifactId)
      .single();

    if (artifactError || !artifact)
      throw new Error(`Artifact not found: ${artifactError?.message}`);

    const { data: syllabusRecord, error: syllabusError } = await supabase
      .from("syllabus")
      .select("modules")
      .eq("artifact_id", artifactId)
      .single();

    if (syllabusError)
      throw new Error(`Syllabus not found: ${syllabusError.message}`);
    if (!syllabusRecord || !syllabusRecord.modules)
      throw new Error("Syllabus record has no modules.");

    const syllabusModules = syllabusRecord.modules as any[];

    if (!Array.isArray(syllabusModules) || syllabusModules.length === 0) {
      throw new Error("Syllabus modules is empty or not an array.");
    }

    // --- STEP 2: PREPARE PROMPTS ---
    const systemPromptRef = INSTRUCTIONAL_PLAN_SYSTEM_PROMPT;
    let contextPromptTemplate = "";

    if (useCustomPrompt && customPrompt && customPrompt.trim().length > 0) {
      contextPromptTemplate = customPrompt;
    } else {
      const { data: dbPrompt } = await supabase
        .from("system_prompts")
        .select("content")
        .eq("code", "INSTRUCTIONAL_PLAN")
        .eq("is_active", true)
        .single();

      contextPromptTemplate =
        dbPrompt?.content ||
        `CONTEXTO DEL CURSO:
Curso: ${artifact.nombres?.[0] || artifact.idea_central}
Idea Central: ${artifact.idea_central}

ESTRUCTURA DE LECCIONES:
\${lessonsText}`;
    }

    // --- STEP 3: INITIALIZE OR CLEAR PLAN ---
    const { data: existingPlan } = await supabase
      .from("instructional_plans")
      .select("id")
      .eq("artifact_id", artifactId)
      .maybeSingle();

    if (existingPlan) {
      await supabase
        .from("instructional_plans")
        .update({
          lesson_plans: [],
          validation: null,
          state: "STEP_PROCESSING",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingPlan.id);
    } else {
      await supabase.from("instructional_plans").insert({
        artifact_id: artifactId,
        lesson_plans: [],
        validation: null,
        state: "STEP_PROCESSING",
      });
    }

    // --- STEP 4: INCREMENTAL GENERATION BY MODULE ---
    const modelName = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    console.log(
      `[Background Job] Starting incremental generation with ${modelName}`,
    );

    let allGeneratedPlans: any[] = [];

    for (let i = 0; i < syllabusModules.length; i++) {
      const mod = syllabusModules[i];
      const lessons = mod.lessons || [];
      if (lessons.length === 0) continue;

      console.log(
        `[Background Job] Processing Module ${i + 1}/${syllabusModules.length}: ${mod.title} (${lessons.length} lessons)`,
      );

      const lessonsText = lessons
        .map(
          (l: any, idx: number) =>
            `${idx + 1}. ID: ${l.id}\n   Lección: ${l.title}\n   OA Original: ${l.objective_specific || "N/A"}`,
        )
        .join("\n\n");

      const finalContextPrompt = contextPromptTemplate
        .replace(
          /\$\{courseName\}/g,
          artifact.nombres?.[0] || artifact.idea_central,
        )
        .replace(/\$\{ideaCentral\}/g, artifact.idea_central)
        .replace(/\$\{lessonsText\}/g, lessonsText)
        .replace(/\$\{currentModule\}/g, mod.title);

      try {
        const result = await generateObject({
          model: googleAI(modelName),
          schema: GeneratedPlanSchema,
          prompt: `${systemPromptRef}\n\nMODULO ACTUAL: ${mod.title}\n${finalContextPrompt}`,
          temperature: 0.7,
        });

        const modulePlans = result.object.lesson_plans.map((lp) => ({
          ...lp,
          module_id: mod.id || `mod-${i}`,
          module_title: mod.title,
          module_index: i,
        }));

        allGeneratedPlans = [...allGeneratedPlans, ...modulePlans];

        // Immediate partial save to DB
        await supabase
          .from("instructional_plans")
          .update({
            lesson_plans: allGeneratedPlans,
            updated_at: new Date().toISOString(),
          })
          .eq("artifact_id", artifactId);

        console.log(
          `[Background Job] Module ${i + 1} saved. Total lessons so far: ${allGeneratedPlans.length}`,
        );
      } catch (moduleError: any) {
        console.error(
          `[Background Job] Error in module ${i + 1}:`,
          moduleError,
        );
        // We could continue with other modules or fail.
        // Decision: Fail for now to ensure consistency.
        throw new Error(
          `Module ${i + 1} generation failed: ${moduleError.message}`,
        );
      }
    }

    // --- STEP 5: FINALIZE ---
    await supabase
      .from("instructional_plans")
      .update({
        state: "STEP_READY_FOR_REVIEW",
        updated_at: new Date().toISOString(),
      })
      .eq("artifact_id", artifactId);

    console.log(
      `[Background Job] Generation finished successfully for ${allGeneratedPlans.length} lessons.`,
    );
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, count: allGeneratedPlans.length }),
    };
  } catch (err: any) {
    console.error("[Background Job] Fatal Error:", err);

    // Attempt to mark as failed in DB
    await supabase
      .from("instructional_plans")
      .update({ state: "STEP_FAILED", updated_at: new Date().toISOString() })
      .eq("artifact_id", artifactId);

    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
