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
    mode?: 'init' | 'process-next' | 'single-lesson';
}

// Setup
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const getBaseUrl = (): string => {
    if (process.env.URL) return process.env.URL;
    if (process.env.DEPLOY_URL) return process.env.DEPLOY_URL;
    return 'http://localhost:8888';
};

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body: RequestBody;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, body: 'Bad Request: Invalid JSON' };
    }

    const { artifactId, materialsId, lessonId, fixInstructions, iterationNumber, mode = 'init' } = body;

    if (!materialsId) {
        return { statusCode: 400, body: 'Missing required field: materialsId' };
    }

    const executionId = `${materialsId.substring(0, 8)}-${Date.now().toString(36)}`;
    const logPrefix = `[Mat ${executionId}]`;

    console.log(`${logPrefix} Mode: ${mode}, materialsId: ${materialsId}`);

    const supabase = createClient(supabaseUrl, supabaseKey);
    const genAI = new GoogleGenAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || '',
    });

    try {
        const { data: materials, error: materialsError } = await supabase
            .from('materials')
            .select('*, artifact_id')
            .eq('id', materialsId)
            .single();

        if (materialsError || !materials) {
            throw new Error(`Materials not found: ${materialsError?.message}`);
        }

        const targetArtifactId = artifactId || materials.artifact_id;

        // SINGLE LESSON MODE
        if (mode === 'single-lesson' && lessonId) {
            return await processSingleLesson(supabase, genAI, materialsId, lessonId, fixInstructions, iterationNumber, targetArtifactId, logPrefix);
        }

        // INIT MODE: Create lessons and start chain
        if (mode === 'init') {
            console.log(`${logPrefix} INIT: Setting up lessons`);

            const { data: planRecord } = await supabase
                .from('instructional_plans')
                .select('lesson_plans')
                .eq('artifact_id', targetArtifactId)
                .single();

            if (!planRecord?.lesson_plans) {
                throw new Error('Instructional plan not found');
            }

            const lessonPlans = planRecord.lesson_plans;
            console.log(`${logPrefix} Creating ${lessonPlans.length} lesson records`);

            for (let i = 0; i < lessonPlans.length; i++) {
                await findOrCreateMaterialLesson(supabase, materialsId, lessonPlans[i], i + 1, logPrefix);
            }

            // Trigger first lesson
            await triggerNextLesson(materialsId, targetArtifactId, logPrefix);

            return {
                statusCode: 200,
                body: JSON.stringify({ success: true, totalLessons: lessonPlans.length }),
            };
        }

        // PROCESS-NEXT MODE: Process one lesson and chain
        if (mode === 'process-next') {
            // Small jitter to avoid collisions
            await new Promise(r => setTimeout(r, Math.random() * 3000));

            // Find next PENDING lesson
            const { data: pendingLessons } = await supabase
                .from('material_lessons')
                .select('*')
                .eq('materials_id', materialsId)
                .eq('state', 'PENDING')
                .order('created_at', { ascending: true })
                .limit(1);

            if (!pendingLessons || pendingLessons.length === 0) {
                // Check for stuck GENERATING lessons
                const { data: stuckLessons } = await supabase
                    .from('material_lessons')
                    .select('id')
                    .eq('materials_id', materialsId)
                    .eq('state', 'GENERATING');

                if (stuckLessons && stuckLessons.length > 0) {
                    console.log(`${logPrefix} Resetting ${stuckLessons.length} stuck lessons`);
                    await supabase
                        .from('material_lessons')
                        .update({ state: 'PENDING', updated_at: new Date().toISOString() })
                        .eq('materials_id', materialsId)
                        .eq('state', 'GENERATING');

                    await triggerNextLesson(materialsId, targetArtifactId, logPrefix);
                    return { statusCode: 200, body: JSON.stringify({ success: true, action: 'reset-stuck' }) };
                }

                // All done
                console.log(`${logPrefix} All lessons done. Setting VALIDATING.`);
                await supabase
                    .from('materials')
                    .update({ state: 'PHASE3_VALIDATING', updated_at: new Date().toISOString() })
                    .eq('id', materialsId);

                return { statusCode: 200, body: JSON.stringify({ success: true, completed: true }) };
            }

            const lesson = pendingLessons[0];
            console.log(`${logPrefix} Processing: ${lesson.lesson_title}`);

            // Mark GENERATING
            await supabase
                .from('material_lessons')
                .update({ state: 'GENERATING', updated_at: new Date().toISOString() })
                .eq('id', lesson.id);

            // Heartbeat
            await supabase
                .from('materials')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', materialsId);

            // Get sources
            const { data: curationRecord } = await supabase
                .from('curation')
                .select('id')
                .eq('artifact_id', targetArtifactId)
                .single();

            let aptaSources: any[] = [];
            if (curationRecord) {
                const { data: rows } = await supabase
                    .from('curation_rows')
                    .select('*')
                    .eq('curation_id', curationRecord.id)
                    .eq('apta', true);
                aptaSources = rows || [];
            }

            const lessonSources = aptaSources.filter(
                (s: any) => s.lesson_id === lesson.lesson_id || s.lesson_title === lesson.lesson_title
            );

            // Get plan details
            const { data: planRecord } = await supabase
                .from('instructional_plans')
                .select('lesson_plans')
                .eq('artifact_id', targetArtifactId)
                .single();

            const planDetails = planRecord?.lesson_plans?.find(
                (lp: any) => lp.lesson_id === lesson.lesson_id || lp.lesson_title === lesson.lesson_title
            );

            const input: MaterialsGenerationInput = {
                lesson: {
                    lesson_id: lesson.lesson_id,
                    lesson_title: lesson.lesson_title,
                    module_id: lesson.module_id,
                    module_title: lesson.module_title,
                    oa_text: lesson.oa_text || planDetails?.oa_text || '',
                    components: (lesson.expected_components || []).map((c: string) => ({
                        type: c,
                        summary: planDetails?.components?.find((comp: any) => comp.type === c)?.summary || '',
                    })),
                    quiz_spec: lesson.quiz_spec || { min_questions: 3, max_questions: 5, types: ['MULTIPLE_CHOICE', 'TRUE_FALSE'] },
                    requires_demo_guide: lesson.requires_demo_guide || false,
                },
                sources: lessonSources.map((s: any) => ({
                    id: s.id,
                    source_title: s.source_title || s.source_ref,
                    source_ref: s.source_ref,
                    cobertura_completa: s.cobertura_completa || false,
                })),
                iteration_number: lesson.iteration_count || 1,
            };

            const result = await generateWithRetry(genAI, input, logPrefix);

            if (result.success && result.content) {
                await saveGeneratedComponents(supabase, lesson.id, result.content, input.iteration_number, logPrefix);
                await supabase
                    .from('material_lessons')
                    .update({ state: 'GENERATED', updated_at: new Date().toISOString() })
                    .eq('id', lesson.id);
                console.log(`${logPrefix} ✓ ${lesson.lesson_title}`);
            } else {
                await supabase
                    .from('material_lessons')
                    .update({
                        state: 'NEEDS_FIX',
                        dod: { control3_consistency: 'FAIL', errors: [result.error || 'Failed'] },
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', lesson.id);
                console.log(`${logPrefix} ✗ ${lesson.lesson_title}: ${result.error}`);
            }

            // Wait then trigger next
            console.log(`${logPrefix} Waiting 8s before next...`);
            await new Promise(r => setTimeout(r, 8000));
            await triggerNextLesson(materialsId, targetArtifactId, logPrefix);

            return { statusCode: 200, body: JSON.stringify({ success: true, lesson: lesson.lesson_title }) };
        }

        throw new Error(`Unknown mode: ${mode}`);

    } catch (err: any) {
        console.error(`${logPrefix} Error:`, err);
        return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
    }
};

// === HELPERS ===

async function triggerNextLesson(materialsId: string, artifactId: string, logPrefix: string): Promise<void> {
    const url = `${getBaseUrl()}/.netlify/functions/materials-generation-background`;
    console.log(`${logPrefix} Triggering next at: ${url}`);

    try {
        // IMPORTANT: Must await to ensure request is sent before function terminates
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ materialsId, artifactId, mode: 'process-next' }),
        });
        console.log(`${logPrefix} Trigger response: ${response.status}`);
    } catch (err) {
        console.error(`${logPrefix} Trigger failed:`, err);
    }
}

