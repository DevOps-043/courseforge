import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { materialsGenerationPrompt } from '../../src/shared/config/prompts/materials-generation.prompts';

// Types
interface MaterialsGenerationInput {
    lesson: {
        lesson_id: string;
        lesson_title: string;
        module_id: string;
        module_title: string;
        oa_text: string;
        components: { type: string; summary: string }[];
        quiz_spec: { min_questions: number; max_questions: number; types: string[] } | null;
        requires_demo_guide: boolean;
    };
    sources: {
        id: string;
        source_title: string;
        source_ref: string;
        cobertura_completa: boolean;
    }[];
    iteration_number: number;
    fix_instructions?: string;
}

interface RequestBody {
    artifactId?: string;
    materialsId: string;
    lessonId?: string;
    fixInstructions?: string;
    iterationNumber?: number;
}

// Setup
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const handler: Handler = async (event) => {
    // 1. Parse Request
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body: RequestBody;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, body: 'Bad Request: Invalid JSON' };
    }

    const { artifactId, materialsId, lessonId, fixInstructions, iterationNumber } = body;

    if (!materialsId) {
        return { statusCode: 400, body: 'Missing required field: materialsId' };
    }

    console.log(`[Materials Background] Starting generation for materialsId: ${materialsId}`);

    // 2. Setup Clients
    const supabase = createClient(supabaseUrl, supabaseKey);

    const genAI = new GoogleGenAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || '',
    });

    try {
        // 3. Fetch Materials Record
        const { data: materials, error: materialsError } = await supabase
            .from('materials')
            .select('*, artifact_id')
            .eq('id', materialsId)
            .single();

        if (materialsError || !materials) {
            throw new Error(`Materials record not found: ${materialsError?.message}`);
        }

        const targetArtifactId = artifactId || materials.artifact_id;

        // 4. Fetch Instructional Plan (Paso 3)
        const { data: planRecord, error: planError } = await supabase
            .from('instructional_plans')
            .select('lesson_plans')
            .eq('artifact_id', targetArtifactId)
            .single();

        if (planError || !planRecord) {
            throw new Error(`Instructional plan not found: ${planError?.message}`);
        }

        // 5. Fetch Curated Sources (Paso 4)
        const { data: curationRecord, error: curationError } = await supabase
            .from('curation')
            .select('id')
            .eq('artifact_id', targetArtifactId)
            .single();

        if (curationError || !curationRecord) {
            throw new Error(`Curation record not found: ${curationError?.message}`);
        }

        const { data: curationRows, error: rowsError } = await supabase
            .from('curation_rows')
            .select('*')
            .eq('curation_id', curationRecord.id)
            .eq('apta', true); // Only apt sources

        if (rowsError) {
            throw new Error(`Error fetching curation rows: ${rowsError.message}`);
        }

        const aptaSources = curationRows || [];
        console.log(`[Materials Background] Found ${aptaSources.length} apt sources`);

        // 6. Determine which lessons to process
        let lessonsToProcess: any[] = planRecord.lesson_plans;

        if (lessonId) {
            // Single lesson fix mode
            const { data: lessonRecord, error: lessonError } = await supabase
                .from('material_lessons')
                .select('*')
                .eq('id', lessonId)
                .single();

            if (lessonError || !lessonRecord) {
                throw new Error(`Lesson not found: ${lessonError?.message}`);
            }

            console.log(`[Materials Background] Single lesson mode - Looking for lesson_id: ${lessonRecord.lesson_id}, lesson_title: ${lessonRecord.lesson_title}`);
            console.log(`[Materials Background] Available lesson_plans count: ${planRecord.lesson_plans?.length}`);

            // Try to find by lesson_id first, then by title
            lessonsToProcess = planRecord.lesson_plans.filter(
                (lp: any) => lp.lesson_id === lessonRecord.lesson_id || lp.lesson_title === lessonRecord.lesson_title
            );

            // If no match found, log available lesson_ids for debugging
            if (lessonsToProcess.length === 0) {
                const availableIds = planRecord.lesson_plans.map((lp: any) => lp.lesson_id).slice(0, 10);
                console.log(`[Materials Background] WARNING: No matching lesson found. Available lesson_ids (first 10): ${availableIds.join(', ')}`);

                // Fallback: create a minimal lesson plan from the lessonRecord data
                console.log(`[Materials Background] Using fallback: recreating lesson plan from material_lessons record`);
                lessonsToProcess = [{
                    lesson_id: lessonRecord.lesson_id,
                    lesson_title: lessonRecord.lesson_title,
                    module_id: lessonRecord.module_id,
                    module_title: lessonRecord.module_title,
                    oa_text: lessonRecord.oa_text,
                    components: lessonRecord.expected_components.map((c: string) => ({ type: c, summary: '' })),
                    quiz_spec: lessonRecord.quiz_spec,
                    requires_demo_guide: lessonRecord.requires_demo_guide || false,
                    // IMPORTANT: Store the existing DB record ID for regeneration
                    _existingRecordId: lessonRecord.id
                }];
            } else {
                // Even when found, attach the existing record ID for regeneration
                lessonsToProcess = lessonsToProcess.map((lp: any) => ({
                    ...lp,
                    _existingRecordId: lessonRecord.id
                }));
            }
        }

        console.log(`[Materials Background] Processing ${lessonsToProcess.length} lessons`);

        // 7. Fetch Model Settings from DB
        const DEFAULT_MODEL = 'gemini-2.5-pro';
        const DEFAULT_FALLBACK = 'gemini-2.5-flash';
        const STABLE_FALLBACK = 'gemini-2.0-flash'; // More stable option

        const { data: modelSettings } = await supabase
            .from('model_settings')
            .select('*')
            .eq('setting_type', 'MATERIALS')
            .eq('is_active', true)
            .single();

        let activeModel = modelSettings?.model_name || DEFAULT_MODEL;
        const fallbackModel = modelSettings?.fallback_model || DEFAULT_FALLBACK;
        const modelSequence = [activeModel, fallbackModel, STABLE_FALLBACK];
        console.log(`[Materials Background] Model sequence: ${modelSequence.join(' -> ')}`);

        // 8. Batch processing configuration (conservative to avoid rate limits)
        const BATCH_SIZE = 2; // Process 2 lessons per batch (reduced from 5)
        const DELAY_BETWEEN_LESSONS_MS = 15000; // 15 seconds between lessons
        const DELAY_BETWEEN_BATCHES_MS = 60000; // 60 seconds between batches
        const MAX_RETRIES_PER_LESSON = 3; // Max retries per lesson before moving to next
        const BASE_RETRY_DELAY_MS = 30000; // 30 seconds base for exponential backoff

        // Exponential backoff helper with jitter
        const getExponentialBackoffDelay = (attempt: number): number => {
            const jitter = Math.random() * 5000; // 0-5 seconds random jitter
            return Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt) + jitter, 300000); // Max 5 minutes
        };

        // Split lessons into batches
        const batches: any[][] = [];
        for (let i = 0; i < lessonsToProcess.length; i += BATCH_SIZE) {
            batches.push(lessonsToProcess.slice(i, i + BATCH_SIZE));
        }
        console.log(`[Materials Background] Split into ${batches.length} batches of up to ${BATCH_SIZE} lessons`);

        let totalProcessed = 0;
        let totalSuccessful = 0;

        // Process each batch
        let globalLessonIndex = 0; // Track global lesson index across all batches
        for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
            const batch = batches[batchIdx];
            console.log(`[Materials Background] ========== BATCH ${batchIdx + 1}/${batches.length} (${batch.length} lessons) ==========`);

            for (let lessonIdx = 0; lessonIdx < batch.length; lessonIdx++) {
                const lessonPlan = batch[lessonIdx];
                globalLessonIndex++; // Increment for each lesson
                console.log(`[Materials Background] Processing lesson #${globalLessonIndex}: ${lessonPlan.lesson_title}`);

                // For single-lesson regeneration, use the existing record directly
                let materialLesson;
                if (lessonPlan._existingRecordId) {
                    console.log(`[Materials Background] Using existing lesson record: ${lessonPlan._existingRecordId}`);
                    const { data: existingLesson } = await supabase
                        .from('material_lessons')
                        .select('*')
                        .eq('id', lessonPlan._existingRecordId)
                        .single();
                    materialLesson = existingLesson;
                } else {
                    // Find or create material_lesson record - pass globalLessonIndex for unique ID
                    materialLesson = await findOrCreateMaterialLesson(supabase, materialsId, lessonPlan, globalLessonIndex);
                }

                if (!materialLesson) {
                    console.error(`[Materials Background] Could not find/create lesson record for: ${lessonPlan.lesson_title}`);
                    continue;
                }

                // Update state to GENERATING
                await supabase
                    .from('material_lessons')
                    .update({
                        state: 'GENERATING',
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', materialLesson.id);

                // Get sources for this lesson
                const lessonSources = aptaSources.filter(
                    (s: any) => s.lesson_id === lessonPlan.lesson_id || s.lesson_title === lessonPlan.lesson_title
                );

                // Build generation input
                const input: MaterialsGenerationInput = {
                    lesson: {
                        lesson_id: lessonPlan.lesson_id,
                        lesson_title: lessonPlan.lesson_title,
                        module_id: lessonPlan.module_id,
                        module_title: lessonPlan.module_title,
                        oa_text: lessonPlan.oa_text,
                        components: lessonPlan.components.map((c: any) => ({
                            type: c.type,
                            summary: c.summary || '',
                        })),
                        quiz_spec: materialLesson.quiz_spec || { min_questions: 3, max_questions: 5, types: ['MULTIPLE_CHOICE', 'TRUE_FALSE'] },
                        requires_demo_guide: lessonPlan.components?.some((c: any) => c.type === 'DEMO_GUIDE') || false,
                    },
                    sources: lessonSources.map((s: any) => ({
                        id: s.id,
                        source_title: s.source_title || s.source_ref,
                        source_ref: s.source_ref,
                        cobertura_completa: s.cobertura_completa || false,
                    })),
                    iteration_number: iterationNumber || materialLesson.iteration_count || 1,
                    fix_instructions: fixInstructions,
                };

                // Generate materials with Gemini (with retry, exponential backoff, and model fallback)
                let generatedContent = null;
                let usedModel = activeModel;
                let lessonRetryAttempt = 0;
                let shouldContinueToNextLesson = false;

                retryLoop: while (lessonRetryAttempt < MAX_RETRIES_PER_LESSON) {
                    for (let modelIdx = 0; modelIdx < modelSequence.length; modelIdx++) {
                        usedModel = modelSequence[modelIdx];
                        try {
                            console.log(`[Materials Background] Attempt ${lessonRetryAttempt + 1}/${MAX_RETRIES_PER_LESSON}, Model ${modelIdx + 1}/${modelSequence.length}: ${usedModel}`);
                            generatedContent = await generateMaterialsWithGemini(genAI, usedModel, input);
                            break retryLoop; // Success, exit all loops
                        } catch (genError: any) {
                            const errorStatus = genError.status || genError.code;
                            const errorMsg = genError.message || '';

                            const isRateLimited = errorStatus === 429 ||
                                errorMsg.includes('429') ||
                                errorMsg.includes('rate limit') ||
                                errorMsg.includes('quota');
                            const isOverloaded = errorStatus === 503 ||
                                errorMsg.includes('503') ||
                                errorMsg.includes('overloaded');
                            const isJsonError = errorMsg.includes('JSON');

                            console.warn(`[Materials Background] Error: ${isRateLimited ? '429 Rate Limit' : isOverloaded ? '503 Overloaded' : isJsonError ? 'JSON Parse' : 'Unknown'} - ${errorMsg}`);

                            // For rate limits: wait with exponential backoff, then retry same model
                            if (isRateLimited) {
                                lessonRetryAttempt++;
                                if (lessonRetryAttempt < MAX_RETRIES_PER_LESSON) {
                                    const backoffDelay = getExponentialBackoffDelay(lessonRetryAttempt - 1);
                                    console.log(`[Materials Background] ⏳ Rate limited. Waiting ${Math.round(backoffDelay / 1000)}s before retry...`);
                                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                                    continue retryLoop; // Retry from beginning of model sequence
                                }
                            }

                            // For overload/JSON errors: try next model immediately
                            if ((isOverloaded || isJsonError) && modelIdx < modelSequence.length - 1) {
                                console.warn(`[Materials Background] Model ${usedModel} failed. Trying next model...`);
                                await new Promise(resolve => setTimeout(resolve, 3000));
                                continue; // Try next model
                            }

                            // All models exhausted for this attempt
                            if (modelIdx === modelSequence.length - 1) {
                                lessonRetryAttempt++;
                                if (lessonRetryAttempt < MAX_RETRIES_PER_LESSON && !isRateLimited) {
                                    const backoffDelay = getExponentialBackoffDelay(lessonRetryAttempt - 1);
                                    console.log(`[Materials Background] All models failed. Waiting ${Math.round(backoffDelay / 1000)}s before retry...`);
                                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                                    continue retryLoop;
                                }
                            }
                        }
                    } // End model loop
                    break; // Exit if we completed model loop without success
                } // End retry loop

                // If all retries exhausted, mark as failed
                if (!generatedContent) {
                    console.error(`[Materials Background] All retries exhausted for ${lessonPlan.lesson_title}`);
                    await supabase
                        .from('material_lessons')
                        .update({
                            state: 'NEEDS_FIX',
                            dod: {
                                control3_consistency: 'FAIL',
                                control4_sources: 'PENDING',
                                control5_quiz: 'PENDING',
                                errors: [`Error: Máximo de reintentos alcanzado después de ${MAX_RETRIES_PER_LESSON} intentos con todos los modelos`],
                            },
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', materialLesson.id);
                }

                // If generation succeeded, save components
                if (generatedContent) {
                    try {
                        await saveGeneratedComponents(supabase, materialLesson.id, generatedContent, input.iteration_number);

                        // Update lesson state
                        await supabase
                            .from('material_lessons')
                            .update({
                                state: 'GENERATED',
                                updated_at: new Date().toISOString(),
                            })
                            .eq('id', materialLesson.id);

                        console.log(`[Materials Background] Lesson ${lessonPlan.lesson_title} generated successfully with ${usedModel}`);
                        totalSuccessful++;
                    } catch (saveError: any) {
                        console.error(`[Materials Background] Error saving components for ${lessonPlan.lesson_title}:`, saveError);
                        // Mark lesson as failed instead of silently continuing
                        await supabase
                            .from('material_lessons')
                            .update({
                                state: 'NEEDS_FIX',
                                dod: {
                                    control3_consistency: 'FAIL',
                                    control4_sources: 'PENDING',
                                    control5_quiz: 'PENDING',
                                    errors: [`Error al guardar componentes: ${saveError.message}`],
                                },
                                updated_at: new Date().toISOString(),
                            })
                            .eq('id', materialLesson.id);
                    }
                }

                totalProcessed++;

                // Delay between lessons within batch
                if (lessonIdx < batch.length - 1) {
                    console.log(`[Materials Background] Waiting ${DELAY_BETWEEN_LESSONS_MS / 1000}s before next lesson...`);
                    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_LESSONS_MS));
                }
            } // End of lessons loop within batch

            // Delay between batches (except after last batch)
            if (batchIdx < batches.length - 1) {
                console.log(`[Materials Background] ⏸️ Batch ${batchIdx + 1} complete. Waiting ${DELAY_BETWEEN_BATCHES_MS / 1000}s before next batch...`);
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
            }
        } // End of batches loop

        // 9. Update materials state
        await supabase
            .from('materials')
            .update({
                state: 'PHASE3_VALIDATING',
                updated_at: new Date().toISOString(),
            })
            .eq('id', materialsId);

        console.log(`[Materials Background] Generation complete: ${totalSuccessful}/${totalProcessed} lessons successful`);

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, lessonsProcessed: totalProcessed, successful: totalSuccessful }),
        };

    } catch (err: any) {
        console.error('[Materials Background] Generation Failed:', err);

        // Update materials state to NEEDS_FIX
        await supabase
            .from('materials')
            .update({
                state: 'PHASE3_NEEDS_FIX',
                updated_at: new Date().toISOString(),
            })
            .eq('id', materialsId);

        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: err.message }),
        };
    }
};

