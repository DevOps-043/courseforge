import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

// --- INTERFACES ---
interface ValidationResult {
    relevance: number;
    depth: number;
    quality: number;
    applicability: number;
    average: number;
    feedback_notes: string;
    is_approved: boolean;
}

interface PlanComponent {
    lesson_id: string;
    lesson_title: string;
    component_type: string;
    is_critical: boolean;
    summary?: string;
}

interface RowUpdate {
    id: string;
    apta: boolean;
    cobertura_completa: boolean;
    notes: string;
    last_checked_at: string;
    auto_evaluated: boolean;
    source_ref?: string;
}

// Configuración de paralelismo
const PARALLEL_VALIDATIONS = 3; // Número de validaciones en paralelo

// Prompt Template for Validation - AHORA CON CONTENIDO REAL DESCARGADO
const getValidationPrompt = (component: any, url: string, pageContent: { title: string; content: string; wordCount: number }) => `
Actúa como un experto Curador de Contenido Educativo.
Evalúa el siguiente recurso externo para ser usado en una lección de curso online.

CONTEXTO DEL COMPONENTE:
- Título de la lección: ${component.title || component.lesson_title || 'Sin título'}
- Tipo de componente: ${component.type || component.component || 'Artículo'}
- Descripción esperada: ${component.description || component.source_rationale || 'Sin descripción'}

RECURSO A EVALUAR:
- URL: ${url}
- Título de la página: ${pageContent.title || 'Sin título'}
- Palabras en el contenido: ${pageContent.wordCount}

=== CONTENIDO REAL DE LA PÁGINA ===
${pageContent.content || '[No se pudo extraer contenido - página posiblemente vacía o con contenido dinámico]'}
=== FIN DEL CONTENIDO ===

CRITERIOS DE EVALUACIÓN (Escala 1-10):
1. Relevancia: ¿El contenido REAL está relacionado con "${component.title || component.lesson_title}"?
   - Si el contenido no tiene relación, dar 1-3
2. Profundidad: ¿Tiene suficiente detalle y rigor académico/profesional?
   - Si tiene menos de 200 palabras útiles, dar máximo 5
   - Si es solo un menú o índice, dar 1-3
3. Calidad: ¿Es contenido sustancial y bien estructurado?
   - Si es una página de error, menú, o contenido mínimo, dar 1-3
4. Aplicabilidad: ¿Es útil para el aprendizaje del estudiante?

REGLAS IMPORTANTES:
- RECHAZA (is_approved: false) si:
  * El contenido tiene menos de 150 palabras útiles
  * Es una página de error, menú de navegación, o índice
  * El contenido no tiene relación con el tema esperado
  * La página está mayormente vacía o es spam
- APRUEBA (is_approved: true) solo si:
  * El contenido es sustancial (>200 palabras relevantes)
  * Tiene información educativa real sobre el tema
  * Promedio > 6.5

Responde ÚNICAMENTE con un JSON válido:
{
  "relevance": <número 1-10>,
  "depth": <número 1-10>,
  "quality": <número 1-10>,
  "applicability": <número 1-10>,
  "average": <promedio de los 4 anteriores>,
  "feedback_notes": "<feedback específico sobre el contenido REAL encontrado>",
  "is_approved": <true o false según las reglas>
}
`;

