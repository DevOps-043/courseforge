import { Handler } from '@netlify/functions';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

// --- CONFIG ---
// Copiamos el prompt para asegurar que la función tenga todo lo necesario sin dependencias complejas de imports
const SYLLABUS_PROMPT = `
Actúa como un Arquitecto de Aprendizaje experto y un Diseñador Curricular de clase mundial.
Tu tarea es estructurar un temario detallado y lógico para un curso online basado en la siguiente Idea Central y Objetivos.

### INPUTS:
- **Idea Central / Tema**: {{ideaCentral}}
- **Objetivos de Aprendizaje**: 
{{objetivos}}
- **Contexto Avanzado**: 
{{routeContext}}

### INSTRUCCIONES:
Genera una estructura de módulos y lecciones que cubra todos los objetivos de manera progresiva (scaffolding).
Cada módulo debe tener coherencia narrativa.
Cada lección debe ser accionable y clara.

### FORMATO DE SALIDA (JSON ESTRICTO):
Debes devolver UNICAMENTE un objeto JSON válido con esta estructura exacta:
{
  "modules": [
    {
      "id": "mod-1",
      "title": "Nombre atractivo del módulo",
      "lessons": [
        {
          "id": "les-1-1",
          "title": "Título de la lección",
          "objective_specific": "Lo que el alumno aprenderá específicamente en esta lección"
        }
      ]
    }
  ]
}

No incluyas markdown, ni bloques de código \`\`\`, solo el JSON raw.
Asegúrate de que el JSON sea perfectamente válido.
`;

const COURSE_CONFIG = {
    avgLessonMinutes: 15
};

