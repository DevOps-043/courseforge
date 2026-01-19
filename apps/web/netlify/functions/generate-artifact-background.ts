import { Handler } from '@netlify/functions';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// Constants
const BLOOM_VERBS = [
  "comprender", "aplicar", "analizar", "evaluar", "crear", 
  "desarrollar", "identificar", "describir", "diseñar", 
  "implementar", "demostrar", "explicar"
];
const MAX_RETRIES = 3;

// Schemas (Only Phase 1 needed here for now, but keeping structure generic)
// ...

// Setup Clients
const googleAI = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY
});

// Nuevo SDK @google/genai para Google Search Grounding
const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || '' });

export const handler: Handler = async (event, context) => {
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

    const { artifactId, formData, userToken, feedback } = body; // Added feedback support

    if (!artifactId || !formData || !userToken) {
        return { statusCode: 400, body: 'Missing required fields' };
    }

    console.log(`[Background Job] Starting generation for artifacts/${artifactId}`);

    // 2. Setup Supabase Client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
        global: {
            headers: { Authorization: `Bearer ${userToken}` },
        },
    });

    try {
        // --- STEP 1: RESEARCH ---
        let researchContext = "";
        let detectedSearchQueries: string[] = [];
        const searchModels = [process.env.GEMINI_SEARCH_MODEL, 'gemini-2.0-flash'].filter(Boolean) as string[];
        let researchSuccess = false;
        
        const researchPrompt = `
            Investiga tendencias educativas 2024-2025 sobre:
            TEMA: ${formData.title}
            DESCRIPCIÓN: ${formData.description}
            Encuentra herramientas, estadísticas y obsolescencias.
            ${feedback ? `\nNOTA IMPORTANTE (Feedback Usuario): ${feedback}` : ''}
        `;

        for (const modelName of searchModels) {
            try {
                console.log(`[Background Job] Researching with ${modelName}...`);

                // Nueva API de @google/genai con Google Search Grounding
                const result = await genAI.models.generateContent({
                    model: modelName,
                    contents: researchPrompt,
                    config: {
                        tools: [{ googleSearch: {} }],
                        temperature: 0.7
                    }
                });

                researchContext = result.text || '';

                const grounding = result.candidates?.[0]?.groundingMetadata;
                if (grounding?.webSearchQueries) {
                     detectedSearchQueries = grounding.webSearchQueries as string[];
                     console.log(`[Background Job] ✅ Google Search used. Queries: ${detectedSearchQueries.join(', ')}`);
                } else {
                     console.log(`[Background Job] Warning: Model ${modelName} did NOT perform a Google Search.`);
                }

                // Verificar grounding chunks (URLs verificadas)
                const groundingChunks = grounding?.groundingChunks || [];
                console.log(`[Background Job] Grounding URLs found: ${groundingChunks.length}`);

                console.log(`[Background Job] Research complete using ${modelName}.`);
                researchSuccess = true;
                break; // Exit loop on success
            } catch (e: any) {
                console.warn(`[Background Job] Research failed with ${modelName}:`, e.message);
            }
        }

        if (!researchSuccess) {
            console.warn("[Background Job] All research models failed. Proceeding without search context.");
            researchContext = "Research unavailable due to API errors.";
        }

        // --- STEP 2: GENERATION (PHASE 1 ONLY: BASE DEFINITIONS) ---
        const genModels = [process.env.GEMINI_MODEL, 'gemini-2.0-flash'].filter(Boolean) as string[];
        
        const Phase1Schema = z.object({
            nombres: z.array(z.string()).length(3).describe("3 opciones de nombres creativos y comerciales para el curso"),
            objetivos: z.array(z.string()).min(3).max(6).describe("Entre 3 y 6 objetivos de aprendizaje generales iniciando con verbos de la Taxonomía de Bloom"),
            descripcion: z.object({
                texto: z.string().describe("Descripción general del curso"),
                publico_objetivo: z.string().describe("Perfil detallado del estudiante ideal"),
                beneficios: z.string().describe("Resultados transformacionales clave"),
                diferenciador: z.string().describe("Por qué este curso es único comparado con otros")
            })
        });

        const systemPrompt = `
            Eres un Diseñador Instruccional Experto y Copywriter Senior.
            CONTEXTO RESEARCH: ${researchContext}
            ${feedback ? `\nFEEDBACK PREVIO (Corrigiendo versión anterior): ${feedback}` : ''}
            
            Tu tarea es DEFINIR LA BASE para el curso: "${formData.title}".
            Input del usuario: "${formData.description}".
            
            Genera:
            1. 3 Nombres atractivos (Hook + Promesa).
            2. Entre 3 y 5 Objetivos de aprendizaje claros (Verbos Bloom: ${BLOOM_VERBS.join(', ')}). NO generes más de 6.
            3. Descripción vendedora y perfilamiento.
            
            NO generes el temario ni módulos aún. Solo la definición estratégica.
        `;

        let content;
        let genModelUsed = '';

        for (const modelName of genModels) {
            try {
                console.log(`[Background Job] Generating Phase 1 with ${modelName}...`);
                const result = await generateObject({
                    model: googleAI(modelName),
                    schema: Phase1Schema,
                    prompt: systemPrompt,
                    temperature: 0.7,
                });
                content = result.object;
                genModelUsed = modelName;
                console.log(`[Background Job] Phase 1 Generation success using ${modelName}.`);
                break;
            } catch (e: any) {
                 console.warn(`[Background Job] Generation failed with ${modelName}:`, e.message);
            }
        }

        if (!content) {
            throw new Error(`Generation failed on all models (${genModels.join(', ')}).`);
        }

        // --- STEP 3: VALIDATION (PHASE 1) ---
        const objectives = content.objetivos || [];
        const names = content.nombres || [];
        const description = content.descripcion?.texto || content.descripcion?.resumen || ""; // Handle variable schema response

        // Checks
        const checkBloom = objectives.every((obj: string) => BLOOM_VERBS.some(v => obj.trim().toLowerCase().startsWith(v.toLowerCase())));
        const checkNamesCount = names.length === 3;
        const checkObjectivesCount = objectives.length >= 3 && objectives.length <= 8;
        const checkDescLength = description.length > 30; // Min length check

        const validationReport = [
            { 
                code: 'V01', 
                message: checkBloom ? 'Objetivos cumplen Taxonomía de Bloom' : 'Objetivos deben iniciar con verbos de acción (Bloom)', 
                passed: checkBloom 
            },
            {
                code: 'V02',
                message: checkNamesCount ? 'Se generaron 3 opciones de nombres' : `Se generaron ${names.length} nombres (se requieren 3)`,
                passed: checkNamesCount
            },
            {
                code: 'V03',
                message: checkObjectivesCount ? 'Cantidad adecuada de objetivos (3-8)' : `Cantidad de objetivos fuera de rango (${objectives.length})`,
                passed: checkObjectivesCount
            },
            {
                code: 'V04',
                message: checkDescLength ? 'Descripción cumple longitud mínima' : 'La descripción es demasiado breve',
                passed: checkDescLength
            }
        ];

        const allPassed = validationReport.every(v => v.passed);

        // --- STEP 4: SAVE ---
        const { error } = await supabase.from('artifacts').update({
            nombres: content.nombres,
            objetivos: content.objetivos,
            descripcion: content.descripcion, 
            generation_metadata: {
                research_summary: researchContext.slice(0, 2000),
                search_queries: detectedSearchQueries,
                model_used: genModelUsed,
                phase: 'PHASE_1_BASE',
                structure: [], 
                original_input: formData,
                last_feedback_used: feedback || null
            },
            validation_report: { results: validationReport, all_passed: allPassed },
            state: allPassed ? 'READY_FOR_QA' : 'ESCALATED' 
        }).eq('id', artifactId);

        if (error) throw error;
        
        console.log(`[Background Job] Success! Artifact ${artifactId} updated to Phase 1 Base.`);
        return { statusCode: 200, body: JSON.stringify({ success: true }) };

    } catch (err: any) {
        console.error('[Background Job] Failed', err);
        return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
    }
};