async function processSingleLesson(
    supabase: any, genAI: GoogleGenAI, materialsId: string, lessonId: string,
    fixInstructions: string | undefined, iterationNumber: number | undefined,
    artifactId: string, logPrefix: string
): Promise<{ statusCode: number; body: string }> {
    const { data: lesson } = await supabase
        .from('material_lessons')
        .select('*')
        .eq('id', lessonId)
        .single();

    if (!lesson) throw new Error('Lesson not found');

    await supabase
        .from('material_lessons')
        .update({ state: 'GENERATING', updated_at: new Date().toISOString() })
        .eq('id', lessonId);

    const { data: curationRecord } = await supabase
        .from('curation')
        .select('id')
        .eq('artifact_id', artifactId)
        .single();

    let sources: any[] = [];
    if (curationRecord) {
        const { data: rows } = await supabase
            .from('curation_rows')
            .select('*')
            .eq('curation_id', curationRecord.id)
            .eq('apta', true);
        sources = (rows || []).filter(
            (s: any) => s.lesson_id === lesson.lesson_id || s.lesson_title === lesson.lesson_title
        );
    }

    const input: MaterialsGenerationInput = {
        lesson: {
            lesson_id: lesson.lesson_id,
            lesson_title: lesson.lesson_title,
            module_id: lesson.module_id,
            module_title: lesson.module_title,
            oa_text: lesson.oa_text || '',
            components: (lesson.expected_components || []).map((c: string) => ({ type: c, summary: '' })),
            quiz_spec: lesson.quiz_spec,
            requires_demo_guide: lesson.requires_demo_guide || false,
        },
        sources: sources.map((s: any) => ({
            id: s.id,
            source_title: s.source_title || s.source_ref,
            source_ref: s.source_ref,
            cobertura_completa: s.cobertura_completa || false,
        })),
        iteration_number: iterationNumber || lesson.iteration_count || 1,
        fix_instructions: fixInstructions,
    };

    const result = await generateWithRetry(genAI, input, logPrefix);

    if (result.success && result.content) {
        await saveGeneratedComponents(supabase, lessonId, result.content, input.iteration_number, logPrefix);
        await supabase.from('material_lessons').update({ state: 'GENERATED', updated_at: new Date().toISOString() }).eq('id', lessonId);
        return { statusCode: 200, body: JSON.stringify({ success: true }) };
    } else {
        await supabase.from('material_lessons').update({
            state: 'NEEDS_FIX',
            dod: { control3_consistency: 'FAIL', errors: [result.error || 'Failed'] },
            updated_at: new Date().toISOString(),
        }).eq('id', lessonId);
        return { statusCode: 200, body: JSON.stringify({ success: false, error: result.error }) };
    }
}

