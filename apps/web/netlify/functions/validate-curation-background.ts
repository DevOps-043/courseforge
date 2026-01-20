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
    // Nuevos campos para validación estricta
    is_homepage_or_index?: boolean;
    is_specific_to_topic?: boolean;
    is_educational?: boolean;
    has_depth?: boolean;
    rejection_reasons?: string[];
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

// Umbrales de validación estrictos (unificados)
const MIN_WORDS_STRICT = 300;       // Mínimo 300 palabras de contenido útil
const MIN_PARAGRAPHS = 3;           // Mínimo 3 párrafos sustanciales
const HOMEPAGE_PATTERN_THRESHOLD = 2; // Si tiene 2+ patrones de homepage, rechazar

// Patrones para detectar páginas de inicio/índice
const HOMEPAGE_URL_PATTERNS = [
    /^https?:\/\/[^\/]+\/?$/,                    // Solo dominio: example.com/
    /^https?:\/\/[^\/]+\/index\.(html?|php|aspx?)$/i,  // index.html
    /^https?:\/\/[^\/]+\/(home|inicio|main)\/?$/i,     // /home o /inicio
    /^https?:\/\/[^\/]+\/(es|en|fr|de)\/?$/i,          // Solo idioma /es/
    /^https?:\/\/[^\/]+\/\?/,                          // Solo query params
];

const HOMEPAGE_CONTENT_PATTERNS = [
    /welcome to (our|the)|bienvenido(s)? a/i,
    /explore our|explora nuestro|descubre nuestro/i,
    /featured (articles|posts|products|courses)/i,
    /artículos destacados|productos destacados/i,
    /latest (news|posts|articles|updates)/i,
    /últimas (noticias|publicaciones|novedades)/i,
    /nuestros servicios|our services/i,
    /contact us|contáctanos|contacto/i,
    /about us|quiénes somos|sobre nosotros|acerca de/i,
    /subscribe to|suscríbete|únete a/i,
    /newsletter|boletín/i,
    /follow us|síguenos en/i,
    /all rights reserved|todos los derechos/i,
    /privacy policy|política de privacidad/i,
    /terms (of|and) (service|use)|términos (de uso|y condiciones)/i,
    /copyright \d{4}/i,
    /navegación|navigation|menú principal/i,
    /ver más|see more|read more|leer más/i,
    /categorías|categories/i,
    /etiquetas|tags/i,
    /archivos|archives/i,
    /buscar|search/i,
];

// Patrones de contenido genérico/marketing (no educativo)
const MARKETING_PATTERNS = [
    /compra ahora|buy now|shop now/i,
    /oferta especial|special offer|descuento/i,
    /precio|price|\$\d+|€\d+/i,
    /añadir al carrito|add to cart/i,
    /prueba gratis|free trial|trial gratuito/i,
    /solicita (una )?demo|request demo/i,
    /regístrate (ahora|gratis)|sign up (now|free)/i,
    /llámanos|call us|contacta con ventas/i,
    /nuestros clientes|our customers|testimonios/i,
    /empresa líder|leading company|somos líderes/i,
];

