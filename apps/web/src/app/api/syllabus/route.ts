import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai'
import { COURSE_CONFIG, SYLLABUS_PROMPT } from '@/domains/syllabus/config/syllabus.config'

// Detectar si estamos en Netlify (producción) o local (desarrollo)
// En runtime de Netlify, NEXT_PUBLIC_... a veces es más fiable, o NODE_ENV
const IS_NETLIFY = process.env.NETLIFY === 'true' || process.env.NODE_ENV === 'production'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { objetivos, ideaCentral, route, artifactId, accessToken } = body

    if (!objetivos || !ideaCentral) {
      return NextResponse.json(
        { error: 'objetivos e ideaCentral son requeridos' },
        { status: 400 }
      )
    }

    // [NETLIFY LOGIC - Production Background Jobs]
    if (IS_NETLIFY) {
      const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'https://cursos-nocode-v1.netlify.app'
      const backgroundUrl = `${siteUrl}/.netlify/functions/syllabus-generation-background`
      
      console.log(`[API/ESP-02] Modo Netlify Detectado. Disparando Background Function a: ${backgroundUrl}`)

      // AWAIT obligatorio en serverless para asegurar que el request salga antes de morir
      try {
        await fetch(backgroundUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artifactId, objetivos, ideaCentral, route, accessToken })
        })
        console.log('[API/ESP-02] Fetch enviado correctamente.')
      } catch (err) {
        console.error('[API/ESP-02] CRITICAL: Falló fetch a background:', err)
        // No lanzamos error para no romper la UI, pero logueamos fuerte
      }

      return NextResponse.json({
        status: 'processing',
        message: 'Generación de temario iniciada en background',
        artifactId
      })
    }

    // [LOCAL LOGIC - Direct Execution]
    console.log('[API/ESP-02] Modo local - Ejecutando generación directa...')

    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY
    if (!apiKey) {
        console.error(" [API/ESP-02] CRITICAL: GOOGLE_API_KEY missing");
        return NextResponse.json({ error: 'API key no configurada' }, { status: 500 })
    }
    console.log(" [API/ESP-02] API Key found. Initializing GoogleGenAI (new SDK)...");

    // Nuevo SDK @google/genai para Google Search Grounding
    const genAI = new GoogleGenAI({ apiKey })

    // --- PASO 1: INVESTIGACIÓN con Modelo Rápido (Flash 2.0) ---
    const searchModelName = process.env.GEMINI_SEARCH_MODEL || 'gemini-2.0-flash'
    console.log(`[API/ESP-02] Paso 1: Configurando modelo ${searchModelName} con Google Search...`)

    const researchPrompt = `Investiga en profundidad sobre el tema: "${ideaCentral}".
    Objetivos del curso: ${objetivos.join(', ')}.
    Identifica:
    1. Tendencias actuales del mercado para este tema.
    2. Conceptos clave obligatorios.
    3. Estructura lógica recomendada.
    Dame un resumen denso y técnico.`

    let researchContext = ""
    let researchMetadata: any = null

    try {
      // Nueva API de @google/genai con Google Search Grounding
      const researchResult = await genAI.models.generateContent({
        model: searchModelName,
        contents: researchPrompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.7
        }
      })

      researchContext = researchResult.text || ''

      // Capturar metadata de fuentes (links, queries)
      researchMetadata = researchResult.candidates?.[0]?.groundingMetadata

      // Log de grounding para debug
      const searchQueries = researchMetadata?.webSearchQueries || []
      const groundingChunks = researchMetadata?.groundingChunks || []
      console.log(`[API/ESP-02] ✅ Investigación completada (${researchContext.length} chars).`)
      console.log(`[API/ESP-02] Búsquedas ejecutadas: ${searchQueries.length}`, searchQueries)
      console.log(`[API/ESP-02] URLs de grounding: ${groundingChunks.length}`)
    } catch (err) {
      console.warn("[API/ESP-02] Falló la investigación con Flash, continuando sin contexto extra.", err)
      researchContext = "No se pudo realizar investigación previa."
    }

    // --- PASO 2: ESTRUCTURACIÓN con Modelo Potente (Pro 3) ---
    const mainModelName = process.env.GEMINI_MODEL

    if (!mainModelName) {
      throw new Error("GEMINI_MODEL no está configurado en .env. Se requiere un modelo Pro/3.")
    }

    console.log(`[API/ESP-02] Paso 2: Generando estructura con ${mainModelName}...`)

    // Preparar el contexto enriquecido
    const baseRouteContext = route === 'A_WITH_SOURCE'
      ? 'El contenido debe ser estructurado y formal, basado en fuentes académicas.'
      : 'Genera el contenido desde cero basándote en las mejores prácticas del tema.'
    
    const enrichedContext = `${baseRouteContext}\n\n### INVESTIGACIÓN RECIENTE (Usar como base de conocimiento):\n${researchContext}`

    const objetivosStr = objetivos.map((obj: string, i: number) => `${i + 1}. ${obj}`).join('\n')

    const finalPrompt = SYLLABUS_PROMPT
      .replace('{{ideaCentral}}', ideaCentral)
      .replace('{{objetivos}}', objetivosStr)
      .replace('{{routeContext}}', enrichedContext)
      .replace(/{{.*?}}/g, '')

    // Generar con nueva API (sin Google Search, solo estructuración)
    const result = await genAI.models.generateContent({
      model: mainModelName,
      contents: finalPrompt,
      config: {
        temperature: parseFloat(process.env.GEMINI_TEMPERATURE || '0.7'),
        responseMimeType: "application/json"
      }
    })
    const responseText = result.text || ''
    
    // Parsing JSON
    const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/)
    const finalJson = jsonMatch ? jsonMatch[0] : cleanJson
    
    let content
    try {
      content = JSON.parse(finalJson)
    } catch (e) {
      console.error("Error parseando JSON de IA:", finalJson)
      throw new Error("La IA no devolvió un JSON válido")
    }

    // Cálculos post-generación (Mantener igual)
    const totalLessons = content.modules.reduce((acc: number, m: any) => acc + m.lessons.length, 0)
    const estimatedHours = (totalLessons * COURSE_CONFIG.avgLessonMinutes) / 60
    content.total_estimated_hours = Math.round(estimatedHours * 10) / 10

    // Guardar metadata de la investigación para depuración/UI
    const searchQueries = researchMetadata?.webSearchQueries || [];

    content.generation_metadata = {
      ...content.generation_metadata,
      research_summary: researchContext,
      search_queries: searchQueries, // <--- Mapeo correcto para la UI
      search_sources: researchMetadata, 
      models_used: { search: searchModelName, architect: mainModelName }
    }

    console.log('[API/ESP-02] Generado exitosamente:', content.modules?.length, 'módulos')
    
    return NextResponse.json(content)

  } catch (error: any) {
    console.error('[API/ESP-02] Error:', error.message)
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
