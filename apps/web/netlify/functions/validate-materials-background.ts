import { validateSofliaDialogueContent } from "../../src/domains/materials/validators/materials-control3.validators";
import { Handler } from '@netlify/functions';
import { createServiceRoleClient } from './shared/bootstrap';
import { getErrorMessage } from './shared/errors';
import { backgroundGuardFailureResponse, methodNotAllowedResponse, parseVerifiedBackgroundBody } from './shared/http';
import { selectLatestComponentsByType } from '../../src/domains/materials/lib/material-component-versions';
import {
    hasSubstantiveQuizOptionText,
    hasValidQuizCorrectAnswer,
    stripQuizOptionPrefix,
} from '../../src/domains/materials/lib/quiz-option-format';
import { collectMaterialVideoValidationErrors } from '../../src/domains/materials/validators/material-video.validators';
import { buildLessonsToProcess } from './shared/unified-curation-helpers';

interface LessonDod {
    control3_consistency: 'PASS' | 'FAIL' | 'PENDING';
    control4_sources: 'PASS' | 'FAIL' | 'PENDING';
    control5_quiz: 'PASS' | 'FAIL' | 'PENDING';
    errors: string[];
}

interface MaterialsRecord {
    artifact_id: string;
    id: string;
    version: number;
}

interface LessonQuizSpec {
    min_questions?: number;
}

interface MaterialLessonRecord {
    iteration_count?: number;
    expected_components?: string[] | null;
    id: string;
    lesson_id: string;
    lesson_title?: string | null;
    materials_id: string;
    quiz_spec?: LessonQuizSpec | null;
    state?: string | null;
}

interface QuizItem {
    correct_answer?: unknown;
    explanation?: string | null;
    options?: string[];
    type?: string;
}

interface MaterialComponentRecord {
    assets?: Record<string, unknown> | null;
    content?: Record<string, unknown> | null;
    id: string;
    source_refs?: string[] | null;
    iteration_number?: number | null;
    type: string;
    validation_errors?: string[] | null;
    validation_status?: string | null;
}

interface MaterialSourceValidationContext {
    requiredSourcesByLesson: Map<string, number>;
    requiresSources: boolean;
    validSourceIdsByLesson: Map<string, Set<string>>;
}


