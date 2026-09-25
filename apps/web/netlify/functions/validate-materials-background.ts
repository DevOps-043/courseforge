import { runInlineValidation, type MaterialsRecord, type MaterialLessonRecord, type MaterialComponentRecord, type MaterialSourceValidationContext } from './shared/materials-lesson-validation';
import { Handler } from '@netlify/functions';
import { createServiceRoleClient } from './shared/bootstrap';
import { getErrorMessage } from './shared/errors';
import { backgroundGuardFailureResponse, methodNotAllowedResponse, parseVerifiedBackgroundBody } from './shared/http';
import { selectLatestComponentsByType } from '../../src/domains/materials/lib/material-component-versions';
import { buildLessonsToProcess } from './shared/unified-curation-helpers';
import { generationFailureMessage } from '../../src/lib/pipeline-generation-policy';

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

    let validationExecution: MaterialsRecord | undefined;
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
                .select('id, artifact_id, version, state, updated_at')
                .eq('id', materialsId)
                .single();
            if (error) throw new Error(`Materials not found: ${error.message}`);
            materials = data as MaterialsRecord;
        } else {
            const { data, error } = await supabase
                .from('materials')
                .select('id, artifact_id, version, state, updated_at')
                .eq('artifact_id', artifactId)
                .single();
            if (error) throw new Error(`Materials not found: ${error.message}`);
            materials = data as MaterialsRecord;
        }

        if (body.version !== undefined && materials.version !== body.version) {
            return { statusCode: 200, body: JSON.stringify({ superseded: true }) };
        }
        if (['PHASE3_GENERATING', 'PHASE3_DRAFT', 'PHASE3_APPROVED'].includes(materials.state)) {
            return { statusCode: 409, body: JSON.stringify({ error: 'Los materiales no están disponibles para validar en su estado actual.' }) };
        }
        validationExecution = materials;
        const sourceValidationContext = await loadMaterialSourceValidationContext(
            supabase,
            materials.artifact_id,
        );
        // 2. Get all lessons for this materials record
        const { data: lessons, error: lessonsError } = await supabase
            .from('material_lessons')
            .select('id, materials_id, lesson_id, lesson_title, expected_components, quiz_spec, state, iteration_count, updated_at')
            .eq('materials_id', materials.id);

        if (lessonsError) throw new Error(`Error fetching lessons: ${lessonsError.message}`);
        if (lessons?.some((lesson) => lesson.state === 'GENERATING')) {
            return { statusCode: 409, body: JSON.stringify({ error: 'Espera a que termine la regeneración antes de validar.' }) };
        }

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
            const { data: saved, error: lessonError } = await supabase
                .from('material_lessons')
                .update({
                    dod,
                    state: newState,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', lesson.id).eq('state', lesson.state)
                .eq('iteration_count', lesson.iteration_count).eq('updated_at', lesson.updated_at)
                .select('id').maybeSingle();
            if (lessonError) throw lessonError;
            if (!saved) {
                allApprovable = false;
                continue;
            }

            validatedCount++;
            console.log(`[Validate Materials] Lesson ${lesson.lesson_title}: ${newState}`);
        }

        // 4. Update global materials state
        const { data: currentLessons, error: currentError } = await supabase.from('material_lessons')
            .select('state').eq('materials_id', materials.id);
        if (currentError) throw currentError;
        allApprovable = Boolean(currentLessons?.length) && currentLessons!.every((lesson) => lesson.state === 'APPROVABLE');
        if (currentLessons?.some((lesson) => lesson.state === 'GENERATING')) {
            return { statusCode: 200, body: JSON.stringify({ superseded: true, validated: validatedCount }) };
        }
        const newGlobalState = allApprovable ? 'PHASE3_READY_FOR_QA' : 'PHASE3_NEEDS_FIX';

        const { data: completed, error: completionError } = await supabase
            .from('materials')
            .update({
                state: newGlobalState,
                updated_at: new Date().toISOString(),
            })
            .eq('id', materials.id).eq('version', materials.version)
            .eq('state', materials.state).eq('updated_at', materials.updated_at).select('id').maybeSingle();
        if (completionError) throw completionError;
        if (!completed) return { statusCode: 200, body: JSON.stringify({ superseded: true, validated: validatedCount }) };

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
        if (validationExecution) {
            const now = new Date().toISOString();
            const { error: recoveryError } = await createServiceRoleClient().from('materials').update({
                state: 'PHASE3_NEEDS_FIX', updated_at: now,
                qa_decision: { decision: 'REJECTED', notes: generationFailureMessage(error), reviewed_by: 'system', reviewed_at: now },
            }).eq('id', validationExecution.id).eq('version', validationExecution.version)
                .eq('state', validationExecution.state).eq('updated_at', validationExecution.updated_at);
            if (recoveryError) console.error('[Validate Materials] Error saving validation failure:', recoveryError);
        }
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: getErrorMessage(error) }),
        };
    }
};

// Single lesson validation
async function validateSingleLesson(lessonId: string) {
    const supabase = createServiceRoleClient();

    try {
        // Fetch lesson
        const { data: lesson, error: lessonError } = await supabase
            .from('material_lessons')
            .select('id, materials_id, lesson_id, lesson_title, expected_components, quiz_spec, state, iteration_count, updated_at')
            .eq('id', lessonId)
            .single();

        if (lessonError || !lesson) {
            return {
                statusCode: 404,
                body: JSON.stringify({ success: false, error: 'Lesson not found' })
            };
        }
        if (!['GENERATED', 'APPROVABLE'].includes(lesson.state)) {
            return { statusCode: 409, body: JSON.stringify({ error: 'La lección debe terminar su generación antes de validar.' }) };
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
        const { data: components, error: componentsError } = await supabase
            .from('material_components')
            .select('id, type, content, source_refs, assets, validation_status, validation_errors, iteration_number')
            .eq('material_lesson_id', lessonId);
        if (componentsError) throw componentsError;

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
        const { data: saved, error: saveError } = await supabase
            .from('material_lessons')
            .update({
                dod,
                state: newState,
                updated_at: new Date().toISOString(),
            })
            .eq('id', lessonId).eq('state', lesson.state)
            .eq('iteration_count', lesson.iteration_count).eq('updated_at', lesson.updated_at)
            .select('id').maybeSingle();
        if (saveError) throw saveError;
        if (!saved) return { statusCode: 409, body: JSON.stringify({ error: 'La lección cambió durante la validación. Actualiza e inténtalo de nuevo.' }) };

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
