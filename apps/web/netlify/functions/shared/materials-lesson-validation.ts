import { validateSofliaDialogueContent } from '../../../src/domains/materials/validators/materials-control3.validators';
import { hasSubstantiveQuizOptionText, hasValidQuizCorrectAnswer, stripQuizOptionPrefix } from '../../../src/domains/materials/lib/quiz-option-format';
import { collectMaterialVideoValidationErrors } from '../../../src/domains/materials/validators/material-video.validators';
import type { MaterialsGenerationInput, MaterialsGenerationOutput } from '../../../src/domains/materials/types/materials.types';
import { selectLatestComponentsByType } from '../../../src/domains/materials/lib/material-component-versions';

export interface LessonDod {
    control3_consistency: 'PASS' | 'FAIL' | 'PENDING';
    control4_sources: 'PASS' | 'FAIL' | 'PENDING';
    control5_quiz: 'PASS' | 'FAIL' | 'PENDING';
    errors: string[];
}

export interface MaterialsRecord {
    artifact_id: string;
    id: string;
    version: number;
    state: string;
    updated_at: string;
}

export interface LessonQuizSpec {
    min_questions?: number;
}

export interface MaterialLessonRecord {
    updated_at: string;
    iteration_count?: number;
    expected_components?: string[] | null;
    id: string;
    lesson_id: string;
    lesson_title?: string | null;
    materials_id: string;
    quiz_spec?: LessonQuizSpec | null;
    state?: string | null;
}

export interface QuizItem {
    correct_answer?: unknown;
    explanation?: string | null;
    options?: string[];
    type?: string;
}

export interface MaterialComponentRecord {
    assets?: Record<string, unknown> | null;
    content?: Record<string, unknown> | null;
    id: string;
    source_refs?: string[] | null;
    iteration_number?: number | null;
    type: string;
    validation_errors?: string[] | null;
    validation_status?: string | null;
}

export interface MaterialSourceValidationContext {
    requiredSourcesByLesson: Map<string, number>;
    requiresSources: boolean;
    validSourceIdsByLesson: Map<string, Set<string>>;
}

/** Apply the same checks before reporting a full or partial generation as complete. */
export function validateGeneratedMaterialLesson(
    input: MaterialsGenerationInput,
    output: MaterialsGenerationOutput,
    saved: MaterialComponentRecord[] = [],
): LessonDod {
    const generated = Object.entries(output.components).map(([type, content]) => ({
        id: type, type, content: content as unknown as Record<string, unknown>,
        source_refs: output.source_refs_used,
        assets: { video_duration_contract: input.lesson.components.find((component) => component.type === type)?.duration_contract },
    }));
    const replacedTypes = new Set(generated.map((component) => component.type));
    const components = [
        ...selectLatestComponentsByType(saved).filter((component) => !replacedTypes.has(component.type)),
        ...generated,
    ];
    return runInlineValidation({
        id: input.lesson.lesson_id, lesson_id: input.lesson.lesson_id, materials_id: '', updated_at: '',
        expected_components: input.lesson.components.map((component) => component.type), quiz_spec: input.lesson.quiz_spec,
    }, components, {
        requiresSources: Boolean(input.requires_sources),
        requiredSourcesByLesson: new Map([[input.lesson.lesson_id, input.required_source_count || 0]]),
        validSourceIdsByLesson: new Map([[input.lesson.lesson_id, new Set(input.sources.map((source) => source.id))]]),
    });
}


// Inline validation function (simplified version of the full validator)
export function runInlineValidation(
    lesson: MaterialLessonRecord,
    components: MaterialComponentRecord[],
    sourceContext: MaterialSourceValidationContext,
): LessonDod {
    const errors: string[] = [];

    // Control 3: Components Complete
    const expectedTypes = lesson.expected_components || [];
    const generatedTypes = components.filter((component) => component.content && Object.keys(component.content).length > 0).map((component) => component.type);
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

    const quizErrors: string[] = [];
    // Control 5: Quiz Validation (if expected)
    const quizComponent = components.find((component) => component.type === 'QUIZ');
    const expectsQuiz = expectedTypes.includes('QUIZ');

    if (expectsQuiz && !quizComponent) {
        quizErrors.push('Se esperaba QUIZ pero no fue generado');
    } else if (quizComponent) {
        const content = quizComponent.content || {};
        const items = Array.isArray(content.items)
            ? (content.items as QuizItem[])
            : [];

        const minQuestions = lesson.quiz_spec?.min_questions || 3;
        if (items.length < minQuestions) {
            quizErrors.push(`Quiz tiene ${items.length} preguntas, mínimo requerido: ${minQuestions}`);
        }

        // Check explanations
        const withoutExplanation = items.filter(
            (item) => !item.explanation || item.explanation.length < 10,
        );
        if (withoutExplanation.length > 0) {
            quizErrors.push(`${withoutExplanation.length} pregunta(s) sin explicación adecuada`);
        }

        const emptyOptions = items.flatMap((item) => {
            const rawOptions = Array.isArray(item.options) ? item.options : [];
            return rawOptions.filter((option) => !hasSubstantiveQuizOptionText(option));
        });
        if (emptyOptions.length > 0) {
            quizErrors.push(
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
            quizErrors.push(`${withoutCorrectAnswer.length} pregunta(s) sin correct_answer valido`);
        }
    }

    errors.push(...quizErrors);

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
    const hasCtrl5Error = quizErrors.length > 0;

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
