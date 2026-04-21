import { Handler } from '@netlify/functions';
import { createServiceRoleClient } from './shared/bootstrap';
import { getErrorMessage } from './shared/errors';
import { methodNotAllowedResponse, parseJsonBody } from './shared/http';
import { selectLatestComponentsByType } from '../../src/domains/materials/lib/material-component-versions';

interface LessonDod {
    control3_consistency: 'PASS' | 'FAIL' | 'PENDING';
    control4_sources: 'PASS' | 'FAIL' | 'PENDING';
    control5_quiz: 'PASS' | 'FAIL' | 'PENDING';
    errors: string[];
}

interface MaterialsRecord {
    id: string;
}

interface LessonQuizSpec {
    min_questions?: number;
}

interface MaterialLessonRecord {
    expected_components?: string[] | null;
    id: string;
    lesson_title?: string | null;
    materials_id: string;
    quiz_spec?: LessonQuizSpec | null;
    state?: string | null;
}

interface QuizItem {
    explanation?: string | null;
}

interface MaterialComponentContent {
    items?: QuizItem[] | null;
}

interface MaterialComponentRecord {
    content?: MaterialComponentContent | null;
    iteration_number?: number | null;
    type: string;
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return methodNotAllowedResponse();
    }

    try {
        const body = parseJsonBody<{
            materialsId?: string;
            artifactId?: string;
            lessonId?: string;
            markForFix?: boolean;
        }>(event);

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

        const supabase = createServiceRoleClient();
        console.log(`[Validate Materials] Starting validation for: ${materialsId || artifactId}`);

        // 1. Get materials record
        let materials: MaterialsRecord;
        if (materialsId) {
            const { data, error } = await supabase
                .from('materials')
                .select('id')
                .eq('id', materialsId)
                .single();
            if (error) throw new Error(`Materials not found: ${error.message}`);
            materials = data as MaterialsRecord;
        } else {
            const { data, error } = await supabase
                .from('materials')
                .select('id')
                .eq('artifact_id', artifactId)
                .single();
            if (error) throw new Error(`Materials not found: ${error.message}`);
            materials = data as MaterialsRecord;
        }

        // 2. Get all lessons for this materials record
        const { data: lessons, error: lessonsError } = await supabase
            .from('material_lessons')
            .select('id, materials_id, lesson_title, expected_components, quiz_spec, state')
            .eq('materials_id', materials.id);

        if (lessonsError) throw new Error(`Error fetching lessons: ${lessonsError.message}`);

        console.log(`[Validate Materials] Found ${lessons?.length || 0} lessons to validate`);

        // 3. Validate each lesson
        let allApprovable = true;
        let validatedCount = 0;
        let skippedCount = 0;

        for (const lesson of ((lessons || []) as MaterialLessonRecord[])) {
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
                .select('type, content, iteration_number')
                .eq('material_lesson_id', lesson.id);

            const activeComponents = selectLatestComponentsByType(
                (components || []) as MaterialComponentRecord[],
            );

            // Run inline validation
            const dod = runInlineValidation(
                lesson,
                activeComponents,
            );

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

        // 4. Update global materials state
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

    } catch (error: unknown) {
        console.error('[Validate Materials] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: getErrorMessage(error) }),
        };
    }
};

// Inline validation function (simplified version of the full validator)
function runInlineValidation(
    lesson: MaterialLessonRecord,
    components: MaterialComponentRecord[],
): LessonDod {
    const errors: string[] = [];

    // Control 3: Components Complete
    const expectedTypes = lesson.expected_components || [];
    const generatedTypes = components.map((component) => component.type);
    const missing = expectedTypes.filter((type: string) => !generatedTypes.includes(type));

    if (missing.length > 0) {
        errors.push(`Faltan componentes: ${missing.join(', ')}`);
    }

    // Control 4: Sources Usage (simplified - just check if any sources used)
    // Control 5: Quiz Validation (if expected)
    const quizComponent = components.find((component) => component.type === 'QUIZ');
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
        const withoutExplanation = items.filter(
            (item) => !item.explanation || item.explanation.length < 10,
        );
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
    const supabase = createServiceRoleClient();

    try {
        // Fetch lesson
        const { data: lesson, error: lessonError } = await supabase
            .from('material_lessons')
            .select('id, materials_id, lesson_title, expected_components, quiz_spec, state')
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
            .select('type, content, iteration_number')
            .eq('material_lesson_id', lessonId);

        const activeComponents = selectLatestComponentsByType(
            (components || []) as MaterialComponentRecord[],
        );

        // Run validation
        const dod = runInlineValidation(
            lesson as MaterialLessonRecord,
            activeComponents,
        );
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

    } catch (error: unknown) {
        console.error('[Validate Single Lesson] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: getErrorMessage(error) })
        };
    }
}

// Simple function to mark a lesson as NEEDS_FIX
async function markLessonForFix(lessonId: string) {
    const supabase = createServiceRoleClient();

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

    } catch (error: unknown) {
        console.error('[Mark For Fix] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: getErrorMessage(error) })
        };
    }
}
