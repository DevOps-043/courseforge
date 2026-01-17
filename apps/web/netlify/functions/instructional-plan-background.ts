
import { Handler } from '@netlify/functions';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { INSTRUCTIONAL_PLAN_SYSTEM_PROMPT } from '../../src/config/prompts/instructional-plan';

// Constants
const MAX_RETRIES = 3;

// Schemas for Phase 3 (Instructional Plan)
const ComponentSchema = z.object({
  type: z.enum(['DIALOGUE', 'READING', 'QUIZ', 'VIDEO_THEORETICAL', 'VIDEO_DEMO', 'VIDEO_GUIDE', 'EXERCISE', 'DEMO_GUIDE'])
    .describe("El tipo exacto de componente. CRÍTICO: Usa 'VIDEO_THEORETICAL' para conceptos abstractos, 'VIDEO_DEMO' para mostrar ejemplos reales, y 'VIDEO_GUIDE' para tutoriales paso a paso."),
  summary: z.string().describe("Descripción detallada del componente (2-3 oraciones). Debe justificar por qué se eligió este formato específico."),
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
  alignment_notes: z.string().optional()
});

const GeneratedPlanSchema = z.object({
  lesson_plans: z.array(LessonPlanSchema),
  blockers: z.array(z.any()).optional().default([])
});

// Setup Clients
const googleAI = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY
});

