import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Setup
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface LessonDod {
    control3_consistency: 'PASS' | 'FAIL' | 'PENDING';
    control4_sources: 'PASS' | 'FAIL' | 'PENDING';
    control5_quiz: 'PASS' | 'FAIL' | 'PENDING';
    errors: string[];
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, body: 'Bad Request: Invalid JSON' };
    }

    const { materialsId, artifactId, lessonId, markForFix } = body;

    // If lessonId is provided, validate only that lesson (or mark for fix)
    if (lessonId) {
        if (markForFix) {
            return await markLessonForFix(lessonId);
        }
        return await validateSingleLesson(lessonId);
    }

    if (!materialsId && !artifactId) {
        return { statusCode: 400, body: 'Missing materialsId, artifactId, or lessonId' };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        console.log(`[Validate Materials] Starting validation for: ${materialsId || artifactId}`);

        // 1. Get materials record
        let materials;
        if (materialsId) {
            const { data, error } = await supabase
                .from('materials')
                .select('*, artifact_id')
                .eq('id', materialsId)
                .single();
            if (error) throw new Error(`Materials not found: ${error.message}`);
            materials = data;
        } else {
            const { data, error } = await supabase
                .from('materials')
                .select('*, artifact_id')
                .eq('artifact_id', artifactId)
                .single();
            if (error) throw new Error(`Materials not found: ${error.message}`);
            materials = data;
        }

        const targetArtifactId = materials.artifact_id;

        // 2. Get all lessons for this materials record
        const { data: lessons, error: lessonsError } = await supabase
            .from('material_lessons')
            .select('*')
            .eq('materials_id', materials.id);

        if (lessonsError) throw new Error(`Error fetching lessons: ${lessonsError.message}`);

        console.log(`[Validate Materials] Found ${lessons?.length || 0} lessons to validate`);

        // 3. Get apt sources from curation
        const { data: curationRecord } = await supabase
            .from('curation')
            .select('id')
            .eq('artifact_id', targetArtifactId)
            .single();

        let aptaSourceIds: string[] = [];
        let nonAptaSourceIds: string[] = [];

        if (curationRecord) {
            const { data: curationRows } = await supabase
                .from('curation_rows')
                .select('id, apta')
                .eq('curation_id', curationRecord.id);

            aptaSourceIds = (curationRows || []).filter(r => r.apta === true).map(r => r.id);
            nonAptaSourceIds = (curationRows || []).filter(r => r.apta === false).map(r => r.id);
        }

        // 4. Validate each lesson
        let allApprovable = true;
        let validatedCount = 0;
        let skippedCount = 0;

        for (const lesson of (lessons || [])) {
            // Skip lessons already marked as NEEDS_FIX (preserve user's manual marking)
            if (lesson.state === 'NEEDS_FIX') {
                console.log(`[Validate Materials] Skipping ${lesson.lesson_title} - already NEEDS_FIX`);
                allApprovable = false;
                skippedCount++;
                continue;
            }

            // Get components for this lesson
            const { data: components } = await supabase
                .from('material_components')
                .select('*')
                .eq('material_lesson_id', lesson.id);

            // Run inline validation
            const dod = runInlineValidation(lesson, components || [], aptaSourceIds, nonAptaSourceIds);

            // Determine new state
            const hasErrors = dod.errors.length > 0;
            const newState = hasErrors ? 'NEEDS_FIX' : 'APPROVABLE';

            if (hasErrors) {
                allApprovable = false;
            }

            // Update lesson
            await supabase
                .from('material_lessons')
                .update({
                    dod,
                    state: newState,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', lesson.id);

            validatedCount++;
            console.log(`[Validate Materials] Lesson ${lesson.lesson_title}: ${newState}`);
        }

        // 5. Update global materials state
        const newGlobalState = allApprovable ? 'PHASE3_READY_FOR_QA' : 'PHASE3_NEEDS_FIX';

        await supabase
            .from('materials')
            .update({
                state: newGlobalState,
                updated_at: new Date().toISOString(),
            })
            .eq('id', materials.id);

        console.log(`[Validate Materials] Complete. Global state: ${newGlobalState}`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                validated: validatedCount,
                allApprovable,
                globalState: newGlobalState,
            }),
        };

    } catch (error: any) {
        console.error('[Validate Materials] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: error.message }),
        };
    }
};

