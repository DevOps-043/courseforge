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

            lessonsToProcess = planRecord.lesson_plans.filter(
                (lp: any) => lp.lesson_id === lessonRecord.lesson_id
            );
        }

        console.log(`[Materials Background] Processing ${lessonsToProcess.length} lessons`);

        // 7. Process each lesson
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

        for (const lessonPlan of lessonsToProcess) {
            console.log(`[Materials Background] Processing lesson: ${lessonPlan.lesson_title}`);

            // Find or create material_lesson record
            let materialLesson = await findOrCreateMaterialLesson(supabase, materialsId, lessonPlan);

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

            // Generate materials with Gemini
            try {
                const generatedContent = await generateMaterialsWithGemini(genAI, modelName, input);

                // Save components to database
                await saveGeneratedComponents(supabase, materialLesson.id, generatedContent, input.iteration_number);

                // Update lesson state
                await supabase
                    .from('material_lessons')
                    .update({
                        state: 'GENERATED',
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', materialLesson.id);

                console.log(`[Materials Background] Lesson ${lessonPlan.lesson_title} generated successfully`);

            } catch (genError: any) {
                console.error(`[Materials Background] Generation failed for ${lessonPlan.lesson_title}:`, genError);

                await supabase
                    .from('material_lessons')
                    .update({
                        state: 'NEEDS_FIX',
                        dod: {
                            control3_consistency: 'FAIL',
                            control4_sources: 'PENDING',
                            control5_quiz: 'PENDING',
                            errors: [`Error de generación: ${genError.message}`],
                        },
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', materialLesson.id);
            }
        }

        // 8. Update materials state
        await supabase
            .from('materials')
            .update({
                state: 'PHASE3_VALIDATING',
                updated_at: new Date().toISOString(),
            })
            .eq('id', materialsId);

        console.log(`[Materials Background] Generation complete for ${lessonsToProcess.length} lessons`);

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, lessonsProcessed: lessonsToProcess.length }),
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
    lessonPlan: any
): Promise<any> {
    // Check if exists
    const { data: existing } = await supabase
        .from('material_lessons')
        .select('*')
        .eq('materials_id', materialsId)
        .eq('lesson_id', lessonPlan.lesson_id)
        .maybeSingle();

    if (existing) {
        return existing;
    }

    // Create new
    const { data: created, error } = await supabase
        .from('material_lessons')
        .insert({
            materials_id: materialsId,
            lesson_id: lessonPlan.lesson_id,
            lesson_title: lessonPlan.lesson_title,
            module_id: lessonPlan.module_id,
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
        throw new Error(`Error creating material_lesson: ${error.message}`);
    }

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
