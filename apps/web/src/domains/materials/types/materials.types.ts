// Estados del Paso 5 (ya definidos en SQL)
export type Esp05StepState =
    | 'PHASE3_DRAFT'
    | 'PHASE3_GENERATING'
    | 'PHASE3_VALIDATING'
    | 'PHASE3_NEEDS_FIX'
    | 'PHASE3_READY_FOR_QA'
    | 'PHASE3_APPROVED'
    | 'PHASE3_REJECTED'
    | 'PHASE3_ESCALATED';

// Estado por lección
export type LessonMaterialState =
    | 'PENDING'
    | 'GENERATING'
    | 'GENERATED'
    | 'VALIDATING'
    | 'APPROVABLE'
    | 'NEEDS_FIX'
    | 'BLOCKED';

// Tipos de componente
export type ComponentType =
    | 'DIALOGUE'
    | 'READING'
    | 'QUIZ'
    | 'DEMO_GUIDE'
    | 'EXERCISE'
    | 'VIDEO_THEORETICAL'
    | 'VIDEO_DEMO'
    | 'VIDEO_GUIDE';

// Especificación de Quiz
export interface QuizSpec {
    min_questions: number;
    max_questions: number;
    types: ('MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'FILL_BLANK')[];
}

// DoD por lección
export interface LessonDod {
    control3_consistency: 'PASS' | 'FAIL' | 'PENDING';
    control4_sources: 'PASS' | 'FAIL' | 'PENDING';
    control5_quiz: 'PASS' | 'FAIL' | 'PENDING';
    errors: string[];
}

// Bloqueador
export interface MaterialBlocker {
    id: string;
    lesson_id: string;
    lesson_title: string;
    component: ComponentType;
    impact: string;
    owner: string;
    status: 'OPEN' | 'MITIGATING' | 'ACCEPTED';
    created_at: string;
}

// DoD global
export interface GlobalDod {
    checklist: DodCheck[];
    automatic_checks: ValidationCheck[];
}

// Check DoD individual
export interface DodCheck {
    code: string;
    label: string;
    pass: boolean;
    evidence?: string;
    notes?: string;
}

// Resultado de validación
export interface ValidationCheck {
    code: string;
    pass: boolean;
    message: string;
    severity: 'error' | 'warning';
    lesson_id?: string;
    component?: string;
}

// QA Decision
export interface QADecision {
    decision: 'APPROVED' | 'REJECTED';
    reviewed_by?: string;
    reviewed_at?: string;
    notes?: string;
}

// Componente generado
export interface MaterialComponent {
    id: string;
    material_lesson_id: string;
    type: ComponentType;
    content: Record<string, unknown>; // JSON dinámico según tipo
    source_refs: string[];
    validation_status: 'PENDING' | 'PASS' | 'FAIL';
    validation_errors: string[];
    generated_at: string;
    iteration_number: number;
}

// Lección con materiales
export interface MaterialLesson {
    id: string;
    materials_id: string;
    lesson_id: string;
    lesson_title: string;
    module_id: string;
    module_title: string;
    oa_text: string;
    expected_components: ComponentType[];
    quiz_spec: QuizSpec | null;
    requires_demo_guide: boolean;
    dod: LessonDod;
    state: LessonMaterialState;
    iteration_count: number;
    max_iterations: number;
    created_at: string;
    updated_at: string;
}

// Payload completo de materiales (tabla materials)
export interface MaterialsPayload {
    id: string;
    artifact_id: string;
    version: number;
    prompt_version: string;
    state: Esp05StepState;
    lessons: MaterialLesson[];
    global_blockers: MaterialBlocker[];
    dod: GlobalDod;
    qa_decision: QADecision | null;
    package: MaterialsPackage | null;
    created_at: string;
    updated_at: string;
}

// Paquete de materiales (naming/versionado)
export interface MaterialsPackage {
    naming_convention_version: string;
    files: PackageFile[];
}

export interface PackageFile {
    path: string;
    hash: string;
    component: ComponentType;
    lesson_id: string;
}

// Input para generación de materiales
export interface MaterialsGenerationInput {
    lesson: {
        lesson_id: string;
        lesson_title: string;
        module_id: string;
        module_title: string;
        oa_text: string;
        components: { type: ComponentType; summary: string }[];
        quiz_spec: QuizSpec | null;
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

// Output de generación de materiales (respuesta de Gemini)
export interface MaterialsGenerationOutput {
    components: {
        DIALOGUE?: DialogueContent;
        READING?: ReadingContent;
        QUIZ?: QuizContent;
        DEMO_GUIDE?: DemoGuideContent;
        EXERCISE?: ExerciseContent;
        VIDEO_THEORETICAL?: VideoContent;
        VIDEO_DEMO?: VideoContent;
        VIDEO_GUIDE?: VideoGuideContent;
    };
    source_refs_used: string[];
}

// Contenido de Diálogo
export interface DialogueContent {
    title: string;
    introduction?: string;
    scenes: {
        character: 'Lia' | 'Usuario' | 'Narrador';
        message: string;
        emotion?: 'neutral' | 'happy' | 'thinking' | 'surprised';
    }[];
    conclusion?: string;
    reflection_prompt: string;
    improvement_log?: {
        description: string;
        fields: string[];
    };
}

// Contenido de Lectura
export interface ReadingContent {
    title: string;
    body_html: string;
    sections: {
        heading: string;
        content: string;
    }[];
    estimated_reading_time_min: number;
    key_points: string[];
    reflection_question: string;
}

// Contenido de Quiz
export interface QuizContent {
    title: string;
    instructions: string;
    items: QuizItem[];
    passing_score: number;
}

export interface QuizItem {
    id: string;
    question: string;
    type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'FILL_BLANK';
    options?: string[];
    correct_answer: number | string | boolean;
    explanation: string;
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    bloom_level?: 'REMEMBER' | 'UNDERSTAND' | 'APPLY' | 'ANALYZE';
}

// Contenido de Demo Guide
export interface DemoGuideContent {
    title: string;
    objective: string;
    prerequisites: string[];
    steps: {
        step_number: number;
        instruction: string;
        screenshot_placeholder: string;
        tip?: string;
        warning?: string;
    }[];
    summary: string;
    video_script?: VideoScript;
    storyboard?: StoryboardItem[];
    parallel_exercise?: ParallelExercise;
}

// Contenido de Exercise
export interface ExerciseContent {
    title: string;
    body_html: string;
    instructions: string;
    expected_outcome: string;
}

// Contenido de Video (Teórico/Demo)
export interface VideoContent {
    title: string;
    duration_estimate_minutes: number;
    script: VideoScript;
    storyboard: StoryboardItem[];
}

// Contenido de Video Guide
export interface VideoGuideContent extends VideoContent {
    parallel_exercise?: ParallelExercise;
}

// Script de video
export interface VideoScript {
    title?: string;
    duration_estimate_minutes?: number;
    sections: VideoSection[];
}

export interface VideoSection {
    section_number: number;
    section_type: string;
    narration_text: string;
    on_screen_text?: string;
    on_screen_action?: string;
    visual_notes: string;
    duration_seconds: number;
    timecode_start: string;
    timecode_end: string;
    reflection_question?: string;
    best_practices?: string[];
    common_errors?: string[];
    success_criteria?: string;
}

// Storyboard item
export interface StoryboardItem {
    take_number: number;
    timecode_start: string;
    timecode_end: string;
    visual_type: string;
    visual_content: string;
    on_screen_action?: string;
    on_screen_text?: string;
    narration_text: string;
    operational_notes?: string;
    success_criteria_visible?: string;
}

// Ejercicio paralelo
export interface ParallelExercise {
    title: string;
    instructions: string;
    steps: {
        step_number: number;
        instruction: string;
        expected_result?: string;
    }[];
}
