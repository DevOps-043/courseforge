/**
 * Prompt Resolver Service for Materials Generation
 *
 * Resolves prompts from the system_prompts table with fallback chain:
 *   1. Organization-specific prompt (organization_id = current org)
 *   2. Global prompt (organization_id = null)
 *   3. Hardcoded default from materials-generation.prompts.modular.ts
 *
 * Used by the materials-generation-background Netlify function.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
    SYSTEM_PROMPT_CODE,
    COMPONENT_PROMPT_CODES,
    DEFAULT_PROMPTS,
} from './materials-generation.prompts.modular';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface ResolvedPrompts {
    /** Base system prompt (rules, format, accessibility) */
    systemPrompt: string;
    /** Per-component prompts keyed by ComponentType */
    componentPrompts: Record<string, string>;
}

interface SystemPromptRow {
    code: string;
    content: string;
    is_active: boolean;
}

// --------------------------------------------------------------------------
// JSON Schema Fragments per ComponentType
// --------------------------------------------------------------------------

const OUTPUT_SCHEMAS: Record<string, string> = {
    DIALOGUE: `"DIALOGUE": {
      "title": "string",
      "introduction": "string (opcional)",
      "scenes": [
        {
          "character": "SofLIA | Usuario | Narrador",
          "message": "string",
          "emotion": "neutral | happy | thinking | surprised (opcional)"
        }
      ],
      "conclusion": "string (opcional)",
      "reflection_prompt": "string",
      "improvement_log": {
        "description": "string",
        "fields": ["string"]
      },
      "mission_brief": {
        "objetivo_acreditacion": "string — competencia exacta a demostrar",
        "verbo_bloom": "Recordar | Comprender | Aplicar | Analizar | Evaluar | Crear",
        "conceptos_ancla": ["término1", "término2", "término3"],
        "escenario_inicial": "string — situación de negocio, máx. 40 palabras, sin preámbulos",
        "criterios_de_exito": ["hito_conversacional_1", "hito_conversacional_2"],
        "contenido_de_rescate": "string — respuesta correcta sintetizada para uso interno de la IA"
      }
    }`,

    READING: `"READING": {
      "title": "string",
      "body_html": "string (HTML formateado, ~750 palabras)",
      "sections": [
        { "heading": "string", "content": "string" }
      ],
      "estimated_reading_time_min": "number",
      "key_points": ["string"],
      "reflection_question": "string"
    }`,

    QUIZ: `"QUIZ": {
      "title": "string",
      "instructions": "string",
      "items": [
        {
          "id": "string",
          "question": "string",
          "type": "MULTIPLE_CHOICE | TRUE_FALSE | FILL_BLANK",
          "options": ["A", "B", "C", "D"],
          "correct_answer": "number | string",
          "explanation": "string (REQUERIDO)",
          "difficulty": "EASY | MEDIUM | HARD",
          "bloom_level": "REMEMBER | UNDERSTAND | APPLY | ANALYZE (opcional)"
        }
      ],
      "passing_score": 80
    }`,

    DEMO_GUIDE: `"DEMO_GUIDE": {
      "title": "string",
      "objective": "string",
      "prerequisites": ["string"],
      "steps": [
        {
          "step_number": "number",
          "instruction": "string",
          "screenshot_placeholder": "string",
          "tip": "string (opcional)",
          "warning": "string (opcional)"
        }
      ],
      "summary": "string",
      "video_script": {
        "title": "string",
        "duration_estimate_minutes": "number",
        "sections": [
          {
            "section_number": "number",
            "section_type": "introduction | content | conclusion",
            "narration_text": "string",
            "on_screen_text": "string (opcional)",
            "visual_notes": "string",
            "duration_seconds": "number",
            "timecode_start": "MM:SS",
            "timecode_end": "MM:SS"
          }
        ]
      },
      "storyboard": [
        {
          "take_number": "number",
          "timecode_start": "MM:SS",
          "timecode_end": "MM:SS",
          "visual_type": "capture | slide | text | diagram",
          "visual_content": "string",
          "on_screen_action": "string (opcional)",
          "on_screen_text": "string (opcional)",
          "narration_text": "string (GUIÓN EXACTO)",
          "operational_notes": "string (opcional)"
        }
      ],
      "parallel_exercise": {
        "title": "string",
        "instructions": "string",
        "steps": [
          { "step_number": "number", "instruction": "string", "expected_result": "string (opcional)" }
        ]
      }
    }`,

    EXERCISE: `"EXERCISE": {
      "title": "string",
      "body_html": "string (HTML formateado)",
      "instructions": "string",
      "expected_outcome": "string"
    }`,

    VIDEO_THEORETICAL: `"VIDEO_THEORETICAL": {
      "title": "string",
      "duration_estimate_minutes": "number",
      "script": {
        "sections": [
          {
            "section_number": "number",
            "section_type": "introduction | conceptual_development | applications | conclusion",
            "narration_text": "string",
            "on_screen_text": "string (opcional)",
            "visual_notes": "string",
            "duration_seconds": "number",
            "timecode_start": "MM:SS",
            "timecode_end": "MM:SS",
            "reflection_question": "string (solo en conclusion)"
          }
        ]
      },
      "storyboard": [
        {
          "take_number": "number",
          "timecode_start": "MM:SS",
          "timecode_end": "MM:SS",
          "visual_type": "slide | text | iconography | diagram | b_roll",
          "visual_content": "string",
          "on_screen_text": "string",
          "narration_text": "string (GUIÓN EXACTO)",
          "operational_notes": "string (opcional)"
        }
      ]
    }`,

    VIDEO_DEMO: `"VIDEO_DEMO": {
      "title": "string",
      "duration_estimate_minutes": "number",
      "script": {
        "sections": [
          {
            "section_number": "number",
            "section_type": "introduction | environment | demonstration | conclusions",
            "narration_text": "string",
            "on_screen_action": "string",
            "on_screen_text": "string (opcional)",
            "visual_notes": "string",
            "duration_seconds": "number",
            "timecode_start": "MM:SS",
            "timecode_end": "MM:SS",
            "best_practices": ["string"],
            "common_errors": ["string"]
          }
        ]
      },
      "storyboard": [
        {
          "take_number": "number",
          "timecode_start": "MM:SS",
          "timecode_end": "MM:SS",
          "visual_type": "capture | screen_recording | zoom | highlight | split_screen | b_roll",
          "visual_content": "string",
          "on_screen_action": "string",
          "on_screen_text": "string",
          "narration_text": "string (GUIÓN EXACTO)",
          "operational_notes": "string (opcional)"
        }
      ]
    }`,

    VIDEO_GUIDE: `"VIDEO_GUIDE": {
      "title": "string",
      "duration_estimate_minutes": "number",
      "script": {
        "sections": [
          {
            "section_number": "number",
            "section_type": "introduction | preparation | execution | review | reflection",
            "narration_text": "string",
            "on_screen_text": "string (opcional)",
            "visual_notes": "string",
            "duration_seconds": "number",
            "timecode_start": "MM:SS",
            "timecode_end": "MM:SS",
            "success_criteria": "string (opcional)"
          }
        ]
      },
      "storyboard": [
        {
          "take_number": "number",
          "timecode_start": "MM:SS",
          "timecode_end": "MM:SS",
          "visual_type": "step_capture | instruction_box | success_criteria | comparison | b_roll",
          "visual_content": "string",
          "success_criteria_visible": "string",
          "on_screen_text": "string",
          "narration_text": "string (GUIÓN EXACTO)",
          "operational_notes": "string (opcional)"
        }
      ],
      "parallel_exercise": {
        "title": "string",
        "instructions": "string",
        "steps": [
          { "step_number": "number", "instruction": "string", "expected_result": "string (opcional)" }
        ]
      }
    }`,
};