export const handler: Handler = async (event) => {
    // 1. Setup & Auth
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

    const { artifactId, userToken } = body;
    if (!artifactId || !userToken) return { statusCode: 400, body: 'Missing artifacts' };

    console.log(`[Curation Validation] Starting for artifact ${artifactId}`);
    const startTime = Date.now();

    // Use Service Role Key for background processing to avoid JWT expiration
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseServiceKey) {
        console.error('CRITICAL: SUPABASE_SERVICE_ROLE_KEY is missing. Background process may fail with JWT expired.');
    }

    const supabase = createClient(
        supabaseUrl,
        supabaseServiceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        supabaseServiceKey ? {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        } : { 
            global: { headers: { Authorization: `Bearer ${userToken}` } } 
        }
    );

    // SDK Nativo de Google - soporta todos los modelos incluyendo gemini-3
    const genAI = new GoogleGenAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || ''
    });

    try {
        // 2. Fetch Config & Data
        const { data: settings } = await supabase.from('curation_settings').select('*');
        const validationConfig = settings?.find((s: any) => s.setting_type === 'VALIDATION');
        const searchConfig = settings?.find((s: any) => s.setting_type === 'SEARCH');

        // Modelos de BD con defaults seguros
        const VALIDATION_MODEL = validationConfig?.model_name || 'gemini-2.5-pro';
        const rawFallback = validationConfig?.fallback_model;
        const VALIDATION_FALLBACK = (rawFallback && !rawFallback.includes('review'))
            ? rawFallback
            : 'gemini-2.0-flash';
        const SEARCH_MODEL = searchConfig?.model_name || 'gemini-2.5-pro';

        console.log(`[Config] Validation: ${VALIDATION_MODEL} (fallback: ${VALIDATION_FALLBACK}), Search: ${SEARCH_MODEL}`);

        // 3. Fetch Plan Instruccional para obtener componentes esperados
        const { data: plan } = await supabase
            .from('instructional_plans')
            .select('lesson_plans')
            .eq('artifact_id', artifactId)
            .single();

        // Extraer todos los componentes esperados del plan
        const expectedComponents: PlanComponent[] = [];
        if (plan?.lesson_plans && Array.isArray(plan.lesson_plans)) {
            for (const lesson of plan.lesson_plans) {
                const lessonId = lesson.lesson_id || lesson.id || '';
                const lessonTitle = lesson.lesson_title || lesson.title || 'Sin título';

                if (Array.isArray(lesson.components)) {
                    for (const comp of lesson.components) {
                        const compType = typeof comp === 'string' ? comp : (comp.type || comp.component || 'UNKNOWN');
                        expectedComponents.push({
                            lesson_id: lessonId,
                            lesson_title: lessonTitle,
                            component_type: compType,
                            is_critical: typeof comp === 'object' && comp.is_critical ? true : false,
                            summary: typeof comp === 'object' ? comp.summary : undefined
                        });
                    }
                }
            }
        }
        console.log(`[Plan] Componentes esperados del Plan Instruccional: ${expectedComponents.length}`);

        // 4. Fetch Curation Rows
        const curationId = await getCurationId(supabase, artifactId);
        if (!curationId) throw new Error('Curation not found for artifact');

        const { data: allRows, error: rowsError } = await supabase
            .from('curation_rows')
            .select('*')
            .eq('curation_id', curationId);

        if (rowsError || !allRows) throw new Error('No curation rows found');

        // 5. Identificar componentes sin fuentes (en plan pero no en curation_rows)
        const existingComponents = new Set(
            allRows.map(r => `${r.lesson_id}::${r.component}`)
        );
        const missingComponents = expectedComponents.filter(
            c => !existingComponents.has(`${c.lesson_id}::${c.component_type}`)
        );

        if (missingComponents.length > 0) {
            console.log(`[Gap] Componentes sin fuentes: ${missingComponents.length}`);
            missingComponents.forEach(c => {
                console.log(`  - ${c.lesson_title} / ${c.component_type}`);
            });
        }

        // 6. Filtrar rows pendientes de validación
        const rows = allRows.filter(row => {
            const hasGoogleRedirect = row.source_ref &&
                (row.source_ref.includes('vertexaisearch.cloud.google.com') ||
                 row.source_ref.includes('grounding-api-redirect'));
            return !row.auto_evaluated || hasGoogleRedirect;
        });

        console.log(`[Validation] Total rows: ${allRows.length}, Pending: ${rows.length}`);

        // 7. Función para procesar una sola row
        const processRow = async (row: any): Promise<RowUpdate | null> => {
            let currentUrl = row.source_ref || row.url;
            let isApproved = false;
            let notes = "";
            const MAX_ATTEMPTS = 2;

            // Resolver redirects de Google
            if (currentUrl && (currentUrl.includes('vertexaisearch.cloud.google.com') || currentUrl.includes('grounding-api-redirect'))) {
                console.log(`[Row ${row.id.slice(0,8)}] Resolviendo redirect de Google...`);
                const resolvedUrl = await resolveGoogleRedirect(currentUrl);
                if (resolvedUrl) {
                    console.log(`[Row ${row.id.slice(0,8)}] ✓ Resuelto: ${resolvedUrl.slice(0,60)}...`);
                    currentUrl = resolvedUrl;
                } else {
                    console.log(`[Row ${row.id.slice(0,8)}] ✗ No resuelto, buscando alternativa...`);
                    currentUrl = null;
                }
            }

            // Si no hay URL, buscar una
            if (!currentUrl) {
                currentUrl = await searchAlternativeUrl(genAI, SEARCH_MODEL, row);
            }

            // Loop de validación
            for (let attempt = 1; attempt <= MAX_ATTEMPTS && !isApproved; attempt++) {
                if (!currentUrl) break;

                console.log(`[Row ${row.id.slice(0,8)}] ${row.lesson_title?.slice(0,30) || 'N/A'} | ${row.component} | Intento ${attempt}`);

                // 2.1 VERIFICAR DISPONIBILIDAD DE URL (Evitar 404)
                const isAvailable = await checkUrlAvailability(currentUrl);
                if (!isAvailable) {
                    console.log(`[Row ${row.id.slice(0,8)}] ✗ URL inaccesible (404/Error): ${currentUrl}`);
                    
                    // Buscar alternativa inmediatamente
                    console.log(`[Row ${row.id.slice(0,8)}] Buscando alternativa...`);
                    const newUrl = await searchAlternativeUrl(genAI, SEARCH_MODEL, row, currentUrl);
                    
                    if (newUrl && newUrl !== currentUrl) {
                        currentUrl = newUrl;
                        continue; // Reintentar con nueva URL
                    } else {
                        notes = "Enlace roto - No se encontró alternativa";
                        break; // Falló y no hay alternativa
                    }
                }

                try {
                    const evaluation = await evaluateUrl(genAI, VALIDATION_MODEL, VALIDATION_FALLBACK, row, currentUrl);

                    if (evaluation?.is_approved) {
                        isApproved = true;
                        notes = `[${evaluation.average.toFixed(1)}/10] ${evaluation.feedback_notes}`;
                        console.log(`[Row ${row.id.slice(0,8)}] ✓ APROBADO (${evaluation.average.toFixed(1)})`);
                    } else if (evaluation) {
                        console.log(`[Row ${row.id.slice(0,8)}] ✗ Rechazado (${evaluation.average.toFixed(1)}), buscando alternativa...`);
                        const newUrl = await searchAlternativeUrl(genAI, SEARCH_MODEL, row, currentUrl);
                        if (newUrl && newUrl !== currentUrl) {
                            currentUrl = newUrl;
                        } else {
                            notes = `[${evaluation.average.toFixed(1)}/10] ${evaluation.feedback_notes} - Sin alternativa`;
                            break;
                        }
                    } else {
                        break;
                    }
                } catch (err) {
                    console.error(`[Row ${row.id.slice(0,8)}] Error:`, err);
                    break;
                }
            }

            return {
                id: row.id,
                apta: isApproved,
                cobertura_completa: isApproved,
                notes: notes || (isApproved ? 'Validación exitosa' : 'Requiere revisión manual'),
                last_checked_at: new Date().toISOString(),
                auto_evaluated: true,
                ...(currentUrl ? { source_ref: currentUrl } : {})
            };
        };

        // 8. PROCESAMIENTO EN PARALELO
        const updates: RowUpdate[] = [];
        const batchSize = PARALLEL_VALIDATIONS;

        console.log(`\n[Parallel] Procesando ${rows.length} rows en lotes de ${batchSize}...`);

        for (let i = 0; i < rows.length; i += batchSize) {
            // Verificar timeout (dejar 100s de margen)
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            if (elapsedSeconds > 800) {
                console.log(`[TIMEOUT] ${elapsedSeconds.toFixed(0)}s elapsed - Guardando progreso...`);
                break;
            }

            const batch = rows.slice(i, i + batchSize);
            console.log(`\n[Batch ${Math.floor(i/batchSize) + 1}] Procesando ${batch.length} rows en paralelo...`);

            // Ejecutar en paralelo
            const batchResults = await Promise.all(
                batch.map(row => processRow(row))
            );

            // Agregar resultados válidos
            for (const result of batchResults) {
                if (result) updates.push(result);
            }

            console.log(`[Batch ${Math.floor(i/batchSize) + 1}] Completado. Total procesados: ${updates.length}`);
        }

        // 9. Guardar todos los updates
        let successCount = 0;
        console.log(`\n[Update] Guardando ${updates.length} rows en BD...`);

        for (const update of updates) {
            const { id, ...updateFields } = update;
            const { error } = await supabase.from('curation_rows').update(updateFields).eq('id', id);
            if (error) {
                console.error(`[Update] Error en ${id}:`, error.message);
            } else {
                successCount++;
            }
        }

        // 10. Resumen final
        const approvedCount = updates.filter(u => u.apta).length;
        const rejectedCount = updates.filter(u => !u.apta).length;

        console.log(`\n[Validation] ═══════════════════════════════════════`);
        console.log(`[Validation] COMPLETADO`);
        console.log(`[Validation] - Procesados: ${successCount}/${updates.length}`);
        console.log(`[Validation] - Aprobados: ${approvedCount}`);
        console.log(`[Validation] - Rechazados: ${rejectedCount}`);
        console.log(`[Validation] - Componentes sin fuentes: ${missingComponents.length}`);
        console.log(`[Validation] - Tiempo total: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        console.log(`[Validation] ═══════════════════════════════════════`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                processed: successCount,
                approved: approvedCount,
                rejected: rejectedCount,
                missingComponents: missingComponents.length
            })
        };

    } catch (err: any) {
        console.error('Validation Error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};

// --- HELPERS ---

async function getCurationId(supabase: any, artifactId: string) {
    const { data } = await supabase.from('curation').select('id').eq('artifact_id', artifactId).single();
    return data?.id;
}

// Helper: Resolver URLs de redirect de Google Vertex AI Search
// Estas URLs son temporales y redirigen a la URL real del contenido
async function resolveGoogleRedirect(url: string): Promise<string | null> {
    if (!url.includes('vertexaisearch.cloud.google.com') &&
        !url.includes('grounding-api-redirect')) {
        return url; // No es un redirect de Google, devolver tal cual
    }

    try {
        console.log(`[Redirect] Resolving Google redirect...`);

        // Crear un AbortController para timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 segundos timeout

        // Hacer un GET request para seguir el redirect
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
            }
        });

        clearTimeout(timeoutId);

        // La URL final después de seguir redirects
        const finalUrl = response.url;

        // Verificar que la URL final no sea otro redirect de Google
        if (finalUrl && !finalUrl.includes('vertexaisearch.cloud.google.com') &&
            !finalUrl.includes('grounding-api-redirect')) {
            console.log(`[Redirect] ✓ Resolved to: ${finalUrl}`);
            return finalUrl;
        }

        // Si aún es un redirect de Google, intentar extraer la URL del HTML
        const html = await response.text();
        const urlMatch = html.match(/https?:\/\/(?!vertexaisearch)[^\s"'<>]+/);
        if (urlMatch && urlMatch[0]) {
            const extractedUrl = urlMatch[0].replace(/['">;,].*$/, ''); // Limpiar caracteres finales
            console.log(`[Redirect] ✓ Extracted from HTML: ${extractedUrl}`);
            return extractedUrl;
        }

        console.log(`[Redirect] ✗ Could not resolve redirect`);
        return null;

    } catch (e: any) {
        if (e.name === 'AbortError') {
            console.log(`[Redirect] ✗ Timeout resolving redirect`);
        } else {
            console.error(`[Redirect] Error:`, e.message);
        }
        return null;
    }
}

// Helper: Descargar y extraer contenido de una URL
async function fetchUrlContent(url: string): Promise<{ success: boolean; content: string; title: string; wordCount: number }> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
            }
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            return { success: false, content: '', title: '', wordCount: 0 };
        }

        const html = await response.text();

        // Extraer título
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : '';

        // Extraer contenido de texto (quitar HTML tags)
        let content = html
            // Quitar scripts y styles
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
            // Quitar navegación, header, footer
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            // Quitar comentarios HTML
            .replace(/<!--[\s\S]*?-->/g, '')
            // Quitar tags HTML
            .replace(/<[^>]+>/g, ' ')
            // Decodificar entidades HTML comunes
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            // Limpiar espacios múltiples
            .replace(/\s+/g, ' ')
            .trim();

        // Contar palabras
        const wordCount = content.split(/\s+/).filter(w => w.length > 2).length;

        // Limitar contenido a ~8000 caracteres para no exceder límites del modelo
        if (content.length > 8000) {
            content = content.substring(0, 8000) + '... [contenido truncado]';
        }

        console.log(`[FetchContent] ✓ ${url.substring(0, 50)}... - ${wordCount} palabras`);

        return { success: true, content, title, wordCount };

    } catch (e: any) {
        console.warn(`[FetchContent] Error: ${e.message}`);
        return { success: false, content: '', title: '', wordCount: 0 };
    }
}

// Helper: Verificar si la URL es accesible (Status 200-299)
async function checkUrlAvailability(url: string): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

        // Intentar primero con HEAD para ser eficiente
        const responseHead = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        clearTimeout(timeoutId);

        if (responseHead.ok) return true;

        // Si HEAD falla (405 Method Not Allowed, 403 Forbidden, o confuso), intentar GET
        // Muchos sitios bloquean HEAD o devuelven 404/403 falsos para bots
        console.log(`[CheckURL] HEAD failed (${responseHead.status}), trying GET for ${url}...`);

        const controllerGet = new AbortController();
        const timeoutIdGet = setTimeout(() => controllerGet.abort(), 10000); // 10s timeout
        const responseGet = await fetch(url, {
            method: 'GET',
            signal: controllerGet.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        clearTimeout(timeoutIdGet);

        return responseGet.ok;

    } catch (e: any) {
        console.warn(`[CheckURL] Error checking ${url}:`, e.message);
        return false;
    }
}

// Helper: Evaluate URL usando SDK nativo de Google (soporta gemini-3)
// AHORA DESCARGA EL CONTENIDO REAL DE LA PÁGINA ANTES DE EVALUAR
async function evaluateUrl(
    genAI: GoogleGenAI,
    modelName: string,
    fallbackModel: string,
    row: any,
    url: string
): Promise<ValidationResult | null> {
    // PASO 1: Descargar el contenido REAL de la página
    console.log(`[Evaluate] Descargando contenido de: ${url.substring(0, 60)}...`);
    const pageContent = await fetchUrlContent(url);

    // Si no se pudo descargar contenido, rechazar inmediatamente
    if (!pageContent.success) {
        console.log(`[Evaluate] ✗ No se pudo descargar contenido de la URL`);
        return {
            relevance: 1,
            depth: 1,
            quality: 1,
            applicability: 1,
            average: 1,
            feedback_notes: 'No se pudo acceder al contenido de la página',
            is_approved: false
        };
    }

    // Si el contenido es muy corto, rechazar (probablemente página de error o menú)
    if (pageContent.wordCount < 100) {
        console.log(`[Evaluate] ✗ Contenido insuficiente: solo ${pageContent.wordCount} palabras`);
        return {
            relevance: 2,
            depth: 1,
            quality: 2,
            applicability: 1,
            average: 1.5,
            feedback_notes: `Contenido insuficiente: solo ${pageContent.wordCount} palabras. Probablemente página de error, menú o contenido dinámico.`,
            is_approved: false
        };
    }

    console.log(`[Evaluate] ✓ Contenido descargado: ${pageContent.wordCount} palabras, título: "${pageContent.title?.substring(0, 50)}..."`);

    // PASO 2: Crear prompt con contenido real
    const prompt = getValidationPrompt(row, url, pageContent);

    // Intentar con modelo principal, luego fallback
    const modelsToTry = [modelName, fallbackModel];

    for (const model of modelsToTry) {
        try {
            console.log(`[Evaluate] Evaluando con modelo: ${model}`);

            const result = await genAI.models.generateContent({
                model: model,
                contents: prompt,
                config: {
                    temperature: 0.3,
                    responseMimeType: "application/json"
                }
            });

            const text = result.text || '';

            // Limpiar y parsear JSON
            const cleanJson = text
                .replace(/```json/g, '')
                .replace(/```/g, '')
                .trim();

            const parsed = JSON.parse(cleanJson) as ValidationResult;

            // Validar que tenga los campos necesarios
            if (typeof parsed.average === 'number' && typeof parsed.is_approved === 'boolean') {
                // Log detallado de la evaluación
                console.log(`[Evaluate] ✓ Model: ${model}`);
                console.log(`[Evaluate]   URL: ${url}`);
                console.log(`[Evaluate]   Página: "${pageContent.title}" (${pageContent.wordCount} palabras)`);
                console.log(`[Evaluate]   Scores: Relevancia=${parsed.relevance}, Profundidad=${parsed.depth}, Calidad=${parsed.quality}, Aplicabilidad=${parsed.applicability}`);
                console.log(`[Evaluate]   Promedio: ${parsed.average.toFixed(2)} | Aprobado: ${parsed.is_approved ? 'SÍ' : 'NO'}`);
                console.log(`[Evaluate]   Feedback: ${parsed.feedback_notes}`);
                return parsed;
            }

            console.warn(`[Evaluate] Invalid response structure from ${model}`);

        } catch (e: any) {
            console.error(`[Evaluate] Error with ${model}:`, e.message);
            // Continuar al siguiente modelo
        }
    }

    return null;
}

// Helper: Search Alternative URL usando Google Search grounding
async function searchAlternativeUrl(
    genAI: GoogleGenAI,
    modelName: string,
    row: any,
    excludeUrl?: string
): Promise<string | null> {
    try {
        const title = row.title || row.lesson_title || row.component || 'recurso educativo';
        const description = row.description || row.source_rationale || '';
        const type = row.type || row.component || 'artículo';

        const query = `Busca un excelente recurso educativo (artículo, tutorial, documentación o guía) para aprender sobre: "${title}".
Descripción del tema: ${description || 'No disponible'}.
Tipo de contenido preferido: ${type}.
${excludeUrl ? `Evitar este sitio: ${excludeUrl}` : ''}

Busca fuentes de calidad como: documentación oficial, universidades, sitios técnicos reconocidos, blogs especializados.
Evita: YouTube, redes sociales, Medium, sitios con paywall.

Responde con la URL más relevante que encuentres.`;

        const result = await genAI.models.generateContent({
            model: modelName,
            contents: query,
            config: {
                tools: [{ googleSearch: {} }],
                temperature: 0.3
            }
        });

        // Extraer URLs del grounding metadata (fuentes verificadas por Google)
        const grounding = result.candidates?.[0]?.groundingMetadata;
        const groundingUrls: string[] = [];

        if (grounding?.groundingChunks) {
            for (const chunk of grounding.groundingChunks) {
                if (chunk.web?.uri) {
                    let uri = chunk.web.uri;

                    // Si es un redirect de Google, intentar resolverlo
                    if (uri.includes('vertexaisearch.cloud.google.com') ||
                        uri.includes('grounding-api-redirect')) {
                        const resolved = await resolveGoogleRedirect(uri);
                        if (resolved) {
                            uri = resolved;
                        } else {
                            continue; // Saltar esta URL si no se puede resolver
                        }
                    }

                    // Filtrar la URL excluida
                    if (!excludeUrl || !uri.includes(excludeUrl)) {
                        groundingUrls.push(uri);
                    }
                }
            }
        }

        // Si hay URLs de grounding, devolver la primera
        if (groundingUrls.length > 0) {
            console.log(`[Search] Found ${groundingUrls.length} grounding URLs, returning: ${groundingUrls[0]}`);
            return groundingUrls[0];
        }

        // Fallback: intentar extraer URL del texto de respuesta
        const text = result.text || '';
        const urlMatch = text.match(/https?:\/\/(?!vertexaisearch)[^\s"'<>]+/);
        if (urlMatch) {
            console.log(`[Search] Extracted URL from text: ${urlMatch[0]}`);
            return urlMatch[0];
        }

        console.log('[Search] No URLs found in response');
        return null;

    } catch (e) {
        console.error("Search failed:", e);
        return null;
    }
}
