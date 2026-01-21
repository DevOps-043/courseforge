import {
    ComponentType,
    MaterialComponent,
    MaterialLesson,
    QuizSpec,
    QuizContent,
    ValidationCheck,
    LessonDod,
} from '../types/materials.types';

// ============================================
// CONTROL 3: Consistencia con el Plan
// ============================================

/**
 * Valida que todos los componentes esperados fueron generados
 */
export function validateComponentsComplete(
    lesson: MaterialLesson,
    components: MaterialComponent[]
): ValidationCheck {
    const expectedTypes = lesson.expected_components;
    const generatedTypes = components.map((c) => c.type);

    const missing = expectedTypes.filter((type) => !generatedTypes.includes(type));

    if (missing.length > 0) {
        return {
            code: 'CTRL3_COMPONENTS_INCOMPLETE',
            pass: false,
            message: `Faltan componentes: ${missing.join(', ')}`,
            severity: 'error',
            lesson_id: lesson.lesson_id,
        };
    }

    return {
        code: 'CTRL3_COMPONENTS_COMPLETE',
        pass: true,
        message: 'Todos los componentes esperados fueron generados',
        severity: 'error',
        lesson_id: lesson.lesson_id,
    };
}

/**
 * Valida que el OA está reflejado en los componentes (heurística: keywords)
 */
export function validateOAReflected(
    lesson: MaterialLesson,
    components: MaterialComponent[]
): ValidationCheck {
    const oaKeywords = extractKeywords(lesson.oa_text);

    // Buscar keywords del OA en el contenido de los componentes
    const allContent = components.map((c) => JSON.stringify(c.content)).join(' ').toLowerCase();

    const foundKeywords = oaKeywords.filter((kw) => allContent.includes(kw.toLowerCase()));
    const coverage = foundKeywords.length / Math.max(oaKeywords.length, 1);

    if (coverage < 0.5) {
        return {
            code: 'CTRL3_OA_NOT_REFLECTED',
            pass: false,
            message: `El OA no está suficientemente reflejado en los materiales (cobertura: ${Math.round(coverage * 100)}%)`,
            severity: 'warning',
            lesson_id: lesson.lesson_id,
        };
    }

    return {
        code: 'CTRL3_OA_REFLECTED',
        pass: true,
        message: `OA reflejado correctamente (cobertura: ${Math.round(coverage * 100)}%)`,
        severity: 'error',
        lesson_id: lesson.lesson_id,
    };
}

/**
 * Valida que si requires_demo_guide=true, existe DEMO_GUIDE
 */
export function validateRequiredDemoGuide(
    lesson: MaterialLesson,
    components: MaterialComponent[]
): ValidationCheck {
    if (!lesson.requires_demo_guide) {
        return {
            code: 'CTRL3_DEMO_GUIDE_NOT_REQUIRED',
            pass: true,
            message: 'Demo guide no requerido',
            severity: 'error',
            lesson_id: lesson.lesson_id,
        };
    }

    const hasDemoGuide = components.some((c) => c.type === 'DEMO_GUIDE');

    if (!hasDemoGuide) {
        return {
            code: 'CTRL3_DEMO_GUIDE_MISSING',
            pass: false,
            message: 'La lección requiere DEMO_GUIDE pero no fue generado',
            severity: 'error',
            lesson_id: lesson.lesson_id,
        };
    }

    return {
        code: 'CTRL3_DEMO_GUIDE_PRESENT',
        pass: true,
        message: 'Demo guide presente como requerido',
        severity: 'error',
        lesson_id: lesson.lesson_id,
    };
}

/**
 * Valida que no hay componentes inventados (no en el plan)
 */
