
// import { Handler } from '@netlify/functions'; // Removed to avoid missing dependency error
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// EMBEDDED PROMPT TO AVOID IMPORT ISSUES
const INSTRUCTIONAL_PLAN_VALIDATION_PROMPT = `Actúa como un Auditor de Calidad Instruccional Senior y Experto en Validación Curricular.
Tu objetivo es realizar una auditoría rigurosa del Plan Instruccional proporcionado, utilizando tanto criterios pedagógicos estrictos como contexto de actualidad del mercado actual.

═══════════════════════════════════════════════════════════════
    🕵️ AGENTE 1: VALIDACIÓN DE ACTUALIDAD (Contexto de Búsqueda)
═══════════════════════════════════════════════════════════════
Utiliza la información de búsqueda proporcionada (si la hay) o tu conocimiento de corte (cutoff) para verificar:
- ¿El contenido incluye tendencias, herramientas o metodologías de los últimos 2 años?
- ¿Hay conceptos obsoletos que deberían actualizarse?
- ¿Las referencias tecnológicas son vigentes?

═══════════════════════════════════════════════════════════════
    👨‍🏫 AGENTE 2: AUDITORÍA PEDAGÓGICA
═══════════════════════════════════════════════════════════════
1. Coherencia Taxonomía Bloom:
   - Verifica que el verbo del Objetivo de Aprendizaje (OA) coincida con la profundidad de las actividades.
   - Ejemplo ERROR: Verbo "Crear" (Nivel alto) pero solo hay un video pasivo y lectura.
   
2. Carga Cognitiva y Tiempo:
   - Suma las duraciones estimadas de todos los componentes.
   - El curso NO debe exceder 12 horas totales de consumo.
   - Alerta si una sola lección está demasiado cargada (> 45 min).

3. Criterios Medibles:
   - Verifica que el campo 'measurable_criteria' sea realmente objetivo y verificable (no subjetivo).

4. Cobertura y Estructura:
   - ¿Están presentes los componentes obligatorios (Dialogo, Quiz, Video)?
   - ¿La secuencia lógica de lecciones tiene sentido (de lo simple a lo complejo)?

═══════════════════════════════════════════════════════════════
    📊 FORMATO DE SALIDA (JSON)
═══════════════════════════════════════════════════════════════
Debes generar un reporte estructurado en JSON con el siguiente esquema exacto:

{
  "score_general": 95, // 0-100
  "estado": "APROBADO" | "RECHAZADO" | "REQUIERE_AJUSTES",
  "metricas": {
    "calidad_contenido": 90,
    "calidad_objetivos": 100,
    "cobertura_objetivos": 95,
    "coherencia_tematica": 100,
    "estructura_pedagogica": 90,
    "adherencia_bloom": 95
  },
  "resumen_ejecutivo": "El temario es sólido y actual, aunque se detecta una carga excesiva en el módulo 2...",
  "fortalezas": [
    "Redacción impecable de objetivos orientados a la acción",
    "Inclusión de temas de vanguardia como [Tema detectado]",
    "Secuencia lógica correcta"
  ],
  "recomendaciones": [
    "En la Lección X, reducir la duración del video teórico",
    "Actualizar la referencia de [Herramienta] que está en desuso",
    "Asegurar plantilla descargable para el ejercicio práctico"
  ],
  "actualidad_check": {
    "es_actual": true,
    "notas": "Se valida que incluye X, Y, Z que son tendencias 2024-2025."
  }
}

⚠️ REGLAS CRÍTICAS:
- Sé estricto. No des 100 si no es perfecto.
- Si el tiempo total > 12 horas, penaliza el Score General drásticamente.
- Detecta alucinaciones: Si el plan menciona herramientas inexistentes, repórtalo en recomendaciones.
`;

// Validation Schema Output
const MetricSchema = z.object({
    calidad_contenido: z.number().describe("0-100"),
    calidad_objetivos: z.number().describe("0-100"),
    cobertura_objetivos: z.number().describe("0-100"),
    coherencia_tematica: z.number().describe("0-100"),
    estructura_pedagogica: z.number().describe("0-100"),
    adherencia_bloom: z.number().describe("0-100"),
});

const ValidationCheckSchema = z.object({
    es_actual: z.boolean(),
    notas: z.string()
});

const ValidationResultSchema = z.object({
    score_general: z.number(),
    estado: z.enum(['APROBADO', 'RECHAZADO', 'REQUIERE_AJUSTES']),
    metricas: MetricSchema,
    resumen_ejecutivo: z.string(),
    fortalezas: z.array(z.string()),
    recomendaciones: z.array(z.string()),
    actualidad_check: ValidationCheckSchema
});

// Setup Clients
const googleAI = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY
});

export const handler = async (event: any, context: any) => {
    // 1. Parsing Request
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, body: 'Bad Request: Invalid JSON' };
    }

    const { artifactId, userToken } = body;

    if (!artifactId || !userToken) {
        return { statusCode: 400, body: 'Missing required fields' };
    }

    console.log(`[Validation Job] Starting validation for artifacts/${artifactId}`);

    // 2. Setup Supabase Client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
        global: {
            headers: { Authorization: `Bearer ${userToken}` },
        },
    });

    try {
        // --- STEP 1: FETCH DATA ---
        // Get the Instructional Plan
        const { data: plan, error: planError } = await supabase
            .from('instructional_plans')
            .select('*')
            .eq('artifact_id', artifactId)
            .single();

        if (planError || !plan) throw new Error(`Plan not found: ${planError?.message}`);

        // Get the Artifact for context (Title, Idea Central)
        const { data: artifact } = await supabase
            .from('artifacts')
            .select('idea_central, nombres, audiencia_objetivo')
            .eq('id', artifactId)
            .single();

        const courseName = (artifact?.nombres && artifact.nombres[0]) || artifact?.idea_central || "Curso Desconocido";

        // --- STEP 2: PREPARE PAYLOAD FOR AI ---
        const lessonsPayload = JSON.stringify(plan.lesson_plans, null, 2);

        const validationContext = `
        FECHA ACTUAL: ${new Date().toISOString().split('T')[0]}
        
        CURSO: ${courseName}
        AUDIENCIA: ${artifact?.audiencia_objetivo || "General"}
        
        PLAN INSTRUCCIONAL A VALIDAR:
        ${lessonsPayload}
        `;

        // --- STEP 3: RUN VALIDATION AGENTS ---
        // modelName: Use env var to match project config (e.g. gemini-3-flash-preview or gemini-2.0-flash)
        const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
        console.log(`[Validation Job] Validating with ${modelName}...`);

        const result = await generateObject({
            model: googleAI(modelName),
            schema: ValidationResultSchema,
            prompt: `${INSTRUCTIONAL_PLAN_VALIDATION_PROMPT}\n\n${validationContext}`,
            temperature: 0.2, // Low temp for strict analysis
        });

        const validationOutput = result.object;
        console.log(`[Validation Job] Score: ${validationOutput.score_general}, Status: ${validationOutput.estado}`);

        // --- STEP 4: SAVE RESULT ---
        const { error: updateError } = await supabase
            .from('instructional_plans')
            .update({
                validation: validationOutput,
                updated_at: new Date().toISOString()
            })
            .eq('id', plan.id);

        if (updateError) throw updateError;

        return { statusCode: 200, body: JSON.stringify({ success: true, result: validationOutput }) };

    } catch (err: any) {
        console.error('[Validation Job] Failed:', err);
        return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
    }
};