async function generateWithRetry(
    genAI: GoogleGenAI, input: MaterialsGenerationInput, logPrefix: string
): Promise<{ success: boolean; content?: any; error?: string }> {
    const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

    for (let retry = 0; retry < 2; retry++) {
        for (const model of models) {
            try {
                console.log(`${logPrefix} Try ${retry + 1}, Model: ${model}`);
                const content = await generateMaterialsWithGemini(genAI, model, input, logPrefix);
                return { success: true, content };
            } catch (err: any) {
                const msg = err.message || '';
                console.warn(`${logPrefix} ${model} failed: ${msg}`);

                if (msg.includes('429') || msg.includes('rate limit')) {
                    await new Promise(r => setTimeout(r, 15000 * (retry + 1)));
                    break;
                }
            }
        }
    }
    return { success: false, error: 'All retries exhausted' };
}

async function findOrCreateMaterialLesson(
    supabase: any, materialsId: string, lessonPlan: any, idx: number, logPrefix: string
): Promise<any> {
    const lessonId = `${lessonPlan.lesson_id || `L${idx}`}-G${idx}`;

    const { data: existing } = await supabase
        .from('material_lessons')
        .select('*')
        .eq('materials_id', materialsId)
        .eq('lesson_id', lessonId)
        .maybeSingle();

    if (existing) return existing;

    const { data: created, error } = await supabase
        .from('material_lessons')
        .insert({
            materials_id: materialsId,
            lesson_id: lessonId,
            lesson_title: lessonPlan.lesson_title,
            module_id: lessonPlan.module_id || `mod-${idx}`,
            module_title: lessonPlan.module_title,
            oa_text: lessonPlan.oa_text,
            expected_components: (lessonPlan.components || []).map((c: any) => c.type),
            quiz_spec: { min_questions: 3, max_questions: 5, types: ['MULTIPLE_CHOICE', 'TRUE_FALSE'] },
            requires_demo_guide: lessonPlan.components?.some((c: any) => c.type === 'DEMO_GUIDE') || false,
            state: 'PENDING',
            dod: { control3_consistency: 'PENDING', control4_sources: 'PENDING', control5_quiz: 'PENDING', errors: [] },
        })
        .select()
        .single();

    if (error) throw error;
    console.log(`${logPrefix} Created: ${lessonId}`);
    return created;
}

async function generateMaterialsWithGemini(
    genAI: GoogleGenAI, model: string, input: MaterialsGenerationInput, logPrefix: string
): Promise<any> {
    const prompt = materialsGenerationPrompt + `\n\n## DATOS DE ENTRADA\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`\n\nResponde SOLO con JSON válido.`;

    console.log(`${logPrefix} Calling ${model}`);

    const response = await genAI.models.generateContent({
        model,
        contents: prompt,
        config: { temperature: 0.7, maxOutputTokens: 16000 },
    });

    const text = response.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    return JSON.parse(match[0]);
}

async function saveGeneratedComponents(
    supabase: any, lessonId: string, content: any, iteration: number, logPrefix: string
): Promise<void> {
    const components = content.components || {};
    const refs = content.source_refs_used || [];

    await supabase.from('material_components').delete().eq('material_lesson_id', lessonId).eq('iteration_number', iteration);

    for (const [type, data] of Object.entries(components)) {
        if (!data) continue;
        await supabase.from('material_components').insert({
            material_lesson_id: lessonId,
            type,
            content: data,
            source_refs: refs,
            validation_status: 'PENDING',
            validation_errors: [],
            iteration_number: iteration,
        });
    }
    console.log(`${logPrefix} Saved ${Object.keys(components).length} components`);
}