export function validateNoExtraComponents(
    lesson: MaterialLesson,
    components: MaterialComponent[]
): ValidationCheck {
    const expectedTypes = lesson.expected_components;
    const extraComponents = components.filter((c) => !expectedTypes.includes(c.type));

    if (extraComponents.length > 0) {
        return {
            code: 'CTRL3_EXTRA_COMPONENTS',
            pass: false,
            message: `Componentes no solicitados: ${extraComponents.map((c) => c.type).join(', ')}`,
            severity: 'warning',
            lesson_id: lesson.lesson_id,
        };
    }

    return {
        code: 'CTRL3_NO_EXTRA_COMPONENTS',
        pass: true,
        message: 'No hay componentes extra',
        severity: 'error',
        lesson_id: lesson.lesson_id,
    };
}

// ============================================
// CONTROL 4: Uso Correcto de Fuentes
// ============================================

/**
 * Valida que los componentes referencian fuentes aptas
 */
export function validateSourcesUsage(
    components: MaterialComponent[],
    aptaSourceIds: string[]
): ValidationCheck {
    const usedSourceIds = components.flatMap((c) => c.source_refs);
    const uniqueUsed = [...new Set(usedSourceIds)];

    if (uniqueUsed.length === 0) {
        return {
            code: 'CTRL4_NO_SOURCES_USED',
            pass: false,
            message: 'Los materiales no referencian ninguna fuente',
            severity: 'warning',
        };
    }

    // Verificar que todas las fuentes usadas son aptas
    const invalidSources = uniqueUsed.filter((id) => !aptaSourceIds.includes(id));

    if (invalidSources.length > 0) {
        return {
            code: 'CTRL4_INVALID_SOURCES',
            pass: false,
            message: `Fuentes no aptas utilizadas: ${invalidSources.join(', ')}`,
            severity: 'error',
        };
    }

    return {
        code: 'CTRL4_SOURCES_VALID',
        pass: true,
        message: `${uniqueUsed.length} fuentes aptas utilizadas correctamente`,
        severity: 'error',
    };
}

/**
 * Valida que no se usan fuentes marcadas como NO APTA
 */
export function validateNoNonAptaSources(
    components: MaterialComponent[],
    nonAptaSourceIds: string[]
): ValidationCheck {
    const usedSourceIds = components.flatMap((c) => c.source_refs);
    const usedNonApta = usedSourceIds.filter((id) => nonAptaSourceIds.includes(id));

    if (usedNonApta.length > 0) {
        return {
            code: 'CTRL4_NON_APTA_USED',
            pass: false,
            message: `Se utilizaron fuentes NO APTA: ${usedNonApta.join(', ')}`,
            severity: 'error',
        };
    }

    return {
        code: 'CTRL4_NO_NON_APTA',
        pass: true,
        message: 'No se utilizaron fuentes NO APTA',
        severity: 'error',
    };
}

// ============================================
// CONTROL 5: Evaluación (Quiz)
// ============================================

/**
 * Valida que el Quiz tiene la cantidad correcta de preguntas
 */
export function validateQuizQuantity(
    quizComponent: MaterialComponent | undefined,
    spec: QuizSpec | null
): ValidationCheck {
    if (!quizComponent) {
        return {
            code: 'CTRL5_QUIZ_MISSING',
            pass: false,
            message: 'No se encontró componente QUIZ',
            severity: 'error',
        };
    }

    const content = quizComponent.content as QuizContent;
    const itemCount = content.items?.length || 0;

    const minQuestions = spec?.min_questions || 3;
    const maxQuestions = spec?.max_questions || 5;

    if (itemCount < minQuestions) {
        return {
            code: 'CTRL5_QUIZ_TOO_FEW',
            pass: false,
            message: `Quiz tiene ${itemCount} preguntas, mínimo requerido: ${minQuestions}`,
            severity: 'error',
            component: 'QUIZ',
        };
    }

    if (itemCount > maxQuestions) {
        return {
            code: 'CTRL5_QUIZ_TOO_MANY',
            pass: false,
            message: `Quiz tiene ${itemCount} preguntas, máximo permitido: ${maxQuestions}`,
            severity: 'warning',
            component: 'QUIZ',
        };
    }

    return {
        code: 'CTRL5_QUIZ_QUANTITY_OK',
        pass: true,
        message: `Quiz tiene ${itemCount} preguntas (rango: ${minQuestions}-${maxQuestions})`,
        severity: 'error',
        component: 'QUIZ',
    };
}

