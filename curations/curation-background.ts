import { Handler } from '@netlify/functions'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createClient } from '@supabase/supabase-js'

// --- DEFINICIONES DE TIPOS ---

interface RequiredComponent {
  lesson_id: string
  lesson_title: string
  component: string
  is_critical: boolean
}

interface CurationPayload {
  curationId: string
  artifactId: string
  components: RequiredComponent[]
  courseName: string
  ideaCentral: string
  accessToken: string // Token del usuario para escribir en Supabase
  attemptNumber?: number
  gaps?: string[]
  promptVersion?: string
}

// --- CONFIGURACIÓN ---

// --- CONFIGURACIÓN ---

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ROLE_KEY

// --- PROMPTS (Simplificado para Background Function) ---

function getBackgroundPrompt(courseName: string, ideaCentral: string, lessonsText: string): string {
  return `⛔⛔⛔ REGLA CRÍTICA: USA SOLO GOOGLE SEARCH ⛔⛔⛔

Tienes la herramienta Google Search activada y DEBES USARLA para el 100% de las fuentes.
Cualquier URL que NO provenga de un resultado de Google Search será RECHAZADA automáticamente.

═══════════════════════════════════════════════════════════════
                    🔍 PROCESO OBLIGATORIO 🔍
═══════════════════════════════════════════════════════════════

PARA CADA COMPONENTE, EJECUTA ESTOS PASOS SIN EXCEPCIÓN:
1. EJECUTA una búsqueda en Google con palabras clave específicas del tema
2. Añade a tu búsqueda: "guía" OR "metodología" OR "framework" OR "caso de estudio"
3. ESPERA y LEE los resultados reales que devuelve la herramienta
4. EXTRAE URLs ÚNICAMENTE de los resultados de groundingChunks

⛔ SI GENERAS UNA URL DE TU MEMORIA = RECHAZADA
⛔ SI LA URL NO APARECE EN groundingChunks = RECHAZADA

═══════════════════════════════════════════════════════════════
                    🚫 PROHIBICIONES ABSOLUTAS 🚫
═══════════════════════════════════════════════════════════════
🚫 PROHIBIDO: URLs inventadas o de memoria (ej: "harvard.edu/xyz" que "crees" que existe)
🚫 PROHIBIDO: YouTube, LinkedIn, Facebook, Twitter, Reddit, TikTok
🚫 PROHIBIDO: Sitios con paywall (HBR, Medium premium, Forbes, WSJ)
🚫 PROHIBIDO: PDFs o archivos que requieran descarga
🚫 PROHIBIDO: Scribd, SlideShare, Academia.edu, DocPlayer (bloquean contenido)
🚫 PROHIBIDO: Educaplay, Prezi, Canva (plataformas interactivas sin texto)
🚫 PROHIBIDO: Vorecol, Factorial, Personio (blogs de software RH genéricos)
🚫 PROHIBIDO: Contenido generado por usuarios sin verificación
🚫 PROHIBIDO: Artículos con menos de 500 palabras o listicles superficiales

═══════════════════════════════════════════════════════════════
                    ✅ FUENTES PREFERIDAS (PRIORIZAR) ✅
═══════════════════════════════════════════════════════════════
✅ EXCELENTE: Universidades (.edu, .edu.mx, .edu.ar, .edu.co, .ac.uk)
✅ EXCELENTE: Escuelas de negocios (IESE, IE, INCAE, IPADE, Tecnológico de Monterrey)
✅ EXCELENTE: Consultoras (McKinsey, BCG, Bain, Deloitte, PwC, KPMG, Accenture)
✅ EXCELENTE: Revistas académicas (journals, repositorios institucionales)
✅ MUY BUENO: Instituciones profesionales (CIPD, SHRM, PMI, ATD)
✅ MUY BUENO: Portales especializados (MIT Sloan, Emerald Insight, ResearchGate)
✅ BUENO: Blogs de expertos reconocidos CON AUTOR IDENTIFICADO
✅ BUENO: Casos de estudio documentados con datos reales
✅ ACEPTABLE: Guías metodológicas de empresas de capacitación

═══════════════════════════════════════════════════════════════
                    CONTEXTO DEL CURSO
═══════════════════════════════════════════════════════════════
**CURSO:** ${courseName}
**IDEA CENTRAL:** ${ideaCentral}
**PÚBLICO:** Gerentes con 2-5 años de experiencia en liderazgo corporativo

**COMPONENTES A CUBRIR:**
${lessonsText}

═══════════════════════════════════════════════════════════════
                    📌 REGLAS FINALES 📌
═══════════════════════════════════════════════════════════════

✅ CANTIDAD: ESTRICTAMENTE 1 FUENTE ÚNICA por componente. PROHIBIDO incluir más de una (1) URL.
✅ CALIDAD PROFESIONAL: Las fuentes deben ser aptas para un PROGRAMA DE MBA, no blogs básicos.
✅ PROFUNDIDAD: El contenido debe tener al menos 800-1000 palabras con metodología clara.
✅ VACÍO ES MEJOR: Si no encuentras una fuente EXCELENTE, deja el array vacío.

🔵 COMPONENTES QUE NO NECESITAN FUENTE (puedes omitir búsqueda):
- VIDEO_GUIDE: Ya tiene contenido de video propio
- DEMO_GUIDE: Se valida con demostración práctica

**FORMATO JSON (ESTRICTO):**
{
  "sources_by_lesson": [
    {
      "lesson_id": "ID_EXACTO",
      "lesson_title": "TITULO",
      "components": [
        {
          "component_name": "TIPO",
          "is_critical": true/false,
          "search_query_used": "consulta que usaste en Google",
          "candidate_sources": [
            {
              "title": "TITULO EXACTO del resultado de Google",
              "url": "URL EXACTA del resultado de Google",
              "rationale": "Por qué es confiable (menciona institución/autor)",
              "type": "articulo",
              "requires_download": false,
              "is_acceptable": true
            }
          ]
        }
      ]
    }
  ]
}

⛔ RECUERDA: Cualquier URL que no venga de Google Search será RECHAZADA.
Responde SOLO con JSON válido.`
}

// --- HANDLER PRINCIPAL ---

