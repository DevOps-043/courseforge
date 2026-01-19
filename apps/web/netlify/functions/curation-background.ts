import { Handler } from '@netlify/functions';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURACIÓN ---
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// --- INTERFACES ---
interface RequiredComponent {
  lesson_id: string;
  lesson_title: string;
  component: string;
  is_critical: boolean;
}

interface CurationPayload {
  curationId: string;
  artifactId: string;
  components: RequiredComponent[];
  courseName: string;
  ideaCentral: string;
  accessToken: string;
  attemptNumber?: number;
  gaps?: string[];
}

interface GroundingUrl {
  uri: string;
  title: string;
}

interface ProcessBatchResult {
  success: boolean;
  rowsInserted: number;
  failedComponents: RequiredComponent[];
}

interface CurationSettings {
  model_name: string;
  fallback_model: string;
  temperature: number;
  thinking_level: number;
}

export const handler: Handler = async (event) => {
  // 1. Validar Método
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 2. Validar Configuración
  if (!GOOGLE_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[BG-CURATION] Falta configuración de entorno');
    return { statusCode: 500, body: 'Missing env configuration' };
  }

  try {
    const payload = JSON.parse(event.body || '{}') as CurationPayload;
    const { curationId, components, courseName, ideaCentral, accessToken } = payload;

    if (!curationId || !components || components.length === 0) {
      return { statusCode: 400, body: 'Missing required payload data' };
    }

    console.log(`[BG-CURATION] Iniciando para CurationID: ${curationId} (${components.length} componentes)`);

    // 3. Inicializar clientes
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } }
    });

    const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

    // 4. Obtener System Prompt desde DB
    const { data: promptRecord } = await supabase
      .from('system_prompts')
      .select('content')
      .eq('code', 'CURATION_PLAN')
      .single();

    const systemInstruction = promptRecord?.content ||
      'Eres un curador de contenido educativo. Usa Google Search para encontrar fuentes reales y verificables.';

    console.log(`[BG-CURATION] System Prompt: ${systemInstruction.length} chars`);

    // 5. Obtener configuración de modelos desde curation_settings
    const { data: settingsRecord } = await supabase
      .from('curation_settings')
      .select('model_name, fallback_model, temperature, thinking_level')
      .eq('id', 1)
      .single();

    const settings: CurationSettings = {
      model_name: settingsRecord?.model_name || 'gemini-2.0-flash',
      fallback_model: settingsRecord?.fallback_model || 'gemini-2.0-flash',
      temperature: Number(settingsRecord?.temperature) || 0.7,
      thinking_level: settingsRecord?.thinking_level || 0
    };

    console.log(`[BG-CURATION] Settings: modelo=${settings.model_name}, fallback=${settings.fallback_model}, temp=${settings.temperature}`);

    // --- HELPERS ---
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Resolver redirects de Google para obtener URL real
    const resolveGoogleRedirect = async (url: string): Promise<string> => {
      // Si no es un redirect de Google, devolver como está
      if (!url.includes('vertexaisearch.cloud.google.com') && !url.includes('grounding-api-redirect')) {
        return url;
      }

      try {
        // Seguir redirects manualmente para obtener URL final
        const response = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        // La URL final después de seguir redirects
        const finalUrl = response.url;

        // Verificar que no siga siendo una URL de Google
        if (finalUrl && !finalUrl.includes('vertexaisearch.cloud.google.com') && !finalUrl.includes('google.com/sorry')) {
          console.log(`[BG-CURATION] Redirect resuelto: ${url.substring(0, 50)}... -> ${finalUrl}`);
          return finalUrl;
        }

        return url; // Devolver original si no se pudo resolver
      } catch (err) {
        console.warn(`[BG-CURATION] Error resolviendo redirect: ${err}`);
        return url;
      }
    };

    // Verificar si una URL es accesible Y tiene contenido mínimo
    // - Verifica HTTP 200 (no 404)
    // - Verifica que tenga al menos 50 palabras (no página vacía/menú)
    // La validación de CALIDAD se hace en el paso 2
    const verifyUrlExists = async (url: string): Promise<{ valid: boolean; wordCount?: number; error?: string }> => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });
        clearTimeout(timeoutId);

        // Verificar HTTP status
        if (!response.ok) {
          return { valid: false, error: `HTTP ${response.status}` };
        }

        const html = await response.text();

        // Extraer contenido de texto básico (quitar HTML)
        const content = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
          .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
          .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        // Contar palabras (mínimo 3 caracteres)
        const wordCount = content.split(/\s+/).filter(w => w.length > 2).length;

        // Verificar contenido mínimo (50 palabras - menos estricto que paso 2)
        if (wordCount < 50) {
          return { valid: false, wordCount, error: `Solo ${wordCount} palabras (mínimo 50)` };
        }

        return { valid: true, wordCount };

      } catch (e: any) {
        return { valid: false, error: e.message || 'Error de conexión' };
      }
    };

    // Normalizar hostname para comparación (quitar www., convertir a minúsculas)
    const normalizeHost = (url: string): string => {
      try {
        const host = new URL(url).hostname.toLowerCase();
        return host.replace(/^www\./, '');
      } catch {
        return url.toLowerCase();
      }
    };

    // Normalizar URL para comparación más flexible
    const normalizeUrl = (url: string): string => {
      try {
        const parsed = new URL(url);
        // Normalizar: quitar www, lowercase, quitar trailing slash, normalizar guiones/espacios
        let normalized = parsed.hostname.toLowerCase().replace(/^www\./, '');
        let path = parsed.pathname.toLowerCase().replace(/\/$/, '').replace(/-/g, '').replace(/_/g, '');
        return normalized + path;
      } catch {
        return url.toLowerCase().replace(/-/g, '').replace(/_/g, '');
      }
    };

    // Limpiar JSON de caracteres problemáticos
    const cleanJsonResponse = (text: string): string => {
      let clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const jsonStart = clean.indexOf('{');
      const jsonEnd = clean.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        clean = clean.substring(jsonStart, jsonEnd + 1);
      }
      // Limpiar caracteres de control ASCII
      return clean
        .replace(/[\x00-\x1F\x7F]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']');
    };

    // Construir prompt para un batch
    const buildPrompt = (batch: RequiredComponent[], isRetry: boolean = false): string => {
      const lessonsText = batch.map(c =>
        `- ${c.lesson_title} (ID: ${c.lesson_id}) -> ${c.component}${c.is_critical ? ' [CRITICO]' : ''}`
      ).join('\n');

      return `
BUSCA fuentes educativas usando Google Search para este curso:

CURSO: ${courseName}
TEMA: ${ideaCentral}

COMPONENTES:
${lessonsText}

${isRetry ? '⚠️ REINTENTO: Asegúrate de BUSCAR en Google para cada componente. NO inventes URLs.' : ''}

INSTRUCCIONES:
1. DEBES usar Google Search para cada componente
2. Busca: artículos, guías, casos de estudio de universidades, consultoras, instituciones
3. NO inventes URLs - solo usa las que encuentres en Google
4. Evita: YouTube, redes sociales, Medium, sitios con paywall

RESPONDE en JSON:
{
  "sources_by_lesson": [
    {
      "lesson_id": "ID",
      "lesson_title": "TITULO",
      "components": [
        {
          "component_name": "TIPO",
          "is_critical": true/false,
          "candidate_sources": [
            {
              "title": "Título",
              "url": "URL de Google Search",
              "rationale": "Por qué es útil"
            }
          ]
        }
      ]
    }
  ]
}

Solo JSON válido, sin explicaciones.`;
    };

    // Procesar un batch con reintentos
    const processBatch = async (
      batch: RequiredComponent[],
      batchNum: number,
      totalBatches: number,
      isRecoveryRound: boolean = false
    ): Promise<ProcessBatchResult> => {
      const roundLabel = isRecoveryRound ? '[RECUPERACIÓN]' : '';
      console.log(`[BG-CURATION] ${roundLabel} Procesando lote ${batchNum}/${totalBatches}...`);

      // Construir intentos usando configuración de BD con regla -0.4 para reintentos
      const baseTemp = settings.temperature;
      const retryTemp = Math.max(0.1, baseTemp - 0.4); // Resta 0.4, mínimo 0.1

      const modelsToTry = [
        { name: settings.model_name, temp: baseTemp },
        { name: settings.model_name, temp: retryTemp },  // Reintento con temp -0.4
        { name: settings.fallback_model, temp: baseTemp },
        { name: settings.fallback_model, temp: retryTemp }  // Reintento fallback con temp -0.4
      ];

      let groundingUrls: GroundingUrl[] = [];
      let parsedResponse: any = null;
      let successModel = '';

      for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
        const modelConfig = modelsToTry[attempt];
        const isRetry = attempt > 0;

        try {
          console.log(`[BG-CURATION] Intento ${attempt + 1}/4: ${modelConfig.name} (temp=${modelConfig.temp})`);

          const fullPrompt = `### SISTEMA ###\n${systemInstruction}\n\n### TAREA ###\n${buildPrompt(batch, isRetry)}`;

          const result = await ai.models.generateContent({
            model: modelConfig.name,
            contents: fullPrompt,
            config: {
              tools: [{ googleSearch: {} }],
              temperature: modelConfig.temp
            }
          });

          const responseText = result.text || '';
          const grounding = result.candidates?.[0]?.groundingMetadata;

          // Extraer URLs de grounding (verificadas por Google)
          // IMPORTANTE: Resolvemos redirects Y verificamos que tengan contenido válido
          groundingUrls = [];
          if (grounding?.groundingChunks) {
            const resolveAndVerifyPromises = grounding.groundingChunks
              .filter(chunk => chunk.web?.uri)
              .map(async (chunk) => {
                const originalUri = chunk.web!.uri as string;
                const resolvedUri = await resolveGoogleRedirect(originalUri);

                // NUEVO: Verificar que la URL exista (no 404)
                const verification = await verifyUrlExists(resolvedUri);

                return {
                  uri: resolvedUri,
                  originalUri: originalUri,
                  title: (chunk.web!.title as string) || 'Fuente Google',
                  valid: verification.valid,
                  error: verification.error
                };
              });

            const resolvedUrls = await Promise.all(resolveAndVerifyPromises);

            // Filtrar solo URLs que existen y tienen contenido
            const validUrls = resolvedUrls.filter(r => r.valid);
            const invalidUrls = resolvedUrls.filter(r => !r.valid);

            groundingUrls = validUrls.map(r => ({ uri: r.uri, title: r.title }));

            console.log(`[BG-CURATION] URLs válidas: ${validUrls.length}/${resolvedUrls.length} (con contenido ≥50 palabras)`);
            if (invalidUrls.length > 0) {
              invalidUrls.forEach(u => {
                console.log(`[BG-CURATION] ✗ URL rechazada: ${u.uri.substring(0, 50)}... - ${u.error}`);
              });
            }
          }

          const searchQueries = grounding?.webSearchQueries || [];
          console.log(`[BG-CURATION] Búsquedas: ${searchQueries.length} | Grounding URLs: ${groundingUrls.length}`);

          // VALIDACIÓN CRÍTICA: Debe haber grounding URLs
          if (groundingUrls.length === 0) {
            console.warn(`[BG-CURATION] ${modelConfig.name} SIN grounding - siguiente intento...`);
            await delay(1000);
            continue;
          }

          // Intentar parsear JSON
          try {
            const cleanJson = cleanJsonResponse(responseText);
            parsedResponse = JSON.parse(cleanJson);
            successModel = modelConfig.name;
            console.log(`[BG-CURATION] ✅ ${modelConfig.name} OK con ${groundingUrls.length} fuentes verificadas`);
            break; // Éxito!
          } catch (jsonErr: any) {
            console.warn(`[BG-CURATION] JSON inválido en ${modelConfig.name}: ${jsonErr.message}`);
            // Si hay grounding pero JSON falló, intentar con siguiente modelo
            await delay(1000);
            continue;
          }

        } catch (err: any) {
          console.error(`[BG-CURATION] Error ${modelConfig.name}:`, err.message);
          await delay(1500);
        }
      }

      // Si no hay grounding URLs después de todos los intentos, FALLAR el lote
      if (groundingUrls.length === 0) {
        console.error(`[BG-CURATION] ❌ Lote ${batchNum} FALLÓ - Sin grounding en ningún intento`);
        return { success: false, rowsInserted: 0, failedComponents: batch };
      }

      // Construir filas para insertar
      const rowsToInsert: any[] = [];
      const usedGroundingUrls = new Set<string>(); // Track used grounding URLs to avoid duplicates
      const componentsWithoutSource: RequiredComponent[] = []; // Components that need fallback

      // Opción A: Usar respuesta parseada del modelo
      if (parsedResponse?.sources_by_lesson) {
        for (const lesson of parsedResponse.sources_by_lesson) {
          for (const comp of lesson.components || []) {
            const originalComp = batch.find(b =>
              b.component === comp.component_name &&
              (b.lesson_id === lesson.lesson_id || b.lesson_title === lesson.lesson_title)
            ) || batch.find(b => b.component === comp.component_name);

            if (!originalComp) continue;

            const source = comp.candidate_sources?.[0];
            if (source?.url) {
              // VALIDACIÓN ANTI-ALUCINACIÓN MEJORADA: Comparación normalizada
              const sourceNormalized = normalizeUrl(source.url);
              const sourceHost = normalizeHost(source.url);

              // Buscar coincidencia en grounding (flexible)
              const matchingGrounding = groundingUrls.find(g => {
                const gNormalized = normalizeUrl(g.uri);
                const gHost = normalizeHost(g.uri);
                // Coincidencia si: mismo host, o URL normalizada similar
                return sourceHost === gHost ||
                       sourceNormalized === gNormalized ||
                       sourceNormalized.includes(gHost) ||
                       gNormalized.includes(sourceHost);
              });

              if (matchingGrounding) {
                // URL verificada - usar la URL del modelo pero marcar grounding como usado
                usedGroundingUrls.add(matchingGrounding.uri);
                rowsToInsert.push({
                  curation_id: curationId,
                  lesson_id: originalComp.lesson_id,
                  lesson_title: originalComp.lesson_title,
                  component: originalComp.component,
                  is_critical: originalComp.is_critical,
                  source_ref: source.url,
                  source_title: source.title || matchingGrounding.title || 'Fuente verificada',
                  source_rationale: source.rationale || 'Encontrada via Google Search',
                  url_status: 'OK',
                  http_status_code: 200,
                  apta: null,
                  notes: `Fuente: google_verified (${successModel})`,
                  created_at: new Date().toISOString()
                });
              } else {
                // URL no verificada - guardar componente para asignarle URL de grounding
                console.warn(`[BG-CURATION] URL no coincide con grounding: ${source.url}`);
                componentsWithoutSource.push(originalComp);
              }
            } else {
              // Sin URL en respuesta del modelo
              componentsWithoutSource.push(originalComp);
            }
          }
        }
      }

      // Asignar URLs de grounding no usadas a componentes sin fuente
      if (componentsWithoutSource.length > 0) {
        const unusedGroundingUrls = groundingUrls.filter(g => !usedGroundingUrls.has(g.uri));
        console.log(`[BG-CURATION] Asignando ${Math.min(unusedGroundingUrls.length, componentsWithoutSource.length)} URLs de grounding a componentes sin fuente`);

        for (let i = 0; i < componentsWithoutSource.length && i < unusedGroundingUrls.length; i++) {
          const comp = componentsWithoutSource[i];
          const gUrl = unusedGroundingUrls[i];
          rowsToInsert.push({
            curation_id: curationId,
            lesson_id: comp.lesson_id,
            lesson_title: comp.lesson_title,
            component: comp.component,
            is_critical: comp.is_critical,
            source_ref: gUrl.uri,
            source_title: gUrl.title,
            source_rationale: 'Fuente asignada de Google Search grounding',
            url_status: 'OK',
            http_status_code: 200,
            apta: null,
            notes: `Fuente: grounding_fallback (${successModel})`,
            created_at: new Date().toISOString()
          });
        }
      }

      // Opción B: Si no se pudo parsear JSON pero hay grounding, usar URLs directamente
      if (rowsToInsert.length === 0 && groundingUrls.length > 0) {
        console.log(`[BG-CURATION] Usando ${groundingUrls.length} URLs de grounding directamente`);
        let urlIdx = 0;
        for (const comp of batch) {
          if (urlIdx < groundingUrls.length) {
            const gUrl = groundingUrls[urlIdx];
            rowsToInsert.push({
              curation_id: curationId,
              lesson_id: comp.lesson_id,
              lesson_title: comp.lesson_title,
              component: comp.component,
              is_critical: comp.is_critical,
              source_ref: gUrl.uri,
              source_title: gUrl.title,
              source_rationale: 'Fuente directa de Google Search',
              url_status: 'OK',
              http_status_code: 200,
              apta: null,
              notes: 'Fuente: grounding_direct',
              created_at: new Date().toISOString()
            });
            urlIdx++;
          }
        }
      }

      // Determinar componentes fallidos (sin fuente asignada)
      const coveredComponents = new Set(rowsToInsert.map(r => `${r.lesson_id}|${r.component}`));
      const failedComponents = batch.filter(c => !coveredComponents.has(`${c.lesson_id}|${c.component}`));

      // Insertar en DB
      if (rowsToInsert.length > 0) {
        const { error: insertError } = await supabase.from('curation_rows').insert(rowsToInsert);
        if (insertError) {
          console.error('[BG-CURATION] DB Error:', insertError.message);
          return { success: false, rowsInserted: 0, failedComponents: batch };
        }
        console.log(`[BG-CURATION] ✓ Insertadas ${rowsToInsert.length} fuentes`);
      }

      return {
        success: rowsToInsert.length > 0,
        rowsInserted: rowsToInsert.length,
        failedComponents
      };
    };

    // --- PROCESAMIENTO PRINCIPAL ---
    const BATCH_SIZE = 8;
    const totalBatches = Math.ceil(components.length / BATCH_SIZE);
    const allFailedComponents: RequiredComponent[] = [];
    let totalInserted = 0;

    // RONDA 1: Procesar todos los lotes
    console.log(`[BG-CURATION] === RONDA 1: ${totalBatches} lotes ===`);
    for (let i = 0; i < components.length; i += BATCH_SIZE) {
      const batch = components.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;

      const result = await processBatch(batch, batchNum, totalBatches, false);
      totalInserted += result.rowsInserted;

      if (result.failedComponents.length > 0) {
        allFailedComponents.push(...result.failedComponents);
      }

      // Rate limit entre lotes
      if (i + BATCH_SIZE < components.length) {
        await delay(2000);
      }
    }

    console.log(`[BG-CURATION] Ronda 1 completada: ${totalInserted} fuentes, ${allFailedComponents.length} componentes fallidos`);

    // RONDA 2: Recuperación de componentes fallidos
    if (allFailedComponents.length > 0) {
      console.log(`[BG-CURATION] === RONDA 2 (RECUPERACIÓN): ${allFailedComponents.length} componentes ===`);

      const recoveryBatches = Math.ceil(allFailedComponents.length / BATCH_SIZE);

      for (let i = 0; i < allFailedComponents.length; i += BATCH_SIZE) {
        const batch = allFailedComponents.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;

        // Esperar más tiempo antes de reintentar
        await delay(3000);

        const result = await processBatch(batch, batchNum, recoveryBatches, true);
        totalInserted += result.rowsInserted;

        if (result.failedComponents.length > 0) {
          console.warn(`[BG-CURATION] ${result.failedComponents.length} componentes sin cubrir después de recuperación`);
        }
      }
    }

    // 5. Actualizar Estado Final
    await supabase.from('curation')
      .update({ state: 'PHASE2_GENERATED', updated_at: new Date().toISOString() })
      .eq('id', curationId);

    console.log(`[BG-CURATION] ✅ COMPLETADO: ${totalInserted} fuentes totales para ${components.length} componentes`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        totalInserted,
        totalComponents: components.length
      })
    };

  } catch (error: any) {
    console.error('[BG-CURATION] Error Global:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