function normalizeLessonKey(value: string | null | undefined) {
    return (value || '')
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

async function loadMaterialSourceValidationContext(
    supabase: ReturnType<typeof createServiceRoleClient>,
    artifactId: string,
): Promise<MaterialSourceValidationContext> {
    const [syllabusResult, planResult, curationResult] = await Promise.all([
        supabase.from('syllabus').select('route').eq('artifact_id', artifactId).single(),
        supabase.from('instructional_plans').select('lesson_plans').eq('artifact_id', artifactId).single(),
        supabase.from('curation').select('id').eq('artifact_id', artifactId).maybeSingle(),
    ]);
    if (syllabusResult.error) throw syllabusResult.error;
    if (planResult.error) throw planResult.error;
    if (curationResult.error) throw curationResult.error;

    const lessons = buildLessonsToProcess(planResult.data.lesson_plans);
    const requiredSourcesByLesson = new Map(
        lessons.map((lesson) => [lesson.lesson_id, lesson.required_sources]),
    );
    const validSourceIdsByLesson = new Map<string, Set<string>>();
    const requiresSources = syllabusResult.data.route !== 'B_NO_SOURCE';
    if (!requiresSources || !curationResult.data?.id) {
        return { requiredSourcesByLesson, requiresSources, validSourceIdsByLesson };
    }

    const lessonIdByTitle = new Map(
        lessons.map((lesson) => [normalizeLessonKey(lesson.lesson_title), lesson.lesson_id]),
    );
    const knownLessonIds = new Set(lessons.map((lesson) => lesson.lesson_id));
    const { data: rows, error: rowsError } = await supabase
        .from('curation_rows')
        .select('id, lesson_id, lesson_title, apta, validation_report')
        .eq('curation_id', curationResult.data.id)
        .eq('apta', true);
    if (rowsError) throw rowsError;

    for (const row of rows || []) {
        const report = row.validation_report as { status?: string } | null;
        if (report?.status && report.status !== 'valid') continue;
        const lessonId = knownLessonIds.has(row.lesson_id)
            ? row.lesson_id
            : lessonIdByTitle.get(normalizeLessonKey(row.lesson_title));
        if (!lessonId) continue;
        const ids = validSourceIdsByLesson.get(lessonId) || new Set<string>();
        ids.add(row.id);
        validSourceIdsByLesson.set(lessonId, ids);
    }

    return { requiredSourcesByLesson, requiresSources, validSourceIdsByLesson };
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return methodNotAllowedResponse();
    }

    let body: {
        version?: number;
        materialsId?: string;
        artifactId?: string;
        lessonId?: string;
        markForFix?: boolean;
    };
    try {
        body = await parseVerifiedBackgroundBody<{
            version?: number;
            materialsId?: string;
            artifactId?: string;
            lessonId?: string;
            markForFix?: boolean;
        }>(event);
    } catch (error) {
        return backgroundGuardFailureResponse(error);
    }

    try {
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
                .select('id, artifact_id, version')
                .eq('id', materialsId)
                .single();
            if (error) throw new Error(`Materials not found: ${error.message}`);
            materials = data as MaterialsRecord;
        } else {
            const { data, error } = await supabase
                .from('materials')
                .select('id, artifact_id, version')
                .eq('artifact_id', artifactId)
                .single();
            if (error) throw new Error(`Materials not found: ${error.message}`);
            materials = data as MaterialsRecord;
        }

        if (body.version !== undefined && materials.version !== body.version) {
            return { statusCode: 200, body: JSON.stringify({ superseded: true }) };
        }
        const sourceValidationContext = await loadMaterialSourceValidationContext(
            supabase,
            materials.artifact_id,
        );
        // 2. Get all lessons for this materials record
        const { data: lessons, error: lessonsError } = await supabase
            .from('material_lessons')
            .select('id, materials_id, lesson_id, lesson_title, expected_components, quiz_spec, state, iteration_count')
            .eq('materials_id', materials.id);

        if (lessonsError) throw new Error(`Error fetching lessons: ${lessonsError.message}`);

        console.log(`[Validate Materials] Found ${lessons?.length || 0} lessons to validate`);

        // 3. Validate each lesson
        let allApprovable = Boolean(lessons?.length);
        let validatedCount = 0;

        for (const lesson of ((lessons || []) as MaterialLessonRecord[])) {
            // Skip lessons already marked as NEEDS_FIX (preserve user's manual marking)
            if (!["GENERATED", "APPROVABLE"].includes(lesson.state || "")) {
                console.log(`[Validate Materials] Skipping ${lesson.lesson_title} - already NEEDS_FIX`);
                allApprovable = false;
                continue;
            }

            // Get components for this lesson
            const { data: components, error: componentsError } = await supabase
                .from('material_components')
                .select('id, type, content, source_refs, assets, validation_status, validation_errors, iteration_number')
                .eq('material_lesson_id', lesson.id);
            if (componentsError) throw componentsError;

            const activeComponents = selectLatestComponentsByType(
                (components || []) as MaterialComponentRecord[],
            );

            // Run inline validation
            const dod = runInlineValidation(
                lesson,
                activeComponents,
                sourceValidationContext,
            );

            // Determine new state
            const hasErrors = dod.errors.length > 0;
            const newState = hasErrors ? 'NEEDS_FIX' : 'APPROVABLE';

            if (hasErrors) {
                allApprovable = false;
            }

            // Update lesson
            const { error: lessonError } = await supabase
                .from('material_lessons')
                .update({
                    dod,
                    state: newState,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', lesson.id).eq('state', lesson.state)
                .eq('iteration_count', lesson.iteration_count);
            if (lessonError) throw lessonError;

            validatedCount++;
            console.log(`[Validate Materials] Lesson ${lesson.lesson_title}: ${newState}`);
        }

        // 4. Update global materials state
        const newGlobalState = allApprovable ? 'PHASE3_READY_FOR_QA' : 'PHASE3_NEEDS_FIX';

        const { error: completionError } = await supabase
            .from('materials')
            .update({
                state: newGlobalState,
                updated_at: new Date().toISOString(),
            })
            .eq('id', materials.id).eq('version', materials.version).neq('state', 'PHASE3_DRAFT');
        if (completionError) throw completionError;

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
    sourceContext: MaterialSourceValidationContext,
): LessonDod {
    const errors: string[] = [];

    // Control 3: Components Complete
    const expectedTypes = lesson.expected_components || [];
    const generatedTypes = components.map((component) => component.type);
    const missing = expectedTypes.filter((type: string) => !generatedTypes.includes(type));

    if (missing.length > 0) {
        errors.push(`Faltan componentes: ${missing.join(', ')}`);
    }

    // Control 4: every source-required lesson must cite enough currently valid
    // curation rows belonging to that same lesson.
    const sourceErrors: string[] = [];
    if (sourceContext.requiresSources) {
        const requiredSources = Math.max(
            1,
            sourceContext.requiredSourcesByLesson.get(lesson.lesson_id) || 0,
        );
        const validSourceIds =
            sourceContext.validSourceIdsByLesson.get(lesson.lesson_id) ||
            new Set<string>();
        const usedSourceIds = new Set(
            components.flatMap((component) => component.source_refs || []),
        );
        const unknownSourceIds = [...usedSourceIds].filter(
            (sourceId) => !validSourceIds.has(sourceId),
        );
        if (usedSourceIds.size < requiredSources) {
            sourceErrors.push(
                `La lección utiliza ${usedSourceIds.size}/${requiredSources} fuentes validadas requeridas`,
            );
        }
        if (unknownSourceIds.length > 0) {
            sourceErrors.push(
                `${unknownSourceIds.length} referencia(s) no pertenecen a las fuentes válidas de la lección`,
            );
        }
    }
    errors.push(...sourceErrors);

    // Control 5: Quiz Validation (if expected)
    const quizComponent = components.find((component) => component.type === 'QUIZ');
    const expectsQuiz = expectedTypes.includes('QUIZ');

    if (expectsQuiz && !quizComponent) {
        errors.push('Se esperaba QUIZ pero no fue generado');
    } else if (quizComponent) {
        const content = quizComponent.content || {};
        const items = Array.isArray(content.items)
            ? (content.items as QuizItem[])
            : [];

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

        const emptyOptions = items.flatMap((item) => {
            const rawOptions = Array.isArray(item.options) ? item.options : [];
            return rawOptions.filter((option) => !hasSubstantiveQuizOptionText(option));
        });
        if (emptyOptions.length > 0) {
            errors.push(
                `${emptyOptions.length} opcion(es) de quiz sin contenido real; no basta con A, B, C, D`,
            );
        }

        const withoutCorrectAnswer = items.filter((item) => {
            const rawOptions = Array.isArray(item.options) ? item.options : [];
            const cleanOptions = rawOptions.map(stripQuizOptionPrefix);

            return !hasValidQuizCorrectAnswer({
                rawCorrect: item.correct_answer,
                rawOptions,
                cleanOptions,
                questionType: item.type,
            });
        });
        if (withoutCorrectAnswer.length > 0) {
            errors.push(`${withoutCorrectAnswer.length} pregunta(s) sin correct_answer valido`);
        }
    }

    const dialogueErrors = validateSofliaDialogueRuntimeInline(
        expectedTypes,
        components,
    );
    errors.push(...dialogueErrors);

    const videoErrors = collectMaterialVideoValidationErrors(components);
    errors.push(...videoErrors);

    // Determine control states
    const hasCtrl3Error = missing.length > 0 || dialogueErrors.length > 0 || videoErrors.length > 0;
    const hasCtrl4Error = sourceErrors.length > 0;
    const hasCtrl5Error = errors.some(e => e.includes('Quiz') || e.includes('QUIZ') || e.includes('pregunta'));

    return {
        control3_consistency: hasCtrl3Error ? 'FAIL' : 'PASS',
        control4_sources: hasCtrl4Error ? 'FAIL' : 'PASS',
        control5_quiz: hasCtrl5Error ? 'FAIL' : 'PASS',
        errors,
    };
}

function validateSofliaDialogueRuntimeInline(
    expectedTypes: string[],
    components: MaterialComponentRecord[],
) {
    const errors: string[] = [];

    if (!expectedTypes.includes('DIALOGUE')) {
        return errors;
    }

    const dialogueComponent = components.find((component) => component.type === 'DIALOGUE');
    if (!dialogueComponent) {
        errors.push('Se esperaba DIALOGUE pero no fue generado');
        return errors;
    }

    errors.push(...validateSofliaDialogueContent(dialogueComponent.content));

    return errors.length > 0
        ? [`Contrato SOFLIA_DIALOGUE invalido: ${errors.join('; ')}`]
        : [];
}

// Single lesson validation
async function validateSingleLesson(lessonId: string) {
    const supabase = createServiceRoleClient();

    try {
        // Fetch lesson
        const { data: lesson, error: lessonError } = await supabase
            .from('material_lessons')
            .select('id, materials_id, lesson_id, lesson_title, expected_components, quiz_spec, state')
            .eq('id', lessonId)
            .single();

        if (lessonError || !lesson) {
            return {
                statusCode: 404,
                body: JSON.stringify({ success: false, error: 'Lesson not found' })
            };
        }

        const { data: materials, error: materialsError } = await supabase
            .from('materials')
            .select('artifact_id')
            .eq('id', lesson.materials_id)
            .single();
        if (materialsError || !materials?.artifact_id) {
            throw new Error(materialsError?.message || 'Materials not found');
        }
        const sourceValidationContext = await loadMaterialSourceValidationContext(
            supabase,
            materials.artifact_id,
        );

        // Fetch components
        const { data: components } = await supabase
            .from('material_components')
            .select('id, type, content, source_refs, assets, validation_status, validation_errors, iteration_number')
            .eq('material_lesson_id', lessonId);

        const activeComponents = selectLatestComponentsByType(
            (components || []) as MaterialComponentRecord[],
        );

        // Run validation
        const dod = runInlineValidation(
            lesson as MaterialLessonRecord,
            activeComponents,
            sourceValidationContext,
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