// === HELPER FUNCTIONS ===

async function findOrCreateMaterialLesson(
    supabase: any,
    materialsId: string,
    lessonPlan: any,
    globalIndex: number // NEW: Guaranteed unique index from main loop
): Promise<any> {
    // GUARANTEED UNIQUE ID: Always generate composite ID using globalIndex
    // Format: {baseId}-G{globalIndex}
    // This ensures uniqueness even if lesson_id from Step 3 is duplicated

    const moduleIndex = lessonPlan.module_index ?? lessonPlan.module_id ?? 0;
    const lessonOrder = lessonPlan.lesson_order ?? lessonPlan.lesson_index ?? globalIndex;

    // Use the original lesson_id if provided, otherwise create a descriptive base
    const baseId = lessonPlan.lesson_id || `M${moduleIndex}-L${lessonOrder}`;

    // ALWAYS append globalIndex to guarantee uniqueness within this materials run
    const effectiveLessonId = `${baseId}-G${globalIndex}`;

    console.log(`[Materials Background] Generated unique lesson_id: ${effectiveLessonId} (from base: ${lessonPlan.lesson_id || 'undefined'})`);

    console.log(`[Materials Background] Finding/creating lesson: ${effectiveLessonId} - ${lessonPlan.lesson_title}`);

    // Check if exists
    const { data: existing, error: findError } = await supabase
        .from('material_lessons')
        .select('*')
        .eq('materials_id', materialsId)
        .eq('lesson_id', effectiveLessonId)
        .maybeSingle();

    if (findError) {
        console.error(`[Materials Background] Error searching for lesson ${effectiveLessonId}:`, findError);
    }

    if (existing) {
        console.log(`[Materials Background] ✓ Found existing lesson record: ${existing.id}`);
        return existing;
    }

    // Create new
    console.log(`[Materials Background] Creating new lesson record for: ${effectiveLessonId}`);
    const { data: created, error } = await supabase
        .from('material_lessons')
        .insert({
            materials_id: materialsId,
            lesson_id: effectiveLessonId,
            lesson_title: lessonPlan.lesson_title,
            module_id: lessonPlan.module_id || `mod-${lessonPlan.module_index || 0}`,
            module_title: lessonPlan.module_title,
            oa_text: lessonPlan.oa_text,
            expected_components: lessonPlan.components.map((c: any) => c.type),
            quiz_spec: { min_questions: 3, max_questions: 5, types: ['MULTIPLE_CHOICE', 'TRUE_FALSE'] },
            requires_demo_guide: lessonPlan.components?.some((c: any) => c.type === 'DEMO_GUIDE') || false,
            state: 'PENDING',
            dod: { control3_consistency: 'PENDING', control4_sources: 'PENDING', control5_quiz: 'PENDING', errors: [] },
        })
        .select()
        .single();

    if (error) {
        console.error(`[Materials Background] Error creating lesson ${effectiveLessonId}:`, error);
        throw new Error(`Error creating material_lesson: ${error.message}`);
    }

    console.log(`[Materials Background] ✓ Created new lesson record: ${created.id}`);
    return created;
}