// Prompt Template ULTRA-ESTRICTO para validación semántica profunda
const getValidationPrompt = (component: any, url: string, pageContent: { title: string; content: string; wordCount: number }) => `
TAREA CRÍTICA: Determina si esta página web es una FUENTE EDUCATIVA ESPECÍFICA y SUSTANCIAL.

═══════════════════════════════════════════════════════════════════
COMPONENTE EDUCATIVO QUE NECESITAMOS CUBRIR:
═══════════════════════════════════════════════════════════════════
- Lección del curso: "${component.lesson_title || component.title || 'Sin título'}"
- Tipo de contenido requerido: ${component.component || component.type || 'Artículo educativo'}
- Descripción/Objetivo: ${component.source_rationale || component.description || 'Contenido educativo sobre el tema'}

═══════════════════════════════════════════════════════════════════
PÁGINA WEB A EVALUAR:
═══════════════════════════════════════════════════════════════════
- URL: ${url}
- Título de la página: ${pageContent.title || '[Sin título]'}
- Palabras extraídas: ${pageContent.wordCount}

=== CONTENIDO DE LA PÁGINA (primeras 3000 palabras) ===
${pageContent.content || '[ERROR: No se pudo extraer contenido]'}
=== FIN DEL CONTENIDO ===

═══════════════════════════════════════════════════════════════════
EVALUACIÓN ULTRA-ESTRICTA - DEBES VERIFICAR CADA PUNTO:
═══════════════════════════════════════════════════════════════════

PASO 1: ¿ES UNA PÁGINA DE INICIO, ÍNDICE O LANDING PAGE?
- ¿La página lista múltiples artículos/productos/servicios sin profundizar en ninguno?
- ¿El contenido principal son enlaces a otras páginas?
- ¿Es una página "Acerca de", "Inicio", "Servicios", "Productos"?
- ¿El contenido es mayormente navegación, menús, o categorías?
→ Si CUALQUIERA es SÍ: is_homepage_or_index = true, is_approved = false

PASO 2: ¿EL CONTENIDO ES ESPECÍFICO AL TEMA "${component.lesson_title || component.title}"?
- ¿El TEMA PRINCIPAL de la página es exactamente sobre "${component.lesson_title || component.title}"?
- ¿O solo MENCIONA el tema de pasada como parte de una lista?
- ¿La página está DEDICADA a explicar este tema específico?
- ¿Un estudiante buscando "${component.lesson_title || component.title}" encontraría lo que necesita?
→ Si el tema NO es el foco principal: is_specific_to_topic = false, is_approved = false

PASO 3: ¿ES CONTENIDO GENUINAMENTE EDUCATIVO?
- ¿Explica conceptos con claridad pedagógica?
- ¿Tiene ejemplos, código, diagramas, o pasos a seguir?
- ¿O es contenido de marketing disfrazado de educación?
- ¿Es un artículo de noticias sin valor de aprendizaje?
- ¿Solo promociona un producto/servicio?
→ Si NO es educativo real: is_educational = false, is_approved = false

PASO 4: ¿TIENE PROFUNDIDAD SUFICIENTE?
- ¿Tiene al menos 3-5 párrafos sustanciales sobre el tema?
- ¿Explica el "por qué" y el "cómo", no solo el "qué"?
- ¿Un principiante podría APRENDER el tema leyendo esta página?
- ¿Hay información que el estudiante no encontraría en una simple búsqueda?
→ Si es superficial: has_depth = false, is_approved = false

PASO 5: ANÁLISIS DE CONTRADICCIONES
- ¿Hay información que contradiga prácticas actuales aceptadas?
- ¿Hay afirmaciones que puedan confundir al estudiante?
- ¿La información está desactualizada?
→ Documentar en feedback_notes con prefijo [CONTRADICCIÓN] o [CONFLICTO]

═══════════════════════════════════════════════════════════════════
CRITERIOS DE PUNTUACIÓN (1-10):
═══════════════════════════════════════════════════════════════════
- relevance: ¿Qué tan relacionado está con "${component.lesson_title || component.title}"? (1=nada, 10=exacto)
- depth: ¿Qué tan profundo es el contenido? (1=superficial, 10=exhaustivo)
- quality: ¿Qué tan bien escrito y estructurado está? (1=pobre, 10=excelente)
- applicability: ¿Qué tan útil es para un estudiante? (1=inútil, 10=muy útil)

═══════════════════════════════════════════════════════════════════
REGLAS DE APROBACIÓN ESTRICTAS:
═══════════════════════════════════════════════════════════════════
RECHAZAR AUTOMÁTICAMENTE (is_approved: false) si:
✗ Es página de inicio, índice, landing page, o "about us"
✗ El tema principal NO es "${component.lesson_title || component.title}"
✗ Tiene menos de 300 palabras de contenido educativo real
✗ Es contenido de marketing, ventas, o promocional
✗ Solo lista enlaces sin contenido propio
✗ El promedio de puntuación es < 7.0
✗ Cualquier puntuación individual es ≤ 4

APROBAR (is_approved: true) SOLO si:
✓ La página está DEDICADA específicamente al tema
✓ Tiene contenido educativo sustancial (explicaciones, ejemplos)
✓ Un estudiante realmente APRENDERÍA el tema leyendo esto
✓ Todas las puntuaciones son ≥ 5 Y el promedio es ≥ 7.0

Responde ÚNICAMENTE con JSON válido (sin markdown):
{
  "is_homepage_or_index": <true si es página de inicio/índice/landing>,
  "is_specific_to_topic": <true si el tema principal es el correcto>,
  "is_educational": <true si es contenido educativo real>,
  "has_depth": <true si tiene profundidad suficiente>,
  "relevance": <1-10>,
  "depth": <1-10>,
  "quality": <1-10>,
  "applicability": <1-10>,
  "average": <promedio exacto de los 4 scores>,
  "rejection_reasons": ["razón1", "razón2"] o [] si aprobado,
  "feedback_notes": "<explicación detallada de por qué se aprueba o rechaza>",
  "is_approved": <true o false>
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
        // IMPORTANTE: Debe seguir buscando hasta encontrar una fuente válida
        const processRow = async (row: any): Promise<RowUpdate | null> => {
            let currentUrl = row.source_ref || row.url;
            let isApproved = false;
            let notes = "";
            const MAX_ATTEMPTS = 4; // Aumentado para dar más oportunidades
            const triedUrls = new Set<string>(); // Evitar URLs repetidas

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

            // Loop de validación - sigue buscando hasta encontrar una fuente válida
            for (let attempt = 1; attempt <= MAX_ATTEMPTS && !isApproved; attempt++) {
                if (!currentUrl) {
                    // Si no hay URL, buscar una nueva
                    console.log(`[Row ${row.id.slice(0,8)}] Sin URL, buscando...`);
                    currentUrl = await searchAlternativeUrl(genAI, SEARCH_MODEL, row);
                    if (!currentUrl) break;
                }

                // Evitar URLs ya probadas
                if (triedUrls.has(currentUrl)) {
                    console.log(`[Row ${row.id.slice(0,8)}] URL ya probada, buscando otra...`);
                    currentUrl = await searchAlternativeUrl(genAI, SEARCH_MODEL, row, currentUrl);
                    if (!currentUrl || triedUrls.has(currentUrl)) break;
                }
                triedUrls.add(currentUrl);

                console.log(`[Row ${row.id.slice(0,8)}] ${row.lesson_title?.slice(0,30) || 'N/A'} | ${row.component} | Intento ${attempt}`);

                // 2.1 VERIFICAR DISPONIBILIDAD DE URL (Evitar 404)
                const isAvailable = await checkUrlAvailability(currentUrl);
                if (!isAvailable) {
                    console.log(`[Row ${row.id.slice(0,8)}] ✗ URL inaccesible (404/Error): ${currentUrl}`);

                    // Buscar alternativa inmediatamente
                    console.log(`[Row ${row.id.slice(0,8)}] Buscando alternativa...`);
                    currentUrl = await searchAlternativeUrl(genAI, SEARCH_MODEL, row, currentUrl);
                    continue; // Reintentar con nueva URL (o null si no hay)
                }

                try {
                    const evaluation = await evaluateUrl(genAI, VALIDATION_MODEL, VALIDATION_FALLBACK, row, currentUrl);

                    if (evaluation?.is_approved) {
                        isApproved = true;
                        notes = `[${evaluation.average.toFixed(1)}/10] ${evaluation.feedback_notes}`;
                        console.log(`[Row ${row.id.slice(0,8)}] ✓ APROBADO (${evaluation.average.toFixed(1)})`);
                    } else if (evaluation) {
                        console.log(`[Row ${row.id.slice(0,8)}] ✗ Rechazado (${evaluation.average.toFixed(1)}), buscando alternativa...`);
                        notes = `[${evaluation.average.toFixed(1)}/10] ${evaluation.feedback_notes}`;
                        // Buscar alternativa para el siguiente intento
                        currentUrl = await searchAlternativeUrl(genAI, SEARCH_MODEL, row, currentUrl);
                        // Continuar al siguiente intento (no break)
                    } else {
                        // Error en evaluación, intentar con otra URL
                        currentUrl = await searchAlternativeUrl(genAI, SEARCH_MODEL, row, currentUrl);
                    }
                } catch (err) {
                    console.error(`[Row ${row.id.slice(0,8)}] Error:`, err);
                    // Intentar con otra URL en lugar de break
                    currentUrl = await searchAlternativeUrl(genAI, SEARCH_MODEL, row, currentUrl);
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

// VERIFICACIÓN ULTRA-ESTRICTA de URLs para validación
// Descarga contenido completo, detecta homepages, y valida rigurosamente
async function checkUrlAvailability(url: string): Promise<boolean> {
    try {
        // Validar formato de URL primero
        if (!url || !url.startsWith('http')) {
            console.log(`[CheckURL] ✗ URL inválida: ${url}`);
            return false;
        }

        // ═══════════════════════════════════════════════════════════════
        // PASO 1: Verificar si la URL es una página de inicio por patrón
        // ═══════════════════════════════════════════════════════════════
        for (const pattern of HOMEPAGE_URL_PATTERNS) {
            if (pattern.test(url)) {
                console.log(`[CheckURL] ✗ URL es página de inicio (patrón URL): ${url}`);
                return false;
            }
        }

        // Rechazar URLs que claramente no son contenido educativo
        const blockedPatterns = [
            /youtube\.com/i,
            /youtu\.be/i,
            /facebook\.com/i,
            /twitter\.com/i,
            /x\.com/i,
            /instagram\.com/i,
            /tiktok\.com/i,
            /linkedin\.com\/posts/i,
            /reddit\.com/i,
            /pinterest\.com/i,
            /google\.com\/search/i,
            /google\.com\/sorry/i,
            /vertexaisearch\.cloud\.google\.com/i,
            /medium\.com\/@[^\/]+\/?$/i,  // Perfil de Medium, no artículo
            /github\.com\/[^\/]+\/?$/i,   // Perfil de GitHub, no repo específico
        ];

        for (const pattern of blockedPatterns) {
            if (pattern.test(url)) {
                console.log(`[CheckURL] ✗ URL bloqueada (${pattern.source}): ${url}`);
                return false;
            }
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

        const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache'
            }
        });
        clearTimeout(timeoutId);

        // Verificar HTTP status
        if (!response.ok) {
            console.log(`[CheckURL] ✗ HTTP ${response.status} para ${url}`);
            return false;
        }

        // Verificar que sea HTML
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
            console.log(`[CheckURL] ✗ No es HTML (${contentType}): ${url}`);
            return false;
        }

        // Verificar URL final (después de redirects)
        const finalUrl = response.url;
        if (finalUrl.includes('vertexaisearch.cloud.google.com') || finalUrl.includes('google.com/sorry')) {
            console.log(`[CheckURL] ✗ Redirect a Google no resuelto: ${url}`);
            return false;
        }

        // Verificar si la URL final es una página de inicio
        for (const pattern of HOMEPAGE_URL_PATTERNS) {
            if (pattern.test(finalUrl)) {
                console.log(`[CheckURL] ✗ URL final es página de inicio: ${finalUrl}`);
                return false;
            }
        }

        const html = await response.text();

        // Si el HTML es muy corto, rechazar
        if (html.length < 2000) {
            console.log(`[CheckURL] ✗ HTML muy corto (${html.length} chars): ${url}`);
            return false;
        }

        // ═══════════════════════════════════════════════════════════════
        // PASO 2: Detección de SOFT 404 - Patrones en título
        // ═══════════════════════════════════════════════════════════════
        const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        const titleText = titleMatch ? titleMatch[1].toLowerCase().trim() : '';

        const titleErrorPatterns = [
            /^404$/,
            /404\s*(error|page|página)?/i,
            /not\s*found/i,
            /no\s*encontrad[ao]/i,
            /página\s*no\s*(existe|encontrada)/i,
            /page\s*not\s*found/i,
            /error\s*404/i,
            /página\s*eliminada/i,
            /contenido\s*no\s*disponible/i,
            /access\s*denied/i,
            /forbidden/i,
            /no\s*existe/i,
            /removed/i,
            /deleted/i,
        ];

        for (const pattern of titleErrorPatterns) {
            if (pattern.test(titleText)) {
                console.log(`[CheckURL] ✗ Soft 404 (título: "${titleText.substring(0, 40)}"): ${url}`);
                return false;
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // PASO 3: Detección de SOFT 404 - Patrones en HTML
        // ═══════════════════════════════════════════════════════════════
        const soft404HtmlPatterns = [
            /<h1[^>]*>\s*404\s*<\/h1>/i,
            /<h1[^>]*>[^<]*not\s*found[^<]*<\/h1>/i,
            /<h1[^>]*>[^<]*no\s*encontrad[ao][^<]*<\/h1>/i,
            /<h1[^>]*>[^<]*página\s*no\s*existe[^<]*<\/h1>/i,
            /<h2[^>]*>\s*404\s*<\/h2>/i,
            /class\s*=\s*["'][^"']*(?:error-?404|not-?found|error-?page)[^"']*["']/i,
            /id\s*=\s*["'][^"']*(?:error-?404|not-?found|error-?page)[^"']*["']/i,
            />\s*404\s*</,
            />\s*page\s*not\s*found\s*</i,
            />\s*página\s*no\s*encontrada\s*</i,
            />\s*this\s*page\s*(doesn't|does\s*not|can't|cannot)\s*exist/i,
            />\s*esta\s*página\s*no\s*existe\s*</i,
            />\s*oops!?\s*</i,
            /lo\s*sentimos[^<]{0,50}(página|contenido|artículo)[^<]{0,50}(no|ya\s*no)\s*(existe|está\s*disponible)/i,
            /sorry[^<]{0,50}(page|content)[^<]{0,50}(doesn't|does\s*not|no\s*longer)\s*exist/i,
            /the\s*page\s*you('re|\s*are)\s*looking\s*for/i,
            /la\s*página\s*que\s*buscas/i,
        ];

        for (const pattern of soft404HtmlPatterns) {
            if (pattern.test(html)) {
                console.log(`[CheckURL] ✗ Soft 404 (HTML pattern): ${url}`);
                return false;
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // PASO 4: Extraer contenido principal (más agresivo)
        // ═══════════════════════════════════════════════════════════════
        let content = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
            .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
            .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '')
            .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&\w+;/g, ' ')
            .replace(/&#\d+;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const contentLower = content.toLowerCase();

        // ═══════════════════════════════════════════════════════════════
        // PASO 5: Detección de PÁGINA DE INICIO por contenido
        // ═══════════════════════════════════════════════════════════════
        let homepageScore = 0;
        for (const pattern of HOMEPAGE_CONTENT_PATTERNS) {
            if (pattern.test(contentLower)) {
                homepageScore++;
            }
        }

        // Si tiene 2+ indicadores de homepage, rechazar
        if (homepageScore >= HOMEPAGE_PATTERN_THRESHOLD) {
            console.log(`[CheckURL] ✗ Parece página de inicio (${homepageScore} indicadores): ${url}`);
            return false;
        }

        // ═══════════════════════════════════════════════════════════════
        // PASO 6: Detección de contenido de MARKETING
        // ═══════════════════════════════════════════════════════════════
        let marketingScore = 0;
        for (const pattern of MARKETING_PATTERNS) {
            if (pattern.test(contentLower)) {
                marketingScore++;
            }
        }

        // Si tiene 3+ indicadores de marketing, rechazar
        if (marketingScore >= 3) {
            console.log(`[CheckURL] ✗ Contenido de marketing (${marketingScore} indicadores): ${url}`);
            return false;
        }

        // ═══════════════════════════════════════════════════════════════
        // PASO 7: Contar palabras y validar cantidad
        // ═══════════════════════════════════════════════════════════════
        const words = content.split(/\s+/).filter(w => w.length > 2 && /[a-záéíóúñü]/i.test(w));
        const wordCount = words.length;

        // VALIDACIÓN ULTRA-ESTRICTA - Mínimo 300 palabras de contenido útil
        if (wordCount < MIN_WORDS_STRICT) {
            console.log(`[CheckURL] ✗ Contenido insuficiente (${wordCount} palabras, mínimo ${MIN_WORDS_STRICT}): ${url}`);
            return false;
        }

        // ═══════════════════════════════════════════════════════════════
        // PASO 8: Verificar estructura de párrafos
        // ═══════════════════════════════════════════════════════════════
        // Contar párrafos reales (texto con más de 50 caracteres entre <p> tags)
        const paragraphs = html.match(/<p[^>]*>[^<]{50,}/gi) || [];
        if (paragraphs.length < MIN_PARAGRAPHS) {
            console.log(`[CheckURL] ✗ Pocos párrafos (${paragraphs.length}, mínimo ${MIN_PARAGRAPHS}): ${url}`);
            return false;
        }

        // ═══════════════════════════════════════════════════════════════
        // PASO 9: Verificar patrones de error en contenido
        // ═══════════════════════════════════════════════════════════════
        if (wordCount < 500) {
            const errorInContentPatterns = [
                /404/,
                /page\s*not\s*found/i,
                /página\s*no\s*encontrada/i,
                /no\s*encontramos/i,
                /no\s*pudimos\s*encontrar/i,
                /this\s*page\s*(doesn't|does\s*not)\s*exist/i,
                /esta\s*página\s*no\s*existe/i,
                /el\s*contenido\s*(no\s*está\s*disponible|fue\s*eliminado|ya\s*no\s*existe)/i,
                /access\s*denied/i,
                /permission\s*denied/i,
            ];

            for (const pattern of errorInContentPatterns) {
                if (pattern.test(contentLower)) {
                    console.log(`[CheckURL] ✗ Soft 404 (error en texto): ${url}`);
                    return false;
                }
            }
        }

        console.log(`[CheckURL] ✓ URL válida (${wordCount} palabras, ${paragraphs.length} párrafos): ${url.substring(0, 60)}...`);
        return true;

    } catch (e: any) {
        console.warn(`[CheckURL] ✗ Error: ${e.message} para ${url}`);
        return false;
    }
}

// Helper: Evaluate URL usando SDK nativo de Google (soporta gemini-3)
// AHORA CON PRE-FILTROS ESTRICTOS ANTES DE LLAMAR A LA IA
async function evaluateUrl(
    genAI: GoogleGenAI,
    modelName: string,
    fallbackModel: string,
    row: any,
    url: string
): Promise<ValidationResult | null> {
    // ═══════════════════════════════════════════════════════════════
    // PRE-FILTRO 1: Descargar el contenido REAL de la página
    // ═══════════════════════════════════════════════════════════════
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
            is_approved: false,
            is_homepage_or_index: false,
            is_specific_to_topic: false,
            is_educational: false,
            has_depth: false,
            rejection_reasons: ['No se pudo descargar contenido']
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // PRE-FILTRO 2: Verificar cantidad mínima de contenido (300 palabras)
    // ═══════════════════════════════════════════════════════════════
    if (pageContent.wordCount < MIN_WORDS_STRICT) {
        console.log(`[Evaluate] ✗ Contenido insuficiente: ${pageContent.wordCount} palabras (mínimo ${MIN_WORDS_STRICT})`);
        return {
            relevance: 2,
            depth: 1,
            quality: 2,
            applicability: 1,
            average: 1.5,
            feedback_notes: `Contenido insuficiente: ${pageContent.wordCount} palabras (mínimo requerido: ${MIN_WORDS_STRICT}). Probablemente página de error, menú o contenido dinámico.`,
            is_approved: false,
            is_homepage_or_index: false,
            is_specific_to_topic: false,
            is_educational: false,
            has_depth: false,
            rejection_reasons: [`Solo ${pageContent.wordCount} palabras (mínimo ${MIN_WORDS_STRICT})`]
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // PRE-FILTRO 3: Detectar páginas de inicio por contenido
    // ═══════════════════════════════════════════════════════════════
    const contentLower = pageContent.content.toLowerCase();
    let homepageIndicators = 0;
    const foundHomepagePatterns: string[] = [];

    for (const pattern of HOMEPAGE_CONTENT_PATTERNS) {
        if (pattern.test(contentLower)) {
            homepageIndicators++;
            foundHomepagePatterns.push(pattern.source.substring(0, 30));
        }
    }

    if (homepageIndicators >= HOMEPAGE_PATTERN_THRESHOLD) {
        console.log(`[Evaluate] ✗ Detectada página de inicio (${homepageIndicators} indicadores): ${foundHomepagePatterns.join(', ')}`);
        return {
            relevance: 2,
            depth: 1,
            quality: 3,
            applicability: 1,
            average: 1.75,
            feedback_notes: `Página de inicio/índice detectada. Indicadores: ${foundHomepagePatterns.slice(0, 3).join(', ')}. No es contenido específico.`,
            is_approved: false,
            is_homepage_or_index: true,
            is_specific_to_topic: false,
            is_educational: false,
            has_depth: false,
            rejection_reasons: ['Página de inicio o índice', ...foundHomepagePatterns.slice(0, 3)]
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // PRE-FILTRO 4: Detectar contenido de marketing
    // ═══════════════════════════════════════════════════════════════
    let marketingIndicators = 0;
    const foundMarketingPatterns: string[] = [];

    for (const pattern of MARKETING_PATTERNS) {
        if (pattern.test(contentLower)) {
            marketingIndicators++;
            foundMarketingPatterns.push(pattern.source.substring(0, 30));
        }
    }

    if (marketingIndicators >= 3) {
        console.log(`[Evaluate] ✗ Contenido de marketing detectado (${marketingIndicators} indicadores)`);
        return {
            relevance: 3,
            depth: 2,
            quality: 3,
            applicability: 2,
            average: 2.5,
            feedback_notes: `Contenido promocional/marketing detectado. Indicadores: ${foundMarketingPatterns.slice(0, 3).join(', ')}. No es contenido educativo.`,
            is_approved: false,
            is_homepage_or_index: false,
            is_specific_to_topic: false,
            is_educational: false,
            has_depth: false,
            rejection_reasons: ['Contenido de marketing', ...foundMarketingPatterns.slice(0, 3)]
        };
    }

    console.log(`[Evaluate] ✓ Pre-filtros OK: ${pageContent.wordCount} palabras, título: "${pageContent.title?.substring(0, 50)}..."`);

    // ═══════════════════════════════════════════════════════════════
    // PASO 5: Crear prompt con contenido real (aumentar a 3000 palabras)
    // ═══════════════════════════════════════════════════════════════
    // Aumentar contenido enviado a la IA para mejor evaluación
    const extendedContent = {
        ...pageContent,
        content: pageContent.content.substring(0, 12000) // Más contenido para mejor análisis
    };
    const prompt = getValidationPrompt(row, url, extendedContent);

    // Intentar con modelo principal, luego fallback
    const modelsToTry = [modelName, fallbackModel];

    for (const model of modelsToTry) {
        try {
            console.log(`[Evaluate] Evaluando con modelo: ${model}`);

            const result = await genAI.models.generateContent({
                model: model,
                contents: prompt,
                config: {
                    temperature: 0.2, // Más determinístico para evaluación estricta
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
                // ═══════════════════════════════════════════════════════════════
                // POST-FILTRO: Validación adicional de los resultados de la IA
                // ═══════════════════════════════════════════════════════════════

                // Si la IA dice que es homepage pero lo aprobó, rechazar
                if (parsed.is_homepage_or_index && parsed.is_approved) {
                    console.log(`[Evaluate] ✗ IA detectó homepage pero aprobó - corrigiendo a rechazado`);
                    parsed.is_approved = false;
                    parsed.rejection_reasons = parsed.rejection_reasons || [];
                    parsed.rejection_reasons.push('Es página de inicio/índice');
                }

                // Si no es específico al tema pero lo aprobó, rechazar
                if (parsed.is_specific_to_topic === false && parsed.is_approved) {
                    console.log(`[Evaluate] ✗ IA dice que no es específico pero aprobó - corrigiendo a rechazado`);
                    parsed.is_approved = false;
                    parsed.rejection_reasons = parsed.rejection_reasons || [];
                    parsed.rejection_reasons.push('No es específico al tema');
                }

                // Si no es educativo pero lo aprobó, rechazar
                if (parsed.is_educational === false && parsed.is_approved) {
                    console.log(`[Evaluate] ✗ IA dice que no es educativo pero aprobó - corrigiendo a rechazado`);
                    parsed.is_approved = false;
                    parsed.rejection_reasons = parsed.rejection_reasons || [];
                    parsed.rejection_reasons.push('No es contenido educativo');
                }

                // Si no tiene profundidad pero lo aprobó, rechazar
                if (parsed.has_depth === false && parsed.is_approved) {
                    console.log(`[Evaluate] ✗ IA dice que no tiene profundidad pero aprobó - corrigiendo a rechazado`);
                    parsed.is_approved = false;
                    parsed.rejection_reasons = parsed.rejection_reasons || [];
                    parsed.rejection_reasons.push('Contenido superficial');
                }

                // Validar que el promedio sea >= 7.0 para aprobar
                if (parsed.average < 7.0 && parsed.is_approved) {
                    console.log(`[Evaluate] ✗ Promedio ${parsed.average} < 7.0 pero aprobó - corrigiendo a rechazado`);
                    parsed.is_approved = false;
                    parsed.rejection_reasons = parsed.rejection_reasons || [];
                    parsed.rejection_reasons.push(`Promedio ${parsed.average.toFixed(1)} < 7.0`);
                }

                // Validar que ninguna puntuación sea <= 4 para aprobar
                const minScore = Math.min(parsed.relevance, parsed.depth, parsed.quality, parsed.applicability);
                if (minScore <= 4 && parsed.is_approved) {
                    console.log(`[Evaluate] ✗ Puntuación mínima ${minScore} <= 4 pero aprobó - corrigiendo a rechazado`);
                    parsed.is_approved = false;
                    parsed.rejection_reasons = parsed.rejection_reasons || [];
                    parsed.rejection_reasons.push(`Puntuación mínima ${minScore} <= 4`);
                }

                // Log detallado de la evaluación
                console.log(`[Evaluate] ═══════════════════════════════════════`);
                console.log(`[Evaluate] Modelo: ${model}`);
                console.log(`[Evaluate] URL: ${url}`);
                console.log(`[Evaluate] Página: "${pageContent.title}" (${pageContent.wordCount} palabras)`);
                console.log(`[Evaluate] ¿Homepage?: ${parsed.is_homepage_or_index ? 'SÍ' : 'NO'}`);
                console.log(`[Evaluate] ¿Específico al tema?: ${parsed.is_specific_to_topic ? 'SÍ' : 'NO'}`);
                console.log(`[Evaluate] ¿Educativo?: ${parsed.is_educational ? 'SÍ' : 'NO'}`);
                console.log(`[Evaluate] ¿Tiene profundidad?: ${parsed.has_depth ? 'SÍ' : 'NO'}`);
                console.log(`[Evaluate] Scores: R=${parsed.relevance}, D=${parsed.depth}, Q=${parsed.quality}, A=${parsed.applicability}`);
                console.log(`[Evaluate] Promedio: ${parsed.average.toFixed(2)} | RESULTADO: ${parsed.is_approved ? '✓ APROBADO' : '✗ RECHAZADO'}`);
                if (parsed.rejection_reasons && parsed.rejection_reasons.length > 0) {
                    console.log(`[Evaluate] Razones rechazo: ${parsed.rejection_reasons.join(', ')}`);
                }
                console.log(`[Evaluate] Feedback: ${parsed.feedback_notes?.substring(0, 150)}...`);
                console.log(`[Evaluate] ═══════════════════════════════════════`);

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
// MEJORADO: Queries más específicos para encontrar ARTÍCULOS educativos, no páginas de inicio
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

        // Extraer dominio de URL excluida para evitar el mismo sitio
        let excludeDomain = '';
        if (excludeUrl) {
            try {
                excludeDomain = new URL(excludeUrl).hostname.replace('www.', '');
            } catch { }
        }

        // Query MUCHO más específico para encontrar artículos educativos
        const query = `Encuentra un ARTÍCULO o TUTORIAL ESPECÍFICO (no página de inicio) que explique en detalle: "${title}"

