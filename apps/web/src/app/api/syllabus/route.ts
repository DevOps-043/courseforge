import { NextRequest, NextResponse } from 'next/server'
import { COURSE_CONFIG, SYLLABUS_PROMPT } from '@/domains/syllabus/config/syllabus.config'

// Detectar si estamos en Netlify (producción) o local (desarrollo)
const IS_NETLIFY = process.env.NETLIFY === 'true' || process.env.CONTEXT !== undefined

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
      console.log('[API/ESP-02] Modo Netlify - Iniciando background function...')
      const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'https://cursos-nocode-v1.netlify.app'
      const backgroundUrl = `${siteUrl}/.netlify/functions/syllabus-generation-background`

      fetch(backgroundUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifactId, objetivos, ideaCentral, route, accessToken })
      }).catch(err => console.error('[API/ESP-02] Background error:', err))

      return NextResponse.json({
        status: 'processing',
        message: 'Generación de temario iniciada en background',
        artifactId
      })
    }

    // [LOCAL LOGIC - Direct Execution]
    console.log('[API/ESP-02] Modo local - Ejecutando generación directa...')
    
    // Importación dinámica
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    
    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'API key no configurada' }, { status: 500 })

    const genAI = new GoogleGenerativeAI(apiKey)

    // --- PASO 1: INVESTIGACIÓN con MOdelo Rápido (Flash 2.0) ---
    // Usamos el modelo SEARCH definido en env, o fallback a gemini-2.0-flash
    const searchModelName = process.env.GEMINI_SEARCH_MODEL || 'gemini-2.0-flash'
    console.log(`[API/ESP-02] Pasos 1: Investigando con ${searchModelName} + Google Search...`)

    const searchModel = genAI.getGenerativeModel({
      model: searchModelName,
      tools: [{ googleSearch: {} }] // Search activado
    })

    const researchPrompt = `Investiga en profundidad sobre el tema: "${ideaCentral}".
    Objetivos del curso: ${objetivos.join(', ')}.
    Identifica:
    1. Tendencias actuales del mercado para este tema.
    2. Conceptos clave obligatorios.
    3. Estructura lógica recomendada.
    Dame un resumen denso y técnico.`

    let researchContext = ""
    try {
      const researchResult = await searchModel.generateContent(researchPrompt)
      researchContext = researchResult.response.text()
      console.log(`[API/ESP-02] Investigación completada (${researchContext.length} chars).`)
    } catch (err) {
      console.warn("[API/ESP-02] Falló la investigación con Flash, continuando sin contexto extra.", err)
      researchContext = "No se pudo realizar investigación previa."
    }


    // --- PASO 2: ESTRUCTURACIÓN con Modelo Potente (Pro 3) ---
    // Usamos el modelo MAIN definido en env. FALLBACK PROHIBIDO A 1.5.
    // Asumimos que GEMINI_MODEL tiene el valor correcto (ej. 'gemini-3-flash-preview' o similar).
    const mainModelName = process.env.GEMINI_MODEL
    
    if (!mainModelName) {
      throw new Error("GEMINI_MODEL no está configurado en .env. Se requiere un modelo Pro/3.")
    }
    
    console.log(`[API/ESP-02] Paso 2: Generando estructura con ${mainModelName}...`)

    const mainModel = genAI.getGenerativeModel({
      model: mainModelName,
      // Nota: Le quitamos Search a este paso para que se base en el contexto que le damos
      // y se "obligue" a estructurar en lugar de distraerse buscando de nuevo.
      // O BIEN, se lo dejamos como backup. El usuario pidió search en flash.
      tools: [], 
      generationConfig: {
        temperature: parseFloat(process.env.GEMINI_TEMPERATURE || '0.7'),
        responseMimeType: "application/json"
      }
    })

    // Preparar el contexto enriquecido
    const baseRouteContext = route === 'A_WITH_SOURCE'
      ? 'El contenido debe ser estructurado y formal, basado en fuentes académicas.'
      : 'Genera el contenido desde cero basándote en las mejores prácticas del tema.'
    
    // AQUÍ ESTÁ EL TRUCO: Inyectamos la investigación DENTRO de la variable routeContext
    const enrichedContext = `${baseRouteContext}\n\n### INVESTIGACIÓN RECIENTE (Usar como base de conocimiento):\n${researchContext}`

    const objetivosStr = objetivos.map((obj: string, i: number) => `${i + 1}. ${obj}`).join('\n')

    // Usamos el prompt EXACTO importado
    const finalPrompt = SYLLABUS_PROMPT
      .replace('{{ideaCentral}}', ideaCentral)
      .replace('{{objetivos}}', objetivosStr)
      .replace('{{routeContext}}', enrichedContext) // Inyección mágica
      .replace(/{{.*?}}/g, '')

    // Generar
    const result = await mainModel.generateContent(finalPrompt)
    const response = await result.response
    const responseText = response.text()
    
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

    // Cálculos post-generación
    const totalLessons = content.modules.reduce((acc: number, m: any) => acc + m.lessons.length, 0)
    const estimatedHours = (totalLessons * COURSE_CONFIG.avgLessonMinutes) / 60
    content.total_estimated_hours = Math.round(estimatedHours * 10) / 10

    // Guardar metadata de la investigación para depuración/UI
    content.generation_metadata = {
      ...content.generation_metadata,
      research_summary: researchContext.substring(0, 300) + '...',
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