OUTPUT_SCHEMAS.DIALOGUE = `"DIALOGUE": {
      "interactionType": "soflia_dialogue",
      "runtimeType": "SOFLIA_DIALOGUE",
      "schemaVersion": "1.0.0",
      "title": "string",
      "visibleGoal": "string",
      "learningObjective": "string",
      "scenario": "string",
      "openingMessage": "string",
      "studentRole": "string",
      "sofliaRole": "string",
      "successCriteria": [
        {
          "id": "stable_snake_case_id",
          "label": "string",
          "description": "string",
          "required": true
        }
      ],
      "expectedEvidence": ["string"],
      "commonMistakes": ["string"],
      "hintLadder": [
        {
          "id": "stable_snake_case_id",
          "level": 1,
          "targetCriterionId": "stable_snake_case_id",
          "content": "string"
        }
      ],
      "challengePrompts": ["string"],
      "contextAdaptation": {
        "enabled": true,
        "instructions": "string",
        "focus": ["role", "industry", "mission"]
      },
      "rescueContent": "string",
      "rubric": [
        {
          "id": "stable_snake_case_id",
          "label": "string",
          "description": "string",
          "weight": 25
        }
      ],
      "policy": {
        "approvalMinimum": 75,
        "maxTurns": 8,
        "maxHints": 3,
        "rescueAfterLowEvidenceTurns": 2,
        "allowRetry": true
      },
      "tutor": {
        "tone": "direct_supportive",
        "maxResponseSentences": 4
      },
      "evaluator": {
        "promptVersion": "DIALOGUE_EVALUATOR_RUNTIME@1.0.0"
      },
      "analytics": {
        "trackEvents": [
          "dialogue_started",
          "user_turn_submitted",
          "evaluation_completed",
          "criterion_met",
          "hint_given",
          "challenge_given",
          "rescue_triggered",
          "dialogue_completed",
          "dialogue_failed",
          "retry_started",
          "injection_detected"
        ]
      },
      "versioning": {
        "materialVersion": "string",
        "rubricVersion": "string",
        "promptVersion": "SOFLIA_DIALOGUE_TUTOR@1.0.0"
      }
    }`;

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Resolves prompts from DB with fallback to hardcoded defaults.
 *
 * @param supabase - Supabase client (service role recommended)
 * @param componentTypes - ComponentTypes to include (e.g. ['QUIZ', 'READING'])
 * @param organizationId - Optional org ID for org-specific prompts
 */