REQUISITOS DEL ARTÍCULO:
- Debe ser un artículo ESPECÍFICO que enseñe "${title}", NO una página de inicio
- Debe tener explicaciones detalladas, ejemplos, o código si aplica
- La URL debe apuntar a un artículo específico (con /blog/, /article/, /tutorial/, /guide/, /docs/ en la URL)
- Preferir: documentación oficial, tutoriales de sitios reconocidos (.edu, developer.*, docs.*, learn.*)

EVITAR COMPLETAMENTE:
- Páginas de inicio de sitios (URLs que terminen solo en .com/ .org/ .io/)
- YouTube, redes sociales, Medium, Reddit
- Páginas de categorías o índices
- Resultados de búsqueda
${excludeDomain ? `- Cualquier página de ${excludeDomain}` : ''}

Descripción del tema: ${description || title}
Tipo de contenido: ${type === 'ARTÍCULO' ? 'Artículo técnico o tutorial' : type}

IMPORTANTE: Solo devuelve URLs que sean artículos específicos, NO páginas de inicio.`;

        console.log(`[Search] Buscando artículo específico para: "${title.substring(0, 50)}..."`);

        const result = await genAI.models.generateContent({
            model: modelName,
            contents: query,
            config: {
                tools: [{ googleSearch: {} }],
                temperature: 0.2 // Más determinístico
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

                    // ═══════════════════════════════════════════════════════════════
                    // FILTRO: Rechazar URLs que parecen páginas de inicio
                    // ═══════════════════════════════════════════════════════════════

                    // Verificar si es página de inicio por patrón de URL
                    let isHomepage = false;
                    for (const pattern of HOMEPAGE_URL_PATTERNS) {
                        if (pattern.test(uri)) {
                            isHomepage = true;
                            break;
                        }
                    }

                    if (isHomepage) {
                        console.log(`[Search] ✗ Descartando homepage: ${uri}`);
                        continue;
                    }

                    // Filtrar la URL/dominio excluido
                    if (excludeDomain && uri.includes(excludeDomain)) {
                        console.log(`[Search] ✗ Descartando dominio excluido: ${uri}`);
                        continue;
                    }

                    if (excludeUrl && uri === excludeUrl) {
                        continue;
                    }

                    // Preferir URLs que parezcan artículos específicos
                    const articleIndicators = [
                        /\/blog\//i,
                        /\/article/i,
                        /\/tutorial/i,
                        /\/guide/i,
                        /\/docs\//i,
                        /\/learn\//i,
                        /\/post\//i,
                        /\/how-to/i,
                        /\/what-is/i,
                        /\/introduction/i,
                        /\/getting-started/i,
                        /\d{4}\/\d{2}\//,  // Fecha en URL (típico de blogs)
                        /\.html$/i,
                        /\/p\//i,  // Típico de plataformas de blogs
                    ];

                    let hasArticleIndicator = articleIndicators.some(p => p.test(uri));

                    // Si tiene indicador de artículo, priorizarlo
                    if (hasArticleIndicator) {
                        console.log(`[Search] ✓ URL parece artículo específico: ${uri.substring(0, 70)}...`);
                        groundingUrls.unshift(uri); // Agregar al principio
                    } else {
                        groundingUrls.push(uri); // Agregar al final
                    }
                }
            }
        }

        // Si hay URLs de grounding, devolver la mejor (primera después de ordenar)
        if (groundingUrls.length > 0) {
            console.log(`[Search] ✓ Encontradas ${groundingUrls.length} URLs, seleccionando: ${groundingUrls[0].substring(0, 70)}...`);
            return groundingUrls[0];
        }

        // Fallback: intentar extraer URL del texto de respuesta
        const text = result.text || '';
        const urlMatches = text.match(/https?:\/\/(?!vertexaisearch)[^\s"'<>]+/g) || [];

        for (const urlMatch of urlMatches) {
            // Verificar que no sea homepage
            let isHomepage = HOMEPAGE_URL_PATTERNS.some(p => p.test(urlMatch));
            if (!isHomepage && (!excludeDomain || !urlMatch.includes(excludeDomain))) {
                console.log(`[Search] ✓ URL extraída del texto: ${urlMatch.substring(0, 70)}...`);
                return urlMatch;
            }
        }

        console.log('[Search] ✗ No se encontraron URLs válidas');
        return null;

    } catch (e) {
        console.error("[Search] Error en búsqueda:", e);
        return null;
    }
}