export const handler: Handler = async (event, context) => {
    // 1. Parsing Request
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, body: 'Bad Request: Invalid JSON' };
    }

    const { artifactId, userToken, customPrompt, useCustomPrompt } = body;

    if (!artifactId || !userToken) {
        return { statusCode: 400, body: 'Missing required fields' };
    }

    console.log(`[Background Job] Starting Instructional Plan generation for artifacts/${artifactId}`);

    // 2. Setup Supabase Client
    // 2. Setup Supabase Client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    // Use Service Role Key to avoid JWT expiration during long runs
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    
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
            .from('artifacts')
            .select('*')
            .eq('id', artifactId)
            .single();

        if (artifactError || !artifact) throw new Error(`Artifact not found: ${artifactError?.message}`);

        const { data: syllabusRecord, error: syllabusError } = await supabase
            .from('syllabus')
            .select('modules') // Only need the modules JSON
            .eq('artifact_id', artifactId)
            .single();
        
        if (syllabusError) throw new Error(`Syllabus not found: ${syllabusError.message}`);
        if (!syllabusRecord || !syllabusRecord.modules) throw new Error("Syllabus record has no modules.");

        const syllabusModules = syllabusRecord.modules;

        // Flatten lessons for context
        let allLessons: any[] = [];
        // Assuming syllabusModules is an array of objects
        if (Array.isArray(syllabusModules)) {
            syllabusModules.forEach((mod: any, index: number) => {
                 if (mod.lessons && Array.isArray(mod.lessons)) {
                     mod.lessons.forEach((l: any) => {
                         allLessons.push({
                             ...l,
                             module_id: mod.id || `mod-${index}`,
                             module_title: mod.title,
                             module_index: index // Use array index as module index
                         });
                     });
                 }
            });
        }

        if (allLessons.length === 0) {
            throw new Error("No lessons found in syllabus to plan.");
        }

        // --- STEP 2: PREPARE PROMPTS ---
        
        // A) System Prompt (Immutable Rules)
        const systemPromptRef = INSTRUCTIONAL_PLAN_SYSTEM_PROMPT;

        // B) User Context Prompt (Variable)
        let contextPromptTemplate = "";
        
        if (useCustomPrompt && customPrompt && customPrompt.trim().length > 0) {
            console.log("[Background Job] Using CUSTOM User Prompt.");
            contextPromptTemplate = customPrompt;
        } else {
            console.log("[Background Job] Using DATABASE Default User Prompt.");
            const { data: dbPrompt, error: promptError } = await supabase
                .from('system_prompts')
                .select('content')
                .eq('code', 'INSTRUCTIONAL_PLAN')
                .eq('is_active', true)
                .single();
            
            if (promptError || !dbPrompt) {
                console.warn("[Background Job] DB Prompt not found, using fallback string.");
                contextPromptTemplate = `CONTEXTO DEL CURSO:
Curso: \${courseName}
Idea Central: \${ideaCentral}

ESTRUCTURA DE LECCIONES (\${lessonCount}):
\${lessonsText}`;
            } else {
                contextPromptTemplate = dbPrompt.content;
            }
        }

        // C) Variable Replacement
        const lessonsText = allLessons.map((l, i) => 
            `${i+1}. ID: ${l.id}\n   Módulo: ${l.module_title}\n   Lección: ${l.title}\n   OA Original: ${l.objective_specific || 'N/A'}`
        ).join('\n\n');

        const courseName = (artifact.nombres && artifact.nombres[0]) || artifact.idea_central || "Curso Sin Nombre";
        const ideaCentral = artifact.idea_central || "Sin descripción";

        // Replace placeholders
        // We support both ${var} and {{var}} styles just in case
        let finalContextPrompt = contextPromptTemplate
            .replace(/\$\{courseName\}/g, courseName).replace(/\{\{courseName\}\}/g, courseName)
            .replace(/\$\{ideaCentral\}/g, ideaCentral).replace(/\{\{ideaCentral\}\}/g, ideaCentral)
            .replace(/\$\{lessonCount\}/g, String(allLessons.length)).replace(/\{\{lessonCount\}\}/g, String(allLessons.length))
            .replace(/\$\{lessonsText\}/g, lessonsText).replace(/\{\{lessonsText\}\}/g, lessonsText);


        // --- STEP 3: GENERATE WITH GEMINI ---
        const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash'; // Fallback to a stable model
        console.log(`[Background Job] Generando plan con modelo: ${modelName}`);
        console.log(`[Background Job] Context payload size: ~${finalContextPrompt.length} chars`);

        let generatedPlan;
        try {
            const result = await generateObject({
                model: googleAI(modelName),
                schema: GeneratedPlanSchema,
                prompt: `${systemPromptRef}\n\n═══════════════════════════════════════════════════════════════\n    CONTEXTO Y TAREA ESPECÍFICA (Variable)\n═══════════════════════════════════════════════════════════════\n\n${finalContextPrompt}`,
                temperature: 0.7,
            });
            generatedPlan = result.object;
            console.log(`[Background Job] Generation completed. Received ${generatedPlan.lesson_plans?.length} lessons.`);
        } catch (genError: any) {
            console.error(`[Background Job] AI Generation Failed:`, genError);
            throw new Error(`AI generation failed: ${genError.message}`);
        }

        const lessonPlanCount = generatedPlan.lesson_plans?.length || 0;
        if (lessonPlanCount === 0) {
            console.warn("[Background Job] Warning: AI returned 0 lessons.");
        }

        // --- STEP 4: SAVE TO DB ---
        
        // Check if plan exists to update or insert
        const { data: existingPlan } = await supabase
            .from('instructional_plans')
            .select('id')
            .eq('artifact_id', artifactId)
            .single();

        let saveError;
        if (existingPlan) {
            const { error } = await supabase.from('instructional_plans').update({
                lesson_plans: generatedPlan.lesson_plans,
                blockers: generatedPlan.blockers,
                state: 'STEP_READY_FOR_REVIEW', // Or similar status
                updated_at: new Date().toISOString()
            }).eq('id', existingPlan.id);
            saveError = error;
        } else {
            const { error } = await supabase.from('instructional_plans').insert({
                artifact_id: artifactId,
                lesson_plans: generatedPlan.lesson_plans,
                blockers: generatedPlan.blockers,
                state: 'STEP_READY_FOR_REVIEW'
            });
            saveError = error;
        }

        if (saveError) throw saveError;

        // Update Artifact Status too if needed (optional based on your flow)
        // await supabase.from('artifacts').update({ instructional_plan_status: 'READY' }).eq('id', artifactId);

        console.log(`[Background Job] Plan generated successfully for ${generatedPlan.lesson_plans.length} lessons.`);

        return { statusCode: 200, body: JSON.stringify({ success: true, count: generatedPlan.lesson_plans.length }) };

    } catch (err: any) {
        console.error('[Background Job] Generation Failed:', err);
        return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
    }
};