export async function resolvePrompts(
    supabase: SupabaseClient,
    componentTypes: string[],
    organizationId?: string | null,
): Promise<ResolvedPrompts> {
    const codesNeeded = [SYSTEM_PROMPT_CODE];
    for (const ct of componentTypes) {
        const code = COMPONENT_PROMPT_CODES[ct];
        if (code) codesNeeded.push(code);
    }

    const dbPrompts = await fetchPromptsFromDb(supabase, codesNeeded, organizationId);

    const systemPrompt = dbPrompts.get(SYSTEM_PROMPT_CODE) ?? DEFAULT_PROMPTS[SYSTEM_PROMPT_CODE] ?? '';

    const componentPrompts: Record<string, string> = {};
    for (const ct of componentTypes) {
        const code = COMPONENT_PROMPT_CODES[ct];
        if (!code) continue;
        componentPrompts[ct] = dbPrompts.get(code) ?? DEFAULT_PROMPTS[code] ?? '';
    }

    return { systemPrompt, componentPrompts };
}

/**
 * Assembles a complete prompt string ready to send to the LLM.
 *
 * @param resolved - Output from resolvePrompts()
 * @param componentTypes - The component types being generated
 * @returns Full prompt string with system rules + component instructions + JSON schema
 */
export function assemblePrompt(resolved: ResolvedPrompts, componentTypes: string[]): string {
    const parts: string[] = [];

    parts.push(resolved.systemPrompt);
    parts.push('\n---\n');
    parts.push('## Prioridad de instrucciones\n');
    parts.push('- El schema JSON define UNICAMENTE la forma de salida y los campos requeridos.\n');
    parts.push('- El comportamiento pedagogico, tono, dinamica y estrategia de interaccion deben venir del prompt especifico del componente.\n');
    parts.push('- Si el prompt del componente pide un estilo o dinamica particular y no contradice el schema, sigue el prompt del componente.\n');
    parts.push('- No conviertas el schema en una guia de estilo ni en una plantilla rigida de redaccion.\n');
    parts.push('- Para DIALOGUE, genera configuracion evaluable para SOFLIA_DIALOGUE; no generes scenes, guiones rigidos ni respuestas esperadas palabra por palabra.\n');
    parts.push('\n---\n');

    parts.push('## Componentes a generar\n');
    for (const ct of componentTypes) {
        const prompt = resolved.componentPrompts[ct];
        if (prompt) {
            parts.push(prompt);
            parts.push('\n---\n');
        }
    }

    parts.push('## Formato de salida JSON (OBLIGATORIO)\n');
    parts.push('Responde **SOLO con JSON válido** usando esta estructura exacta.\n');
    parts.push('La siguiente estructura es un contrato de datos; no redefine el enfoque pedagogico ya indicado arriba.\n');
    parts.push('```json\n{\n  "components": {\n');

    const schemaFragments = componentTypes.map(ct => OUTPUT_SCHEMAS[ct]).filter(Boolean);
    parts.push(schemaFragments.join(',\n'));

    parts.push('\n  },\n  "source_refs_used": ["source_id_1", "source_id_2"]\n}\n```\n');

    return parts.join('\n');
}

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