/**
 * Valida que los tipos de pregunta son los permitidos
 */
export function validateQuizTypes(
    quizComponent: MaterialComponent | undefined,
    spec: QuizSpec | null
): ValidationCheck {
    if (!quizComponent) {
        return {
            code: 'CTRL5_QUIZ_MISSING',
            pass: false,
            message: 'No se encontró componente QUIZ',
            severity: 'error',
        };
    }

    const content = quizComponent.content as QuizContent;
    const allowedTypes = spec?.types || ['MULTIPLE_CHOICE', 'TRUE_FALSE'];
    const usedTypes = content.items?.map((item) => item.type) || [];

    const invalidTypes = usedTypes.filter((type) => !allowedTypes.includes(type));

    if (invalidTypes.length > 0) {
        return {
            code: 'CTRL5_QUIZ_INVALID_TYPES',
            pass: false,
            message: `Tipos de pregunta no permitidos: ${[...new Set(invalidTypes)].join(', ')}`,
            severity: 'error',
            component: 'QUIZ',
        };
    }

    return {
        code: 'CTRL5_QUIZ_TYPES_OK',
        pass: true,
        message: 'Todos los tipos de pregunta son válidos',
        severity: 'error',
        component: 'QUIZ',
    };
}

/**
 * Valida que hay variedad en la dificultad (EASY, MEDIUM, HARD)
 */
export function validateQuizDifficulty(
    quizComponent: MaterialComponent | undefined
): ValidationCheck {
    if (!quizComponent) {
        return {
            code: 'CTRL5_QUIZ_MISSING',
            pass: false,
            message: 'No se encontró componente QUIZ',
            severity: 'error',
        };
    }

    const content = quizComponent.content as QuizContent;
    const difficulties = content.items?.map((item) => item.difficulty) || [];
    const uniqueDifficulties = [...new Set(difficulties)];

    // Requiere al menos 2 niveles diferentes si hay 3+ preguntas
    if (content.items?.length >= 3 && uniqueDifficulties.length < 2) {
        return {
            code: 'CTRL5_QUIZ_NO_VARIETY',
            pass: false,
            message: `El Quiz solo tiene dificultad: ${uniqueDifficulties.join(', ')}. Se requiere variedad.`,
            severity: 'warning',
            component: 'QUIZ',
        };
    }

    return {
        code: 'CTRL5_QUIZ_DIFFICULTY_OK',
        pass: true,
        message: `Dificultades variadas: ${uniqueDifficulties.join(', ')}`,
        severity: 'error',
        component: 'QUIZ',
    };
}

/**
 * Valida que cada pregunta tiene explicación (feedback)
 */
export function validateQuizExplanations(
    quizComponent: MaterialComponent | undefined
): ValidationCheck {
    if (!quizComponent) {
        return {
            code: 'CTRL5_QUIZ_MISSING',
            pass: false,
            message: 'No se encontró componente QUIZ',
            severity: 'error',
        };
    }

    const content = quizComponent.content as QuizContent;
    const withoutExplanation = content.items?.filter(
        (item) => !item.explanation || item.explanation.trim().length < 10
    ) || [];

    if (withoutExplanation.length > 0) {
        return {
            code: 'CTRL5_QUIZ_MISSING_EXPLANATIONS',
            pass: false,
            message: `${withoutExplanation.length} pregunta(s) sin explicación adecuada`,
            severity: 'error',
            component: 'QUIZ',
        };
    }

    return {
        code: 'CTRL5_QUIZ_EXPLANATIONS_OK',
        pass: true,
        message: 'Todas las preguntas tienen explicación',
        severity: 'error',
        component: 'QUIZ',
    };
}

/**
 * Valida que passing_score = 80
 */