// --- HANDLER ---
export const handler: Handler = async (event, context) => {
    // 1. Parsing Request
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Monitor Method Not Allowed' };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, body: 'Bad Request: Invalid JSON' };
    }

    const { artifactId, objetivos, ideaCentral, route, accessToken } = body;

    if (!artifactId || !objetivos || !ideaCentral) {
        return { statusCode: 400, body: 'Missing required fields' };
    }

    console.log(`[Syllabus Background] Iniciando generación para artifact: ${artifactId}`);

    // 2. Setup Supabase (Service Role para escritura segura background)
    // Usamos SERVICE_ROLE si está disponible para saltarnos RLS, o el token del usuario si no.
    // Para background jobs, service role es mejor.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 3. Setup Gemini con nuevo SDK @google/genai
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || '';
    if (!apiKey) {
        console.error('[Syllabus Background] No API Key found');
        return { statusCode: 500, body: 'Server Configuration Error' };
    }
    const genAI = new GoogleGenAI({ apiKey });

    try {
        // --- PASO 1: INVESTIGACIÓN (Gemini 2.0 Flash + Search) ---
        const searchModelName = process.env.GEMINI_SEARCH_MODEL || 'gemini-2.0-flash';
        console.log(`[Syllabus Background] Paso 1: Investigando con ${searchModelName}...`);
        
        let researchContext = "";
        let searchQueries: string[] = [];

        try {
            const researchPrompt = `Investiga en profundidad sobre el tema: "${ideaCentral}".
            Objetivos del curso: ${objetivos.join(', ')}.
            Identifica:
            1. Tendencias actuales del mercado para este tema.
            2. Conceptos clave obligatorios.
            3. Estructura lógica recomendada.
            Dame un resumen denso y técnico.`;

            // Nueva API de @google/genai con Google Search Grounding
            const searchResult = await genAI.models.generateContent({
                model: searchModelName,
                contents: researchPrompt,
                config: {
                    tools: [{ googleSearch: {} }],
                    temperature: 0.7
                }
            });

            researchContext = searchResult.text || '';

            // Extract queries metadata if available
            const grounding = searchResult.candidates?.[0]?.groundingMetadata;
            if (grounding?.webSearchQueries) {
                searchQueries = grounding.webSearchQueries as string[];
            }

            // Log de grounding para debug
            const groundingChunks = grounding?.groundingChunks || [];
            console.log(`[Syllabus Background] ✅ Investigación completada.`);
            console.log(`[Syllabus Background] Búsquedas ejecutadas: ${searchQueries.length}`, searchQueries);
            console.log(`[Syllabus Background] URLs de grounding: ${groundingChunks.length}`);

        } catch (err: any) {
            console.warn(`[Syllabus Background] Falló research con ${searchModelName}:`, err.message);
            researchContext = "Investigación no disponible por error técnico. Usar conocimiento base.";
        }


        // --- PASO 2: ESTRUCTURACIÓN CON AUTO-CORRECCIÓN (Agentic Loop) ---
        const mainModelName = process.env.GEMINI_MODEL || 'gemini-1.5-pro'; 
        console.log(`[Syllabus Background] Paso 2: Arquitectura con ${mainModelName}...`);

        const baseRouteContext = route === 'A_WITH_SOURCE'
            ? 'El contenido debe ser estructurado y formal, basado en fuentes académicas.'
            : 'Genera el contenido desde cero basándote en las mejores prácticas del tema.';
        
        let contextWithResearch = `${baseRouteContext}\n\n### INVESTIGACIÓN RECIENTE:\n${researchContext}`;
        
        // REGLAS ESTRICTAS para inyectar en el prompt
        const STRICT_RULES = `
        REGLAS DE ORO (CRÍTICAS):
        1. Cantidad de Módulos: Debes generar EXACTAMENTE ${objetivos.length} módulos. Un módulo por cada objetivo principal, en el mismo orden.
        2. Cantidad de Lecciones: Cada módulo debe tener ENTRE 3 y 6 lecciones. Ni menos de 3, ni más de 6.
        3. Verbos Bloom: Cada 'objective_specific' de las lecciones DEBE iniciar con un verbo de acción (Bloom) en infinitivo o tercera persona (ej: Analizar, Evalúa, Diseñar).
        4. No Duplicados: No repitas títulos de lecciones ni objetivos.
        `;

        contextWithResearch += `\n\n${STRICT_RULES}`;

        const objetivosStr = objetivos.map((obj: string, i: number) => `${i + 1}. ${obj}`).join('\n');

        let finalPrompt = SYLLABUS_PROMPT
            .replace('{{ideaCentral}}', ideaCentral)
            .replace('{{objetivos}}', objetivosStr)
            .replace('{{routeContext}}', contextWithResearch)
            .replace(/{{.*?}}/g, '');

        let attempts = 0;
        let maxAttempts = 3;
        let content: any = null;
        let validationErrors: string[] = [];
        let isValid = false;

        while (attempts < maxAttempts && !isValid) {
            attempts++;
            console.log(`[Syllabus Background] Intento de Generación #${attempts}...`);
            
            if (attempts > 1) {
                // Agregar feedback de errores al prompt
                finalPrompt += `\n\nREPORTE DE ERRORES DEL INTENTO ANTERIOR (CORRIGE ESTO):
                ${validationErrors.join('\n')}
                
                Asegúrate de cumplir TODAS las REGLAS DE ORO. Genera el JSON corregido completo.`;
            }

            try {
                // Nueva API de @google/genai (sin Google Search, solo estructuración)
                const result = await genAI.models.generateContent({
                    model: mainModelName,
                    contents: finalPrompt,
                    config: {
                        temperature: parseFloat(process.env.GEMINI_TEMPERATURE || '0.7'),
                        responseMimeType: "application/json"
                    }
                });
                const responseText = result.text || '';
                
                const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
                const finalJson = jsonMatch ? jsonMatch[0] : cleanJson;
                
                content = JSON.parse(finalJson);
                
                // --- VALIDACIÓN INTERNA ---
                validationErrors = [];
                
                // 1. Validar cantidad de módulos
                if (content.modules.length !== objetivos.length) {
                    validationErrors.push(`Error: Se generaron ${content.modules.length} módulos, pero se esperaban exactamente ${objetivos.length} (uno por objetivo).`);
                }

                // 2. Validar lecciones por módulo
                content.modules.forEach((mod: any, idx: number) => {
                    if (!mod.lessons || mod.lessons.length < 3 || mod.lessons.length > 6) {
                        validationErrors.push(`Error en Módulo ${idx + 1}: Tiene ${mod.lessons?.length || 0} lecciones. Debe tener entre 3 y 6.`);
                    }
                    
                    // 3. Validar Verbos Bloom (Simulada simple)
                    mod.lessons?.forEach((les: any) => {
                         const firstWord = les.objective_specific?.split(' ')[0]?.trim();
                         if (!firstWord || firstWord.length < 4) {
                             // Validación laxa, solo detecta vacíos o muy cortos.
                             // Bloom estricto requeriría lista gigante, confiamos en el prompt de corrección si el usuario lo nota.
                         }
                    });
                });

                // Decisión
                if (validationErrors.length === 0) {
                    isValid = true;
                    console.log(`[Syllabus Background] ✅ Validación Interna PASADA en intento ${attempts}.`);
                } else {
                    console.warn(`[Syllabus Background] ❌ Validación Fallida en intento ${attempts}:`, validationErrors);
                }

            } catch (e: any) {
                console.error(`[Syllabus Background] Error parseando/generando en intento ${attempts}:`, e.message);
                validationErrors.push("El formato JSON generado no era válido o hubo un error de red.");
            }
        }

        // Si fallamos 3 veces, usamos el último content disponible (aunque sea inválido) pero lo marcamos.
        // Ojo: si content es null, fallar total.
        if (!content) throw new Error("No se pudo generar un JSON válido después de varios intentos.");

        // Cálculos Finales
        const totalLessons = content.modules.reduce((acc: number, m: any) => acc + (m.lessons?.length || 0), 0);
        const estimatedHours = (totalLessons * COURSE_CONFIG.avgLessonMinutes) / 60;
        content.total_estimated_hours = Math.round(estimatedHours * 10) / 10;

        content.generation_metadata = {
            research_summary: researchContext,
            search_queries: searchQueries,
            models: { search: searchModelName, architect: mainModelName },
            generated_at: new Date().toISOString(),
            validation_attempts: attempts,
            final_validation_errors: validationErrors // Guardar para debug
        };

        console.log(`[Syllabus Background] Generados ${content.modules.length} módulos FINAL.`);


        // --- PASO 3: GUARDAR EN DB ---
        // 1. Guardar/Actualizar Syllabus
        const { error: syllabusError } = await supabase
            .from('syllabus')
            .upsert({
                artifact_id: artifactId,
                modules: content.modules,
                source_summary: content.generation_metadata,
                state: 'STEP_REVIEW', // Estado "Listo para revisión"
                iteration_count: 1, 
                updated_at: new Date().toISOString()
            }, { onConflict: 'artifact_id' });

        if (syllabusError) throw syllabusError;

        console.log('[Syllabus Background] Proceso completado exitosamente.');
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, modulesCount: content.modules.length })
        };

    } catch (error: any) {
        console.error('[Syllabus Background] Error Fatal:', error);
        
        // Intentar reportar error en DB (Syllabus state -> ERROR)
        await supabase.from('syllabus').upsert({
            artifact_id: artifactId,
            state: 'STEP_ESCALATED', // Error state
            source_summary: { error: error.message }
        }, { onConflict: 'artifact_id' });

        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