async function fetchPromptsFromDb(
    supabase: SupabaseClient,
    codes: string[],
    organizationId?: string | null,
): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    // Try org-specific prompts first
    if (organizationId) {
        const { data: orgRows } = await supabase
            .from('system_prompts')
            .select('code, content, is_active')
            .in('code', codes)
            .eq('organization_id', organizationId)
            .eq('is_active', true);

        if (orgRows && orgRows.length > 0) {
            for (const row of orgRows as SystemPromptRow[]) {
                result.set(row.code, row.content);
            }
        }
    }

    // Fill gaps with global prompts (organization_id IS NULL)
    const missingCodes = codes.filter(c => !result.has(c));
    if (missingCodes.length > 0) {
        const { data: globalRows } = await supabase
            .from('system_prompts')
            .select('code, content, is_active')
            .in('code', missingCodes)
            .is('organization_id', null)
            .eq('is_active', true);

        if (globalRows) {
            for (const row of globalRows as SystemPromptRow[]) {
                if (!result.has(row.code)) {
                    result.set(row.code, row.content);
                }
            }
        }
    }

    return result;
}

// --------------------------------------------------------------------------
// Single prompt resolution (for non-materials prompts like B-roll)
// --------------------------------------------------------------------------

/**
 * Resolves a single prompt by code from DB with fallback to hardcoded default.
 *
 * Fallback chain:
 *   1. Organization-specific (organization_id = current org)
 *   2. Global (organization_id IS NULL)
 *   3. Hardcoded default from DEFAULT_PROMPTS map
 *
 * Use this for standalone prompts that are NOT part of the assembled
 * materials prompt (e.g., VIDEO_BROLL_PROMPTS for Phase 6 production).
 *
 * @param supabase - Supabase client (service role recommended)
 * @param code - The prompt code to resolve (e.g., 'VIDEO_BROLL_PROMPTS')
 * @param organizationId - Optional org ID for org-specific prompt
 * @returns The resolved prompt content string
 */
export async function resolveSinglePrompt(
    supabase: SupabaseClient,
    code: string,
    organizationId?: string | null,
): Promise<string> {
    const dbPrompts = await fetchPromptsFromDb(supabase, [code], organizationId);
    return dbPrompts.get(code) ?? DEFAULT_PROMPTS[code] ?? '';
}