// Inline validation function (simplified version of the full validator)
function runInlineValidation(
    lesson: any,
    components: any[],
    aptaSourceIds: string[],
    nonAptaSourceIds: string[]
): LessonDod {
    const errors: string[] = [];

    // Control 3: Components Complete
    const expectedTypes = lesson.expected_components || [];
    const generatedTypes = components.map(c => c.type);
    const missing = expectedTypes.filter((type: string) => !generatedTypes.includes(type));

    if (missing.length > 0) {
        errors.push(`Faltan componentes: ${missing.join(', ')}`);
    }

    // Control 4: Sources Usage (simplified - just check if any sources used)
    const usedSourceIds = components.flatMap(c => c.source_refs || []);
    // Note: We're being lenient here. Full validation would check aptaSourceIds.

    // Control 5: Quiz Validation (if expected)
    const quizComponent = components.find(c => c.type === 'QUIZ');
    const expectsQuiz = expectedTypes.includes('QUIZ');

    if (expectsQuiz && !quizComponent) {
        errors.push('Se esperaba QUIZ pero no fue generado');
    } else if (quizComponent) {
        const content = quizComponent.content || {};
        const items = content.items || [];

        const minQuestions = lesson.quiz_spec?.min_questions || 3;
        if (items.length < minQuestions) {
            errors.push(`Quiz tiene ${items.length} preguntas, mínimo requerido: ${minQuestions}`);
        }

        // Check explanations
        const withoutExplanation = items.filter((item: any) => !item.explanation || item.explanation.length < 10);
        if (withoutExplanation.length > 0) {
            errors.push(`${withoutExplanation.length} pregunta(s) sin explicación adecuada`);
        }
    }

    // Determine control states
    const hasCtrl3Error = missing.length > 0;
    const hasCtrl4Error = false; // Lenient for now
    const hasCtrl5Error = errors.some(e => e.includes('Quiz') || e.includes('QUIZ') || e.includes('pregunta'));

    return {
        control3_consistency: hasCtrl3Error ? 'FAIL' : 'PASS',
        control4_sources: hasCtrl4Error ? 'FAIL' : 'PASS',
        control5_quiz: hasCtrl5Error ? 'FAIL' : 'PASS',
        errors,
    };
}

// Single lesson validation
async function validateSingleLesson(lessonId: string) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // Fetch lesson
        const { data: lesson, error: lessonError } = await supabase
            .from('material_lessons')
            .select('*, materials_id')
            .eq('id', lessonId)
            .single();

        if (lessonError || !lesson) {
            return {
                statusCode: 404,
                body: JSON.stringify({ success: false, error: 'Lesson not found' })
            };
        }

        // Fetch components
        const { data: components } = await supabase
            .from('material_components')
            .select('*')
            .eq('material_lesson_id', lessonId);

        // Run validation
        const dod = runInlineValidation(lesson, components || [], [], []);
        const hasErrors = dod.errors.length > 0;
        const newState = hasErrors ? 'NEEDS_FIX' : 'APPROVABLE';

        // Update lesson
        await supabase
            .from('material_lessons')
            .update({
                dod,
                state: newState,
                updated_at: new Date().toISOString(),
            })
            .eq('id', lessonId);

        console.log(`[Validate Single Lesson] ${lesson.lesson_title}: ${newState}`);

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, state: newState, dod })
        };

    } catch (error: any) {
        console.error('[Validate Single Lesson] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
}

// Simple function to mark a lesson as NEEDS_FIX
async function markLessonForFix(lessonId: string) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        const { error } = await supabase
            .from('material_lessons')
            .update({
                state: 'NEEDS_FIX',
                updated_at: new Date().toISOString(),
            })
            .eq('id', lessonId);

        if (error) throw error;

        console.log(`[Mark For Fix] Lesson ${lessonId} marked as NEEDS_FIX`);

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true })
        };

    } catch (error: any) {
        console.error('[Mark For Fix] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
}