export function validateQuizPassingScore(
    quizComponent: MaterialComponent | undefined
): ValidationCheck {
    if (!quizComponent) {
        return {
            code: 'CTRL5_QUIZ_MISSING',
            pass: false,
            message: 'No se encontró componente QUIZ',
            severity: 'error',
        };
    }

    const content = quizComponent.content as QuizContent;

    if (content.passing_score !== 80) {
        return {
            code: 'CTRL5_QUIZ_WRONG_PASSING_SCORE',
            pass: false,
            message: `passing_score es ${content.passing_score}, debe ser 80`,
            severity: 'error',
            component: 'QUIZ',
        };
    }

    return {
        code: 'CTRL5_QUIZ_PASSING_SCORE_OK',
        pass: true,
        message: 'passing_score = 80 correcto',
        severity: 'error',
        component: 'QUIZ',
    };
}

// ============================================
// VALIDACIÓN COMPLETA POR LECCIÓN
// ============================================

/**
 * Ejecuta todas las validaciones para una lección y retorna el DoD
 */
export function runAllValidations(
    lesson: MaterialLesson,
    components: MaterialComponent[],
    aptaSourceIds: string[],
    nonAptaSourceIds: string[]
): { dod: LessonDod; checks: ValidationCheck[] } {
    const checks: ValidationCheck[] = [];

    // Control 3: Consistencia
    checks.push(validateComponentsComplete(lesson, components));
    checks.push(validateOAReflected(lesson, components));
    checks.push(validateRequiredDemoGuide(lesson, components));
    checks.push(validateNoExtraComponents(lesson, components));

    // Control 4: Fuentes
    checks.push(validateSourcesUsage(components, aptaSourceIds));
    checks.push(validateNoNonAptaSources(components, nonAptaSourceIds));

    // Control 5: Quiz
    const quizComponent = components.find((c) => c.type === 'QUIZ');
    checks.push(validateQuizQuantity(quizComponent, lesson.quiz_spec));
    checks.push(validateQuizTypes(quizComponent, lesson.quiz_spec));
    checks.push(validateQuizDifficulty(quizComponent));
    checks.push(validateQuizExplanations(quizComponent));
    checks.push(validateQuizPassingScore(quizComponent));

    // Calcular estado DoD
    const control3Checks = checks.filter((c) => c.code.startsWith('CTRL3'));
    const control4Checks = checks.filter((c) => c.code.startsWith('CTRL4'));
    const control5Checks = checks.filter((c) => c.code.startsWith('CTRL5'));

    const control3Pass = control3Checks.every((c) => c.pass);
    const control4Pass = control4Checks.every((c) => c.pass);
    const control5Pass = control5Checks.every((c) => c.pass);

    const errors = checks
        .filter((c) => !c.pass && c.severity === 'error')
        .map((c) => c.message);

    const dod: LessonDod = {
        control3_consistency: control3Pass ? 'PASS' : 'FAIL',
        control4_sources: control4Pass ? 'PASS' : 'FAIL',
        control5_quiz: control5Pass ? 'PASS' : 'FAIL',
        errors,
    };

    return { dod, checks };
}

// ============================================
// HELPERS
// ============================================

/**
 * Extrae keywords de un texto (OA)
 * Elimina stopwords y retorna palabras significativas
 */
function extractKeywords(text: string): string[] {
    const stopwords = [
        'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
        'de', 'del', 'al', 'a', 'en', 'con', 'para', 'por',
        'y', 'o', 'que', 'como', 'su', 'sus', 'se', 'es',
        'son', 'ser', 'estar', 'ha', 'han', 'hay', 'puede',
        'pueden', 'cuando', 'donde', 'qué', 'cómo', 'cuál',
        'the', 'a', 'an', 'of', 'to', 'in', 'for', 'on', 'with',
        'and', 'or', 'is', 'are', 'be', 'been', 'being',
    ];

    return text
        .toLowerCase()
        .replace(/[^\w\sáéíóúñü]/g, '')
        .split(/\s+/)
        .filter((word) => word.length > 3 && !stopwords.includes(word))
        .slice(0, 10); // Máximo 10 keywords
}