async function generateMaterialsWithGemini(
    genAI: GoogleGenAI,
    modelName: string,
    input: MaterialsGenerationInput
): Promise<any> {
    // Build the prompt
    let prompt = materialsGenerationPrompt;

    // Add input context
    const inputContext = `
## DATOS DE ENTRADA

\`\`\`json
${JSON.stringify(input, null, 2)}
\`\`\`

Genera los materiales basándote en el plan instruccional y las fuentes curadas proporcionadas.
RECUERDA: Responde SOLO con JSON válido, sin texto adicional.
`;

    const fullPrompt = prompt + '\n\n' + inputContext;

    console.log(`[Materials Background] Calling Gemini (${modelName}) with ${fullPrompt.length} chars`);

    // Call Gemini
    const response = await genAI.models.generateContent({
        model: modelName,
        contents: fullPrompt,
        config: {
            temperature: 0.7,
            maxOutputTokens: 16000,
        },
    });

    // Extract text from response
    const responseText = response.text || '';

    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error('No valid JSON found in Gemini response');
    }

    try {
        return JSON.parse(jsonMatch[0]);
    } catch (parseError) {
        console.error('[Materials Background] JSON Parse Error. Raw text:', responseText.substring(0, 500));
        throw new Error('Failed to parse Gemini response as JSON');
    }
}

async function saveGeneratedComponents(
    supabase: any,
    materialLessonId: string,
    generatedContent: any,
    iterationNumber: number
): Promise<void> {
    const components = generatedContent.components || {};
    const sourceRefsUsed = generatedContent.source_refs_used || [];

    // Delete old components for this iteration (if re-generating)
    await supabase
        .from('material_components')
        .delete()
        .eq('material_lesson_id', materialLessonId)
        .eq('iteration_number', iterationNumber);

    // Insert new components
    const componentTypes = Object.keys(components);

    for (const type of componentTypes) {
        const content = components[type];

        if (!content) continue;

        const { error } = await supabase
            .from('material_components')
            .insert({
                material_lesson_id: materialLessonId,
                type: type,
                content: content,
                source_refs: sourceRefsUsed,
                validation_status: 'PENDING',
                validation_errors: [],
                iteration_number: iterationNumber,
            });

        if (error) {
            console.error(`[Materials Background] Error saving component ${type}:`, error);
        }
    }

    console.log(`[Materials Background] Saved ${componentTypes.length} components`);
}