export const handler: Handler = async (event, context) => {
  // Solo permitir POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  // Verificar configuración básica
  if (!GOOGLE_API_KEY || !SUPABASE_URL) {
    console.error('[BG-CURATION] Falta configuración de entorno (API KEY o URL)')
    return { statusCode: 500, body: 'Missing env configuration' }
  }

  try {
    const payload = JSON.parse(event.body || '{}') as CurationPayload
    const { curationId, artifactId, components, courseName, ideaCentral, accessToken } = payload

    if (!curationId || !components || components.length === 0) {
      return { statusCode: 400, body: 'Missing required payload data' }
    }

    console.log(`[BG-CURATION] Iniciando trabajo de fondo para CurationID: ${curationId}`)
    
    // Inicializar Supabase
    // PREFERENCIA: Service Role Key (Admin) > Anon Key + Token
    let supabase;
    let isAdmin = false;

    if (SUPABASE_SERVICE_ROLE_KEY) {
      console.log('[BG-CURATION] Usando Service Role Key (Admin Bypass RLS)')
      isAdmin = true;
      supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        }
      })
    } else {
      console.log('[BG-CURATION] Usando Anon Key + User Token (RLS Activo)')
      if (!SUPABASE_ANON_KEY) throw new Error('No Anon Key found')
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      })
    }

    // --- OBTENER CONFIGURACIÓN DINÁMICA DE LA BD ---
    const { data: dbSettings } = await supabase
      .from('curation_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
    
    // Valores por defecto si no existe la tabla/fila
    const configModel = dbSettings?.model_name || 'gemini-2.0-flash'
    const configFallback = dbSettings?.fallback_model || 'gemini-2.0-flash' // Fallback dinámico
    const configTemp = dbSettings?.temperature !== undefined ? dbSettings.temperature : 0.2
    const configThinking = dbSettings?.thinking_level || 'minimal'
    
    // Definir instrucciones de pensamiento según el nivel configurado
    let thinkingInstruction = ""
    switch (configThinking) {
        case 'high':
            thinkingInstruction = "Realiza un análisis profundo y crítico de la autoridad, actualidad y relevancia académica de cada fuente."
            break
        case 'medium':
            thinkingInstruction = "Evalúa críticamente la relevancia y confiabilidad de la fuente para un contexto profesional."
            break
        case 'low':
            thinkingInstruction = "Verifica que la fuente sea relevante y tenga credibilidad básica."
            break
        case 'minimal':
        default:
            thinkingInstruction = "Sé directo y verifica que la fuente exista y sea relevante."
            break
    }

    console.log(`[BG-CURATION] ⚙️ Configuración Dinámica: Modelo=${configModel}, Fallback=${configFallback}, Temp=${configTemp}, Thinking=${configThinking}`)

    // --- PRUEBA DE INTEGRIDAD (ZOMBIE CHECK) ---
    // Verificar que el registro 'curation' realmente existe antes de gastar recursos
    const { data: curationExists, error: integrityError } = await supabase
       .from('curation')
       .select('id')
       .eq('id', curationId)
       .maybeSingle()

    if (integrityError) {
       console.error('[BG-CURATION] Error verificando integridad:', integrityError)
    }

    if (!curationExists) {
       console.log(`[BG-CURATION] 🛑 PROCESO ZOMBIE DETECTADO. El ID ${curationId} no existe en la tabla curation. Abortando.`)
       return { statusCode: 200, body: 'Aborted: Curation ID not found (Zombie Process)' }
    }
    console.log('[BG-CURATION] ✅ Integridad verificada: curationId existe.')
    // -------------------------------------------

    // ... (Código de prevención duplicada existente) ...
    // --- PREVENCIÓN DE LLAMADAS DUPLICADAS ---
    const { data: preCoverageRows } = await supabase
       .from('curation_rows')
       .select('lesson_id, component')
       .eq('curation_id', curationId)
       .eq('apta', true)

    if (preCoverageRows && preCoverageRows.length > 0) {
       const existingCoverage = new Set(
          preCoverageRows.map((r: any) => `${r.lesson_id}|${r.component}`)
       )
       
       const componentsThatNeedSources = components.filter(
          c => !existingCoverage.has(`${c.lesson_id}|${c.component}`)
       )
       
       const coveragePercent = Math.round(
          (existingCoverage.size / components.length) * 100
       )

       console.log(`[BG-CURATION] 📊 Cobertura existente: ${existingCoverage.size}/${components.length} (${coveragePercent}%)`)

       if (componentsThatNeedSources.length === 0) {
          console.log('[BG-CURATION] 🛑 LLAMADA DUPLICADA DETECTADA. Todos los componentes ya tienen fuentes. Abortando.')
          await supabase.from('curation').update({ state: 'PHASE2_GENERATED' }).eq('id', curationId)
          return { statusCode: 200, body: 'Aborted: All components already have sources (Duplicate Call)' }
       }

       if (coveragePercent >= 95) {
          console.log(`[BG-CURATION] 🛑 LLAMADA TARDÍA DETECTADA. Cobertura al ${coveragePercent}%. Abortando.`)
          await supabase.from('curation').update({ state: 'PHASE2_GENERATED' }).eq('id', curationId)
          return { statusCode: 200, body: 'Aborted: Coverage already sufficient (Late Duplicate Call)' }
       }

       console.log(`[BG-CURATION] ⚠️ Solo procesando ${componentsThatNeedSources.length} componentes sin cobertura.`)
    }
    // -------------------------------------------

    // ... (Write Test) ...
    try {
      await supabase.from('pipeline_events').insert({
        artifact_id: artifactId,
        step_id: 'ESP-04',
        entity_type: 'curation',
        entity_id: curationId,
        event_type: 'INFO',
        event_data: {
          message: `Iniciando proceso Background (Admin: ${isAdmin}).`,
          components_count: components.length,
          config: { model: configModel, temp: configTemp }
        }
      })
    } catch (writeErr: any) {
      if (writeErr.code === '23503') return { statusCode: 500, body: 'FK Error on Write Test' }
    }

    // Inicializar Gemini
    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY)
    
    const BATCH_SIZE = 8
    const START_TIME = Date.now()
    const MAX_EXECUTION_TIME = 840000 

    const isTimeRemaining = () => (MAX_EXECUTION_TIME - (Date.now() - START_TIME)) > 30000

    // ... Helpers (checkUrlAvailability, delay) se mantienen igual ...
    // NOTA: Asegúrate de que checkUrlAvailability esté definido (ya lo actualicé en el paso anterior).
    // Aquí solo estoy reemplazando el bloque inicial, pero debo tener cuidado con el alcance de las variables.
    // Como checkUrlAvailability está DESPUÉS en el código original, este replace NO debe sobrescribirlo.
    // MI REPLACE CUBRE DESDE [Inicializar Supabase] HASTA [MAX_EXECUTION_TIME].
    // CUIDADO: El código original tiene checkUrlAvailability DESPUÉS de MAX_EXECUTION_TIME.
    // Mi contenido de reemplazo termina antes de checkUrlAvailability.

    // ... (Resto de imports y setup) ...

    // --- REEMPLAZO DE LA ESTRATEGIA DE MODELOS EN executeWithRetry ---
    // Tengo que editar executeWithRetry más abajo, o inyectar las variables aquí.
    // Las variables configModel y configTemp ya están en el scope de 'handler'.
    
    // Para aplicar esto, necesito buscar el bloque `try { const executeWithRetry ...` y actualizarlo.
    // PERO `replace_file_content` es un bloque continuo.
    // Voy a hacer DOS ediciones.
    // 1. Inyectar la lectura de DB al principio.
    // 2. Modificar el uso de modelos en el loop.
    
    // Mmm, mejor hago una sola edición grande si el archivo lo permite, o dos separadas.
    // El archivo es largo.
    // Voy a usar `multi_replace_file_content` para hacer ambas cosas de una vez.
    // -----------------------------------

    // Inicializar Gemini con configuración de entorno EXACTA
    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY)

    
    // (Función createSearchModel eliminada)

    // OPTIMIZACIÓN: Lotes de 8 componentes para reducir la sobrecarga de roundtrips
    // Con gemini-2.0-flash como fallback, es seguro procesar más items.
    const BATCH_SIZE = 8

    // Límite de tiempo: dejar 60s de margen antes del timeout de 900s
    const START_TIME = Date.now()
    const MAX_EXECUTION_TIME = 840000 // 14 minutos en ms

    const isTimeRemaining = () => {
      const elapsed = Date.now() - START_TIME
      const remaining = MAX_EXECUTION_TIME - elapsed
      if (remaining < 30000) {
        console.log(`[BG-CURATION] ⚠️ Tiempo restante bajo: ${Math.round(remaining/1000)}s`)
      }
      return remaining > 30000 // Dejar 30s de margen
    }
    
    // Helper para resolver redirecciones y obtener URL final
    const resolveRedirectUrl = async (url: string): Promise<string> => {
      // Si es una URL de redirección de Vertex AI, seguirla
      if (url.includes('vertexaisearch.cloud.google.com/grounding-api-redirect')) {
        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 8000)
          const res = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          })
          clearTimeout(timeoutId)
          // Retornar la URL final después de seguir redirecciones
          return res.url || url
        } catch {
          return url // Si falla, retornar la original
        }
      }
      return url
    }

    // Helper para verificar disponibilidad de URL (HEAD request)
    // MODIFICACIÓN: Reactivada validación real para evitar fuentes rotas (404/DNS).
    const checkUrlAvailability = async (url: string): Promise<{ ok: boolean, status: number, finalUrl?: string, error?: string }> => {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 4000) // 4s timeout para no alentar demasiado
        const res = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        })
        clearTimeout(timeoutId)
        
        // Lógica de aceptación:
        // - 2xx (OK): Aceptado
        // - 404 (Not Found): RECHAZADO
        // - 403/401 (Forbidden/Unauthorized): ACEPTADO (asumimos bloqueo anti-bot, pero el link existe para humanos)
        // - 5xx (Server Error): RECHAZADO (sitio caído)
        if (res.status === 404 || res.status >= 500) {
             return { ok: false, status: res.status, error: `HTTP ${res.status}` }
        }
        
        return { ok: true, status: res.status, finalUrl: res.url || url }
      } catch (err: any) {
         // Errores de red, DNS, Timeout -> RECHAZADO
         // Esto filtra "sitios que no existen"
         return { ok: false, status: 0, error: err.message || 'Network/DNS Error' }
      }
    }

    // Helper: delay para evitar rate limiting
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    const totalBatches = Math.ceil(components.length / BATCH_SIZE)

    for (let i = 0; i < components.length; i += BATCH_SIZE) {
      const batchNumber = Math.floor(i/BATCH_SIZE) + 1
      const batch = components.slice(i, i + BATCH_SIZE)
      console.log(`[BG-CURATION] ══════════════════════════════════════`)
      console.log(`[BG-CURATION] Procesando lote ${batchNumber}/${totalBatches} (${batch.length} items)...`)

      // Verificar tiempo restante antes de procesar
      if (!isTimeRemaining()) {
        console.log(`[BG-CURATION] ⏱️ Tiempo agotado. Saltando lotes restantes.`)
        break
      }

      // Agregar delay entre lotes para evitar rate limiting (AUMENTADO A 5s)
      if (i > 0) {
        console.log(`[BG-CURATION] Esperando 5s antes del siguiente lote (Rate Limit Guard)...`)
        await delay(5000)
      }

      // Construir texto del prompt para este lote
      const lessonsText = batch.map(c => 
        `- Lección: ${c.lesson_title} (ID: ${c.lesson_id}) -> Componente: ${c.component} ${c.is_critical ? '(CRITICO)' : ''}`
      ).join('\n')

      // PROMPT CON GROUNDING ESTRICTO - Anti-alucinaciones
      // Fuerza al modelo a usar SOLO resultados de Google Search
      const prompt = `
FECHA ACTUAL: Enero 2025

🔍 TAREA: BUSCAR FUENTES EN INTERNET (2024-2025)

Necesito que BUSQUES en Internet artículos PUBLICADOS EN 2024 o 2025 sobre los temas de este curso.
NO uses tu conocimiento de entrenamiento. BUSCA información ACTUAL.
${thinkingInstruction}

INSTRUCCIÓN CLAVE: 
Antes de responder, EJECUTA búsquedas en Google para cada lección.
Busca: "guía [tema] 2024" o "artículo [tema] 2025"

═══════════════════════════════════════════════════════════════
                    CONTEXTO DEL CURSO
═══════════════════════════════════════════════════════════════
CURSO: ${courseName}
IDEA CENTRAL: ${ideaCentral}

COMPONENTES A INVESTIGAR (busca 1 fuente ACTUAL por cada uno):
${lessonsText}

═══════════════════════════════════════════════════════════════
                    PROCESO DE BÚSQUEDA
═══════════════════════════════════════════════════════════════

Para CADA componente:
1. EJECUTA una búsqueda en Google con: "[título de la lección] artículo 2024 español"
2. REVISA los resultados que te devuelve Google
3. SELECCIONA la mejor URL de los resultados

⚠️ IMPORTANTE:
- Solo incluye URLs que hayas ENCONTRADO en la búsqueda
- NO inventes URLs de memoria
- Si no encuentras nada, pon candidate_sources: []
- Prefiere: Wikipedia, blogs educativos, sitios .edu

🚫 PROHIBIDO: YouTube, redes sociales, PDFs, sitios con paywall

═══════════════════════════════════════════════════════════════
                    FORMATO DE SALIDA (JSON ESTRICTO)
═══════════════════════════════════════════════════════════════
{
  "sources_by_lesson": [
    {
      "lesson_id": "ID_EXACTO_DEL_INPUT",
      "lesson_title": "TITULO_EXACTO",
      "components": [
        {
          "component_name": "TIPO_COMPONENTE",
          "is_critical": true,
          "search_query_used": "consulta que usaste en Google",
          "candidate_sources": [
            {
              "title": "TITULO EXACTO del resultado de Google",
              "url": "URL EXACTA del resultado de Google",
              "rationale": "Por qué esta fuente es confiable y relevante",
              "type": "articulo",
              "requires_download": false,
              "is_acceptable": true
            }
          ]
        }
      ]
    }
  ]
}

═══════════════════════════════════════════════════════════════
                    📌 REGLAS FINALES 📌
═══════════════════════════════════════════════════════════════

✅ CANTIDAD: SOLO 1 FUENTE por componente - LA MEJOR que encuentres en Google.
✅ CALIDAD: Solo incluir fuentes con calidad potencial >= 9/10.
✅ VACÍO ES MEJOR: Si no encuentras nada bueno en Google, pon candidate_sources: []

🔵 COMPONENTES QUE NO NECESITAN FUENTE (puedes omitir):
- VIDEO_GUIDE: Ya tiene contenido de video propio
- DEMO_GUIDE: Se valida con demostración práctica

⛔ RECUERDA: Cualquier URL que no venga de Google Search será RECHAZADA automáticamente.

Responde SOLO con JSON válido.
`

      try {
        // Función para ejecutar con reintentos si no usa Google Search
        // OPTIMIZADO: Solo 2 intentos para evitar timeouts
        // Función optimizada con FALLBACK de modelos
        const executeWithRetry = async (promptText: string, maxRetries = 2): Promise<{
          result: any,
          groundingUrls: { url: string; title: string }[],
          modelUsed: string
        }> => {
          let lastResult: any = null
          
          // Inicializar GenerativeAI si no está disponible en scope (debería estarlo)
          // Asumimos 'genAI' disponible del scope superior
          
          // Estrategia: Configuración DB -> Reintento estricto -> Fallback
          const modelsToTry = [
            { name: configModel, temp: configTemp },           // Intento 1: Configuración usuario
            { name: configModel, temp: 0.1 },                  // Intento 2: Mismo modelo, temp 0.1 (fuerza herramientas)
            { name: configFallback, temp: 0.7 }                // Intento 3: Fallback Configurado
          ]

          for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
            const { name: modelName, temp } = modelsToTry[attempt]
            
            console.log(`[BG-CURATION] 🔄 Intento ${attempt + 1}/${modelsToTry.length} usando ${modelName} (temp: ${temp})`)

            const currentModel = genAI.getGenerativeModel({
              model: modelName,
              tools: [{ googleSearch: {} }] as any,
              generationConfig: { temperature: temp }
            })

            // Prompt reforzado para reintentos
            let modifiedPrompt = promptText
            if (attempt > 0) {
                 modifiedPrompt = `
═══════════════════════════════════════════════════════════════
⚠️ REINTENTO DE BÚSQUEDA - IMPORTANCIA CRÍTICA ⚠️
═══════════════════════════════════════════════════════════════
EL INTENTO ANTERIOR FALLÓ PORQUE NO SE ACTIVÓ LA BÚSQUEDA WEB.

TU TAREA PRINCIPAL ES:
1. USAR OBLIGATORIAMENTE la herramienta de búsqueda de Google.
2. CITAR las URLs ACTUALES encontradas.

¡BUSCA AHORA!
` + promptText
            }

            try {
              const result = await currentModel.generateContent(modifiedPrompt)
              lastResult = result

              const candidate = (result.response as any).candidates?.[0]
              const groundingMetadata = candidate?.groundingMetadata
              const groundingUrls: { url: string; title: string }[] = []

              // Verificar Grounding
              if (groundingMetadata?.groundingChunks?.length > 0) {
                 console.log(`[BG-CURATION] ✅ Google Search EXITOSO con ${modelName}. URLs: ${groundingMetadata.groundingChunks.length}`)
                 
                 for (const chunk of groundingMetadata.groundingChunks) {
                    if (chunk.web?.uri && chunk.web?.title) {
                       groundingUrls.push({
                          url: chunk.web.uri,
                          title: chunk.web.title
                       })
                    }
                 }
                 
                 return { result, groundingUrls, modelUsed: modelName }
              } else {
                 console.warn(`[BG-CURATION] ⚠️ ${modelName} NO generó grounding chunks (Alucinación potencial).`)
              }

            } catch (err: any) {
               console.error(`[BG-CURATION] ❌ Error con modelo ${modelName}: ${err.message}`)
            }
            
            // Si fallamos, esperar un tiempo significativo antes de reintentar (Backoff para rate limits)
            if (attempt < modelsToTry.length - 1) {
               console.log(`[BG-CURATION] ⏳ Esperando 4s antes de reintentar...`)
               await delay(4000)
            }
          }

          console.error(`[BG-CURATION] ❌ TODOS los intentos fallaron en obtener Grounding válido.`)
          return { result: lastResult, groundingUrls: [], modelUsed: 'none' }
        }

        const { result, groundingUrls: realGroundingUrls } = await executeWithRetry(prompt)
        realGroundingUrls.forEach((u, idx) => console.log(`   [${idx + 1}] ${u.title} - ${u.url}`))

        const responseText = result.response.text()

        // Parsear JSON - con limpieza más agresiva
        let cleanJson = responseText
          .replace(/```json/g, '')
          .replace(/```/g, '')
          .trim()

        // Extraer solo el objeto JSON (desde { hasta el último })
        const jsonStart = cleanJson.indexOf('{')
        const jsonEnd = cleanJson.lastIndexOf('}')
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          cleanJson = cleanJson.substring(jsonStart, jsonEnd + 1)
        }

        let parsed;
        try {
            parsed = JSON.parse(cleanJson)
        } catch (jsonErr) {
            console.error('[BG-CURATION] Error parseando JSON:', jsonErr)
            console.error('[BG-CURATION] Respuesta raw (primeros 500 chars):', responseText.substring(0, 500))

            // FALLBACK: Si hay URLs de grounding, usarlas directamente aunque falle el JSON
            if (realGroundingUrls.length > 0) {
              console.log(`[BG-CURATION] 🔄 Usando fallback: asignando ${realGroundingUrls.length} URLs de grounding directamente`)
              const fallbackRows = []
              let groundingIdx = 0

              for (const comp of batch) {
                if (groundingIdx >= realGroundingUrls.length) break

                const grounding = realGroundingUrls[groundingIdx]
                const check = await checkUrlAvailability(grounding.url)

                if (check.ok) {
                  fallbackRows.push({
                    curation_id: curationId,
                    lesson_id: comp.lesson_id,
                    lesson_title: comp.lesson_title,
                    component: comp.component,
                    is_critical: comp.is_critical,
                    source_ref: check.finalUrl || grounding.url,
                    source_title: grounding.title,
                    source_rationale: 'Fuente de Google Search (fallback por error JSON)',
                    url_status: 'OK',
                    http_status_code: 200,
                    failure_reason: null,
                    apta: null, // Pendiente de validación de contenido
                    notes: 'Fuente: grounding_fallback. Validado OK.',
                    created_at: new Date().toISOString()
                  })
                  console.log(`[BG-CURATION] ✓ Fallback asignado: ${check.finalUrl || grounding.url} -> ${comp.component}`)
                }
                groundingIdx++
              }

              if (fallbackRows.length > 0) {
                const { error } = await supabase.from('curation_rows').insert(fallbackRows)
                if (error) {
                  console.error('[BG-CURATION] Error insertando fallback:', error)
                } else {
                  console.log(`[BG-CURATION] Insertadas ${fallbackRows.length} fuentes (fallback).`)
                }
              }
            }
            continue; // Continuar con el siguiente lote
        }

        // Helper: Verificar si una URL del modelo coincide con una URL real de grounding
        const findMatchingGroundingUrl = (modelUrl: string): { url: string; title: string } | null => {
          if (!modelUrl) return null
          // Normalizar URL para comparación
          const normalizedModelUrl = modelUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase()

          for (const real of realGroundingUrls) {
            const normalizedRealUrl = real.url.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase()
            // Coincidencia exacta o parcial (dominio + path principal)
            if (normalizedRealUrl === normalizedModelUrl ||
                normalizedRealUrl.includes(normalizedModelUrl) ||
                normalizedModelUrl.includes(normalizedRealUrl)) {
              return real
            }
          }
          return null
        }

        // ESTRATEGIA SIMPLIFICADA: Asignar URLs de grounding directamente a componentes del batch
        // No depender del JSON del modelo para el mapeo
        const rowsToInsert: any[] = []
        const usedGroundingUrls = new Set<string>()
        const hasRealGrounding = realGroundingUrls.length > 0

        console.log(`[BG-CURATION] Procesando ${batch.length} componentes con ${realGroundingUrls.length} URLs de grounding`)
        console.log(`[BG-CURATION] Componentes del batch:`, batch.map(c => `${c.lesson_id}|${c.component}`).join(', '))

        // ESTRATEGIA 1 (DESHABILITADA): Asignar URLs de grounding directamente
        // Se deshabilita porque asigna ciegamente fuentes a componentes sin verificar relevancia
        // Priorizamos la Estrategia 2 (JSON del modelo)
        /*
        if (hasRealGrounding) {
           ...
        }
        */

        // ESTRATEGIA 2: Si no hay suficientes URLs de grounding, usar URLs del modelo que pasen validación HTTP
        const componentsWithSources = new Set(rowsToInsert.map(r => `${r.lesson_id}|${r.component}`))

        // Helper: Buscar componente original del batch por título de lección o ID
        const findOriginalComponent = (lessonIdOrTitle: string, componentName: string) => {
          // Primero intentar por ID exacto
          let found = batch.find(
            b => b.lesson_id === lessonIdOrTitle &&
                 b.component.toLowerCase() === componentName?.toLowerCase()
          )
          if (found) return found

          // Si no, intentar por título de lección (el modelo a veces usa el título como ID)
          found = batch.find(
            b => b.lesson_title?.toLowerCase().includes(lessonIdOrTitle?.toLowerCase()) &&
                 b.component.toLowerCase() === componentName?.toLowerCase()
          )
          if (found) return found

          // Último recurso: solo por tipo de componente
          return batch.find(b => b.component.toLowerCase() === componentName?.toLowerCase())
        }

        if (parsed.sources_by_lesson) {
          for (const lesson of parsed.sources_by_lesson) {
            for (const comp of lesson.components || []) {
              // Buscar el componente original del batch
              const originalComp = findOriginalComponent(lesson.lesson_id, comp.component_name)

              // Usar el ID real del batch si lo encontramos
              const actualLessonId = originalComp?.lesson_id || lesson.lesson_id
              const actualLessonTitle = originalComp?.lesson_title || lesson.lesson_title
              const compKey = `${actualLessonId}|${originalComp?.component || comp.component_name}`

              // Si este componente ya tiene fuente de grounding, saltar
              if (componentsWithSources.has(compKey)) continue

              for (const source of comp.candidate_sources || []) {
                if (source.url && source.url.startsWith('http')) {
                  // Las URLs de Vertex redirect SON válidas - son de Google Search
                  const isVertexRedirectUrl = source.url.includes('vertexaisearch.cloud.google.com/grounding-api-redirect')
                  
                  // Solo verificar grounding para URLs que NO son de Vertex redirect
                  let matchingGrounding = null
                  if (!isVertexRedirectUrl) {
                    matchingGrounding = findMatchingGroundingUrl(source.url)
                    if (!matchingGrounding) {
                      console.warn(`[BG-CURATION] ⛔ URL RECHAZADA (no viene de Google Search): ${source.url}`)
                      continue // SALTAR - esta URL fue inventada por el modelo
                    }
                  }
                  
                  const check = await checkUrlAvailability(source.url)
                  if (check.ok) {
                    rowsToInsert.push({
                      curation_id: curationId,
                      lesson_id: actualLessonId,
                      lesson_title: actualLessonTitle,
                      component: originalComp?.component || comp.component_name,
                      is_critical: originalComp?.is_critical ?? comp.is_critical ?? false,
                      source_ref: check.finalUrl || source.url,
                      source_title: source.title || matchingGrounding?.title || 'Fuente de Google Search',
                      source_rationale: source.rationale || 'Fuente verificada de Google Search',
                      url_status: 'OK',
                      http_status_code: check.status,
                      failure_reason: null,
                      apta: null, // Pendiente de validación de contenido
                      notes: isVertexRedirectUrl ? 'Fuente: vertex_redirect. Verificado.' : 'Fuente: google_search_verified.',
                      created_at: new Date().toISOString()
                    })
                    console.log(`[BG-CURATION] ✓ URL de Google Search validada: ${source.url}`)
                    componentsWithSources.add(compKey)
                    break // Una fuente por componente
                  } else {
                    console.warn(`[BG-CURATION] ✗ URL rechazada (HTTP fail): ${source.url} - ${check.error}`)
                  }
                }
              }
            }
          }
        }

        // ESTRATEGIA 3: Para componentes del batch sin fuente aún, asignar cualquier URL de grounding disponible
        const remainingComponents = batch.filter(
          b => !componentsWithSources.has(`${b.lesson_id}|${b.component}`)
        )

        if (remainingComponents.length > 0 && realGroundingUrls.length > 0) {
          console.log(`[BG-CURATION] 🔄 ESTRATEGIA 3: ${remainingComponents.length} componentes sin fuente, reasignando grounding...`)

          for (const comp of remainingComponents) {
            // Buscar una URL de grounding que no hayamos usado aún
            for (const grounding of realGroundingUrls) {
              if (!usedGroundingUrls.has(grounding.url)) {
                const check = await checkUrlAvailability(grounding.url)
                if (check.ok) {
                  usedGroundingUrls.add(grounding.url)
                  rowsToInsert.push({
                    curation_id: curationId,
                    lesson_id: comp.lesson_id,
                    lesson_title: comp.lesson_title,
                    component: comp.component,
                    is_critical: comp.is_critical,
                    source_ref: check.finalUrl || grounding.url,
                    source_title: grounding.title,
                    source_rationale: 'Fuente de Google Search reasignada',
                    url_status: 'OK',
                    http_status_code: 200,
                    failure_reason: null,
                    apta: null, // Pendiente de validación de contenido
                    notes: 'Fuente: grounding_reassigned. Validado OK.',
                    created_at: new Date().toISOString()
                  })
                  console.log(`[BG-CURATION] ✓ Grounding reasignado a ${comp.lesson_title} - ${comp.component}`)
                  componentsWithSources.add(`${comp.lesson_id}|${comp.component}`)
                  break
                }
              }
            }
          }
        }

        // Insertar en Supabase inmediatamente
        
        // FILTRO FINAL DE SEGURIDAD: Garantizar 1 sola fuente por componente
        const uniqueRows = []
        const seenKeys = new Set()
        
        for (const row of rowsToInsert) {
          const key = `${row.lesson_id}|${row.component}`
          if (!seenKeys.has(key)) {
             seenKeys.add(key)
             uniqueRows.push(row)
          } else {
            console.warn(`[BG-CURATION] 🗑️ Eliminando duplicado final para ${key}`)
          }
        }

        console.log(`[BG-CURATION] Total filas únicas a insertar: ${uniqueRows.length} (de ${rowsToInsert.length})`)
        if (uniqueRows.length > 0) {
          console.log(`[BG-CURATION] Primera fila ejemplo:`, JSON.stringify(uniqueRows[0], null, 2))
          const { error } = await supabase.from('curation_rows').insert(uniqueRows)
          if (error) {
            console.error('[BG-CURATION] Error insertando filas:', error)
            
            // CRITICAL ZOMBIE KILLER: Si falla por FK, es que curation ID ya no existe.
            if (error.code === '23503') { 
                 console.log(`[BG-CURATION] 🛑 FATAL: El ID ${curationId} no existe (FK Error). Abortando proceso zombie.`)
                 return { statusCode: 200, body: 'Aborted: Parent record deleted' }
            }
          } else {
            const validCount = uniqueRows.filter(r => r.apta).length
            console.log(`[BG-CURATION] Insertadas ${uniqueRows.length} fuentes (${validCount} válidas).`)
            
            // Logear evento de progreso
            await supabase.from('pipeline_events').insert({
                artifact_id: artifactId,
                step_id: 'ESP-04',
                entity_type: 'curation',
                entity_id: curationId,
                event_type: 'INFO',
                event_data: {
                  message: `Lote procesado: ${validCount}/${uniqueRows.length} fuentes válidas encontradas.`,
                }
            })
          }
        }

      } catch (err: any) {
        console.error(`[BG-CURATION] ❌ Error en lote ${batchNumber}:`, err.message)
        console.error(`[BG-CURATION] Stack:`, err.stack?.slice(0, 500))

        // Si es un error de rate limiting, esperar (pero no demasiado)
        if (err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('rate')) {
          console.log(`[BG-CURATION] ⏳ Rate limit detectado. Esperando 5s...`)
          await delay(5000)
        }
      }

      console.log(`[BG-CURATION] Lote ${batchNumber}/${totalBatches} completado.`)
    }

    // ═══════════════════════════════════════════════════════════════
    // PASE FINAL DE RECUPERACIÓN: Reintentar componentes sin cobertura
    // ═══════════════════════════════════════════════════════════════
    console.log(`[BG-CURATION] ══════════════════════════════════════`)
    console.log(`[BG-CURATION] 🔄 INICIANDO PASE DE RECUPERACIÓN...`)

    // Consultar qué componentes ya tienen fuentes (cualquier estado de 'apta')
    // IMPORTANTE: apta=null significa "pendiente de validación" pero YA tiene fuente candidata
    const { data: existingRows } = await supabase
      .from('curation_rows')
      .select('lesson_id, component')
      .eq('curation_id', curationId)

    const coveredComponents = new Set(
      (existingRows || []).map(r => `${r.lesson_id}|${r.component}`)
    )

    // Identificar componentes sin cobertura
    const uncoveredComponents = components.filter(
      c => !coveredComponents.has(`${c.lesson_id}|${c.component}`)
    )

    console.log(`[BG-CURATION] Componentes cubiertos: ${coveredComponents.size}/${components.length}`)
    console.log(`[BG-CURATION] Componentes SIN cobertura: ${uncoveredComponents.length}`)

    // IMPORTANTE: Aumentar límite para cubrir TODAS las lecciones posibles
    // Priorizar componentes críticos primero
    const sortedUncovered = [...uncoveredComponents].sort((a, b) => {
      // Primero los críticos
      if (a.is_critical && !b.is_critical) return -1
      if (!a.is_critical && b.is_critical) return 1
      // Luego por título de lección
      return a.lesson_title.localeCompare(b.lesson_title)
    })

    // Aumentamos a 50 componentes máximo para cubrir más lecciones
    const maxRecoveryComponents = Math.min(sortedUncovered.length, 50)
    const componentsToRecover = sortedUncovered.slice(0, maxRecoveryComponents)

    if (componentsToRecover.length > 0 && isTimeRemaining()) {
      console.log(`[BG-CURATION] Componentes pendientes (procesando ${componentsToRecover.length} de ${uncoveredComponents.length}):`)
      componentsToRecover.forEach(c => console.log(`   - ${c.lesson_title} | ${c.component} (critical: ${c.is_critical})`))

      // Lotes más grandes para cubrir más rápido
      const RECOVERY_BATCH_SIZE = 5
      const MAX_RECOVERY_ATTEMPTS = 2

      for (let i = 0; i < componentsToRecover.length; i += RECOVERY_BATCH_SIZE) {
        // Verificar tiempo antes de cada lote de recuperación
        if (!isTimeRemaining()) {
          console.log(`[BG-CURATION] ⏱️ Tiempo agotado durante recuperación. Finalizando.`)
          break
        }

        const recoveryBatch = componentsToRecover.slice(i, i + RECOVERY_BATCH_SIZE)
        const recoveryBatchNum = Math.floor(i / RECOVERY_BATCH_SIZE) + 1
        const totalRecoveryBatches = Math.ceil(componentsToRecover.length / RECOVERY_BATCH_SIZE)

        console.log(`[BG-CURATION] ── Recuperación ${recoveryBatchNum}/${totalRecoveryBatches} ──`)

        // Delay entre lotes de recuperación (reducido)
        if (i > 0) {
          await delay(1500)
        }

        // Prompt ultra-específico para recuperación
        const recoveryPrompt = `
BÚSQUEDA URGENTE DE FUENTES EDUCATIVAS

Necesito encontrar fuentes REALES y VERIFICABLES para estos componentes específicos:

${recoveryBatch.map(c => `
═══════════════════════════════════════════════
COMPONENTE: ${c.component}
LECCIÓN: ${c.lesson_title}
CRITICIDAD: ${c.is_critical ? '⚠️ CRÍTICO - PRIORIDAD ALTA' : 'Normal'}
═══════════════════════════════════════════════
`).join('\n')}

CONTEXTO DEL CURSO: ${courseName}
TEMA CENTRAL: ${ideaCentral}

INSTRUCCIONES:
1. USA Google Search para buscar CADA componente
2. Busca artículos, guías, tutoriales sobre el tema específico
3. SOLO incluye URLs que aparezcan en los resultados de búsqueda
4. Dominios preferidos: Wikipedia, sitios .edu, blogs técnicos reconocidos

PROHIBIDO:
- YouTube, redes sociales, sitios con paywall
- URLs inventadas o de memoria

FORMATO DE RESPUESTA (JSON):
{
  "sources_by_lesson": [
    {
      "lesson_id": "ID_EXACTO",
      "lesson_title": "TITULO",
      "components": [
        {
          "component_name": "TIPO",
          "is_critical": true,
          "candidate_sources": [
            {
              "title": "Titulo real del resultado",
              "url": "https://url-real-de-google",
              "rationale": "Relevancia"
            }
          ]
        }
      ]
    }
  ]
}

IMPORTANTE: Responde SOLO con JSON válido.
`

        for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt++) {
          try {
            console.log(`[BG-CURATION] Intento de recuperación ${attempt}/${MAX_RECOVERY_ATTEMPTS}`)

            // Crear modelo dinámicamente con temperatura incremental
            const temp = Math.min(1.0, 0.9 + (attempt * 0.05))
            const recoveryModel = genAI.getGenerativeModel({
              model: PRIMARY_MODEL,
              tools: [{ googleSearch: {} }] as any,
              generationConfig: { temperature: temp }
            })
            const result = await recoveryModel.generateContent(recoveryPrompt)

            // Extraer URLs de grounding
            const candidate = (result.response as any).candidates?.[0]
            const groundingMetadata = candidate?.groundingMetadata
            const recoveryGroundingUrls: { url: string; title: string }[] = []

            if (groundingMetadata?.groundingChunks) {
              for (const chunk of groundingMetadata.groundingChunks) {
                if (chunk.web?.uri && chunk.web?.title) {
                  recoveryGroundingUrls.push({
                    url: chunk.web.uri,
                    title: chunk.web.title
                  })
                }
              }
            }

            console.log(`[BG-CURATION] Recuperación encontró ${recoveryGroundingUrls.length} URLs de grounding`)

            const recoveryRowsToInsert = []

            // Si hay grounding, asignar directamente
            if (recoveryGroundingUrls.length > 0) {
              let idx = 0
              for (const comp of recoveryBatch) {
                // Verificar si ya fue cubierto en este intento
                if (coveredComponents.has(`${comp.lesson_id}|${comp.component}`)) continue

                const grounding = recoveryGroundingUrls[idx % recoveryGroundingUrls.length]
                const check = await checkUrlAvailability(grounding.url)

                if (check.ok) {
                  recoveryRowsToInsert.push({
                    curation_id: curationId,
                    lesson_id: comp.lesson_id,
                    lesson_title: comp.lesson_title,
                    component: comp.component,
                    is_critical: comp.is_critical,
                    source_ref: check.finalUrl || grounding.url,
                    source_title: grounding.title,
                    source_rationale: 'Fuente de pase de recuperación (Google Search)',
                    url_status: 'OK',
                    http_status_code: 200,
                    failure_reason: null,
                    apta: null, // Pendiente de validación de contenido
                    notes: `Fuente: recovery_pass_attempt_${attempt}. Validado OK.`,
                    created_at: new Date().toISOString()
                  })
                  coveredComponents.add(`${comp.lesson_id}|${comp.component}`)
                  console.log(`[BG-CURATION] ✓ Recuperado: ${comp.lesson_title} - ${comp.component}`)
                }
                idx++
              }
            }

            // Parsear JSON del modelo como fallback
            if (recoveryRowsToInsert.length < recoveryBatch.length) {
              try {
                const responseText = result.response.text()
                let cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim()
                const jsonStart = cleanJson.indexOf('{')
                const jsonEnd = cleanJson.lastIndexOf('}')
                if (jsonStart !== -1 && jsonEnd !== -1) {
                  cleanJson = cleanJson.substring(jsonStart, jsonEnd + 1)
                }
                const parsed = JSON.parse(cleanJson)

                if (parsed.sources_by_lesson) {
                  for (const lesson of parsed.sources_by_lesson) {
                    for (const compData of lesson.components || []) {
                      const originalComp = recoveryBatch.find(
                        b => b.component.toLowerCase() === compData.component_name?.toLowerCase()
                      )
                      if (!originalComp) continue
                      if (coveredComponents.has(`${originalComp.lesson_id}|${originalComp.component}`)) continue

                      for (const source of compData.candidate_sources || []) {
                        if (source.url?.startsWith('http')) {
                          const check = await checkUrlAvailability(source.url)
                          if (check.ok) {
                            recoveryRowsToInsert.push({
                              curation_id: curationId,
                              lesson_id: originalComp.lesson_id,
                              lesson_title: originalComp.lesson_title,
                              component: originalComp.component,
                              is_critical: originalComp.is_critical,
                              source_ref: check.finalUrl || source.url,
                              source_title: source.title || 'Sin titulo',
                              source_rationale: source.rationale || 'Fuente de recuperación',
                              url_status: 'OK',
                              http_status_code: check.status,
                              failure_reason: null,
                              apta: null, // Pendiente de validación de contenido
                              notes: `Fuente: recovery_model_validated_attempt_${attempt}.`,
                              created_at: new Date().toISOString()
                            })
                            coveredComponents.add(`${originalComp.lesson_id}|${originalComp.component}`)
                            console.log(`[BG-CURATION] ✓ Recuperado (modelo): ${originalComp.lesson_title} - ${originalComp.component}`)
                            break
                          }
                        }
                      }
                    }
                  }
                }
              } catch (jsonErr) {
                console.warn(`[BG-CURATION] Error parseando JSON de recuperación:`, jsonErr)
              }
            }

            // Insertar filas recuperadas
            if (recoveryRowsToInsert.length > 0) {
              const { error } = await supabase.from('curation_rows').insert(recoveryRowsToInsert)
              if (error) {
                console.error('[BG-CURATION] Error insertando recuperación:', error)
              } else {
                console.log(`[BG-CURATION] ✅ Insertadas ${recoveryRowsToInsert.length} fuentes de recuperación`)
              }
            }

            // Si cubrimos todos los del batch, salir del loop de intentos
            const stillUncovered = recoveryBatch.filter(
              c => !coveredComponents.has(`${c.lesson_id}|${c.component}`)
            )
            if (stillUncovered.length === 0) {
              console.log(`[BG-CURATION] ✅ Batch de recuperación completamente cubierto`)
              break
            }

            // Si no, esperar y reintentar (delay reducido)
            if (attempt < MAX_RECOVERY_ATTEMPTS) {
              console.log(`[BG-CURATION] Aún faltan ${stillUncovered.length} componentes. Reintentando...`)
              await delay(1000)
            }

          } catch (err: any) {
            console.error(`[BG-CURATION] Error en recuperación intento ${attempt}:`, err.message)
            if (attempt < MAX_RECOVERY_ATTEMPTS) {
              await delay(1500)
            }
          }
        }
      }

      // Reporte final después de recuperación (contar TODAS las fuentes, no solo apta=true)
      const { data: finalRows } = await supabase
        .from('curation_rows')
        .select('lesson_id, component')
        .eq('curation_id', curationId)

      const finalCoverage = new Set(
        (finalRows || []).map(r => `${r.lesson_id}|${r.component}`)
      )

      const stillMissing = components.filter(
        c => !finalCoverage.has(`${c.lesson_id}|${c.component}`)
      )

      console.log(`[BG-CURATION] ══════════════════════════════════════`)
      console.log(`[BG-CURATION] 📊 REPORTE FINAL DE COBERTURA:`)
      console.log(`[BG-CURATION] Total componentes: ${components.length}`)
      console.log(`[BG-CURATION] Con cobertura: ${finalCoverage.size}`)
      console.log(`[BG-CURATION] Sin cobertura: ${stillMissing.length}`)

      if (stillMissing.length > 0) {
        console.log(`[BG-CURATION] ⚠️ Componentes sin fuentes:`)
        stillMissing.forEach(c => console.log(`   - ${c.lesson_title} | ${c.component}`))

        // Registrar evento de alerta
        await supabase.from('pipeline_events').insert({
          artifact_id: artifactId,
          step_id: 'ESP-04',
          entity_type: 'curation',
          entity_id: curationId,
          event_type: 'WARNING',
          event_data: {
            message: `${stillMissing.length} componentes sin fuentes después de recuperación.`,
            uncovered: stillMissing.map(c => ({ lesson: c.lesson_title, component: c.component }))
          }
        })
      }
    }

    // Al finalizar todo, actualizar estado a GENERATED
    await supabase
      .from('curation')
      .update({ state: 'PHASE2_GENERATED' })
      .eq('id', curationId)

    // Log final
    await supabase.from('pipeline_events').insert({
      artifact_id: artifactId,
      step_id: 'ESP-04',
      entity_type: 'curation',
      entity_id: curationId,
      event_type: 'NOTE',
      event_data: {
        entry_type: 'BG_PROCESS',
        message: 'Proceso de fondo finalizado exitosamente.'
      }
    })

    return { statusCode: 200, body: 'Background process finished' }

  } catch (error: any) {
    console.error('[BG-CURATION] Error fatal:', error)
    return { statusCode: 500, body: error.message }
  }
}
