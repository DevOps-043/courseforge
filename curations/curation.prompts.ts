// Prompts para ESP-04: Curaduría de Fuentes
// Cada versión tiene un prompt base diferente

export type CurationPromptVersion = 'default' | 'original' | 'adapted' | 'custom'

export interface CurationPromptConfig {
  id: CurationPromptVersion
  label: string
  description: string
  features?: string[]
  useCase?: string
  differences?: string
}

export const CURATION_PROMPTS: Record<Exclude<CurationPromptVersion, 'custom'>, CurationPromptConfig> = {
  default: {
    id: 'default',
    label: 'Prompt Actual (Sistema)',
    description: 'Prompt optimizado integrado en el sistema',
    features: [
      'Lista completa de fuentes preferidas (Wikipedia, Medium, .edu, TED, etc.)',
      'YouTube EXCLUIDO - No se usarán videos de YouTube',
      'Lista detallada de fuentes a evitar (paywalls, errores frecuentes)',
      'Dominios con errores conocidos documentados',
      'Soporte para iteración dirigida (intento 2 con gaps)',
      'Validación automática de URLs accesibles'
    ],
    useCase: 'Uso recomendado. Incluye listas actualizadas de fuentes válidas e inválidas basadas en experiencia del sistema.',
    differences: 'Versión optimizada con conocimiento acumulado sobre qué fuentes funcionan y cuáles fallan frecuentemente.'
  },
  original: {
    id: 'original',
    label: 'prompt04.txt (Original)',
    description: 'Prompt original en formato Markdown con tablas',
    features: [
      'Formato Markdown completo con estructura FASE 2',
      'Incluye Bitácora En Vivo para trazabilidad',
      'Documentación de reglas de accesibilidad',
      'Guías sobre fuentes preferidas y a evitar',
      'Soporte para iteración dirigida'
    ],
    useCase: 'Ideal cuando necesitas el contexto completo de la Fase 2, incluyendo documentación de trazabilidad y bitácora.',
    differences: 'Versión original con documentación completa de la Fase 2, incluyendo conceptos de bitácora y trazabilidad.'
  },
  adapted: {
    id: 'adapted',
    label: 'prompt04_adaptado.txt (JSON)',
    description: 'Prompt adaptado para output JSON estructurado',
    features: [
      'Enfoque estricto en output JSON puro',
      'Validaciones explícitas de estructura de datos',
      'Reglas de cero descargables obligatorios',
      'Estructura JSON con campos obligatorios definidos',
      'Soporte para gaps y iteración dirigida'
    ],
    useCase: 'Recomendado cuando necesitas garantizar estructura JSON perfecta y validaciones estrictas de fuentes.',
    differences: 'Versión adaptada específicamente para JSON con validaciones estrictas y estructura de datos bien definida.'
  }
}

/**
 * Retorna todas las opciones de prompt como array (para selectores)
 */
export function getAllCurationPromptConfigs(): CurationPromptConfig[] {
  return Object.values(CURATION_PROMPTS)
}

export interface CurationPromptParams {
  lessonsText: string
  courseName: string
  ideaCentral: string
  attemptNumber?: number
  gaps?: string[]
  customPrompt?: string
}

/**
 * Genera el prompt según la versión seleccionada
 * @param params.customPrompt - Si se proporciona, se usa en lugar del prompt predefinido
 */
export function getCurationPrompt(
  version: CurationPromptVersion,
  params: CurationPromptParams
): string {
  // Si hay prompt personalizado, usarlo directamente
  if (version === 'custom' && params.customPrompt) {
    return injectContextToCurationPrompt(params.customPrompt, params)
  }

  switch (version) {
    case 'original':
      return generateOriginalPrompt(params)
    case 'adapted':
      return generateAdaptedPrompt(params)
    default:
      return generateDefaultPrompt(params)
  }
}

/**
 * Inyecta el contexto en un prompt personalizado de curaduría
 */
function injectContextToCurationPrompt(
  customPrompt: string,
  params: CurationPromptParams
): string {
  const { lessonsText, courseName, ideaCentral, attemptNumber, gaps } = params
  let prompt = customPrompt

  // Reemplazar placeholders si existen
  const hasPlaceholders = prompt.includes('{{') || prompt.includes('${')

  if (hasPlaceholders) {
    prompt = prompt
      .replace(/\{\{COURSE_NAME\}\}|\$\{courseName\}/gi, courseName)
      .replace(/\{\{IDEA_CENTRAL\}\}|\$\{ideaCentral\}/gi, ideaCentral)
      .replace(/\{\{LESSONS_TEXT\}\}|\$\{lessonsText\}/gi, lessonsText)
      .replace(/\{\{ATTEMPT_NUMBER\}\}|\$\{attemptNumber\}/gi, String(attemptNumber || 1))
      .replace(/\{\{GAPS\}\}|\$\{gaps\}/gi, gaps?.join('\n') || '')
  } else {
    // Si no hay placeholders, agregar contexto al inicio
    let gapsContext = ''
    if (attemptNumber === 2 && gaps && gaps.length > 0) {
      gapsContext = `
**INTENTO 2 - GAPS A RESOLVER:**
${gaps.join('\n')}
`
    }

    const contextBlock = `
## CONTEXTO DEL CURSO

**CURSO:** ${courseName}
**IDEA CENTRAL:** ${ideaCentral}
**INTENTO:** ${attemptNumber || 1}

**COMPONENTES A CUBRIR:**
${lessonsText}
${gapsContext}
---

## TU PROMPT PERSONALIZADO

`
    prompt = contextBlock + prompt
  }

  return prompt
}

// ============================================================================
// PROMPT DEFAULT (Sistema actual)
// ============================================================================
function generateDefaultPrompt(params: CurationPromptParams): string {
  const { lessonsText, courseName, ideaCentral, attemptNumber, gaps } = params

  let gapsContext = ''
  if (attemptNumber === 2 && gaps && gaps.length > 0) {
    gapsContext = `

**INTENTO 2 - ITERACION DIRIGIDA**
En el intento anterior, los siguientes componentes quedaron sin fuentes adecuadas:
${gaps.join('\n')}

Por favor, enfócate especialmente en encontrar fuentes de calidad para estos componentes.`
  }

  return `Eres un experto en curaduría de contenido educativo. Para cada componente de cada lección, sugiere LA MEJOR fuente de alta calidad (solo 1 fuente por componente).

**CURSO:** ${courseName}
**IDEA CENTRAL:** ${ideaCentral}

**LECCIONES Y COMPONENTES A CUBRIR:**
${lessonsText}
${gapsContext}

**TIPOS DE FUENTES RECOMENDADAS:**
- DIALOGUE: Artículos, videos, podcasts sobre el tema
- READING: Libros, papers, guías, documentación oficial
- QUIZ: Bancos de preguntas, ejercicios de evaluación
- DEMO_GUIDE: Tutoriales paso a paso, videos demostrativos
- EXERCISE: Ejercicios prácticos, casos de estudio

**FUENTES PREFERIDAS (acceso abierto - USAR ESTAS):**
- Wikipedia y Wikimedia
- Medium y blogs técnicos abiertos
- Sitios .edu y universidades públicas
- Documentación oficial de herramientas
- GitHub y repositorios públicos
- Khan Academy, Coursera (contenido gratuito)
- Blogs de empresas tecnológicas (Google, Microsoft, AWS)
- Sitios gubernamentales (.gov, .gob)
- TED Talks y plataformas de conferencias académicas

**FUENTES A EVITAR (paywall/login/errores frecuentes - NO USAR):**
- YouTube (youtube.com, youtu.be) - PROHIBIDO - No usar videos de YouTube
- Harvard Business Review (hbr.org) - requiere suscripción
- Forbes - muchos artículos con paywall
- Gartner - requiere cuenta corporativa
- ResearchGate - requiere login para descargar
- MIT Sloan Review - paywall
- Wall Street Journal, NYT, Financial Times
- McKinsey, BCG, Bain (reportes de consultoría)
- Inc.com - paywall frecuente
- Prosci - contenido gated
- LinkedIn Learning - requiere suscripción

**DOMINIOS CON ERRORES FRECUENTES (NO USAR - URLs rotas):**
- es.educaplay.com - La mayoría de URLs dan 404
- daypo.com / es.daypo.com - Errores de conexión frecuentes
- psicoactiva.com - Tests dan 404
- gestiopolis.com - Artículos antiguos dan 404
- wordwall.net - Recursos dan 404
- quizlet.com - Bloquea con 403
- quizizz.com - Errores de fetch
- scielo.org - PDFs frecuentemente dan 404
- about.gitlab.com/handbook - Estructura cambió, 404s
- web.archive.org - Muchos snapshots no disponibles
- docs.google.com/spreadsheets - Frecuentemente restringidos

**REGLAS:**
1. Sugiere SOLO fuentes de acceso abierto y gratuito
2. Las URLs deben ser COMPLETAS (no truncadas con "...")
3. Para cada fuente, incluye una breve justificación de por qué es relevante
4. Prioriza fuentes en español cuando existan
5. Para componentes CRÍTICOS, sugiere al menos 3 fuentes de alta calidad
6. Incluye variedad: libros, artículos web, videos, recursos interactivos
7. Verifica mentalmente que la URL sea accesible públicamente

**FORMATO JSON (sin markdown, solo JSON):**
{
  "sources_by_lesson": [
    {
      "lesson_id": "ID exacto de la lección",
      "lesson_title": "Título de la lección",
      "components": [
        {
          "component_name": "DIALOGUE",
          "is_critical": true,
          "candidate_sources": [
            {
              "title": "Nombre del recurso",
              "url": "URL o referencia",
              "rationale": "Por qué esta fuente es relevante para este componente"
            }
          ]
        }
      ]
    }
  ]
}

Responde SOLO con JSON válido.`
}

// ============================================================================
// PROMPT ORIGINAL (prompt04.txt - formato Markdown)
// ============================================================================
function generateOriginalPrompt(params: CurationPromptParams): string {
  const { lessonsText, courseName, ideaCentral, attemptNumber, gaps } = params

  let gapsContext = ''
  if (attemptNumber === 2 && gaps && gaps.length > 0) {
    gapsContext = `

**INTENTO 2 - ITERACIÓN DIRIGIDA**
Gaps detectados del intento anterior:
${gaps.join('\n')}

Enfócate en resolver estos gaps con fuentes alternativas.`
  }

  return `# PROMPT 2/3 — FASE 2: Curaduría y trazabilidad (Fuentes + Bitácora)

Actúa como **controlador instruccional y documentalista** para un curso de microlearning de IA.

Estás ejecutando la **FASE 2 de 3** (Plan → Curaduría → Producción).

Tu misión en esta fase:

Seleccionar **fuentes válidas y usables sin descarga obligatoria** para cada lección, y documentar el uso de IA en una **Bitácora En Vivo**.

---

## 0. Insumos

**CURSO:** ${courseName}
**IDEA CENTRAL:** ${ideaCentral}

**LECCIONES Y COMPONENTES:**
${lessonsText}
${gapsContext}

---

## 1. Reglas globales que debes respetar

1. **Formato**
   - **IMPORTANTE: Para integración con el sistema, responde con JSON válido.**
   - La estructura JSON debe seguir el formato especificado abajo.

2. **Componentes obligatorios por lección**
   - Toda lección debe contar con fuentes para:
     - **Diálogo con Lia** (DIALOGUE)
     - **Lectura/Audio** (READING)
     - **Cuestionario final** (QUIZ)
   - En esta fase, tu foco es encontrar/definir **fuentes** que alimenten estos componentes.

3. **Cero descargables obligatorios**
   - Solo acepta fuentes que NO requieran descarga obligatoria de archivos.
   - Si una fuente clave requiere descarga → descártala o márcala como NO aceptable.

4. **Accesibilidad**
   - Preferir fuentes accesibles en pantalla (texto, video embebible, etc.).
   - Evitar recursos que dependan exclusivamente de elementos visuales no describibles.

5. **FUENTES PREFERIDAS (acceso abierto - USAR ESTAS):**
   - Wikipedia y Wikimedia
   - Medium y blogs técnicos abiertos
   - Sitios .edu y universidades públicas
   - Documentación oficial de herramientas
   - Khan Academy, Coursera (contenido gratuito)
   - Blogs de empresas tecnológicas (Google, Microsoft, AWS)
   - TED Talks y plataformas de conferencias académicas

6. **FUENTES A EVITAR (paywall/login - NO USAR):**
   - YouTube (youtube.com, youtu.be) - PROHIBIDO
   - Harvard Business Review (hbr.org), Forbes, Gartner
   - ResearchGate, MIT Sloan Review, Inc.com
   - Wall Street Journal, NYT, Financial Times
   - McKinsey, BCG, Bain, Prosci, LinkedIn Learning

7. **DOMINIOS CON ERRORES (NO USAR - URLs rotas frecuentes):**
   - es.educaplay.com, daypo.com, psicoactiva.com
   - gestiopolis.com, wordwall.net, quizlet.com
   - quizizz.com, scielo.org, about.gitlab.com/handbook
   - web.archive.org, docs.google.com/spreadsheets

8. **URLs COMPLETAS**
   - Las URLs deben ser completas, NO truncadas con "..."
   - Verifica mentalmente que la URL sea accesible públicamente

---

## 2. Tareas de la FASE 2

### 2.1 Selección y organización de fuentes por lección

Para **cada lección** definida:

1. Identifica **1 fuente de alta calidad** por componente:
   - **Fuentes — DIALOGUE** (para diálogo con Lia)
   - **Fuentes — READING** (para lectura/audio)
   - **Fuentes — QUIZ** (para cuestionario)
   - **Fuentes — DEMO_GUIDE** (si aplica)

2. Para cada fuente candidata, incluye:
   - **title**: Nombre descriptivo del recurso
   - **url**: URL completa o referencia
   - **rationale**: Por qué aporta pedagógicamente
   - **type**: Tipo (video, artículo, documentación, guía, blog, etc.)
   - **requires_download**: true/false
   - **is_acceptable**: true si no requiere descarga

### 2.2 Filtrado según licencia y descargas

Para cada fuente:
- Verifica si se puede usar en contexto educativo
- Si requiere descarga obligatoria → marca \`requires_download: true\` y \`is_acceptable: false\`

---

## 3. Definition of Done (FASE 2)

- Para cada lección: existe **1 fuente válida** por componente crítico.
- Para todas las fuentes aceptadas: \`requires_download: false\` y \`is_acceptable: true\`.
- No quedan dependencias críticas sin alternativa.

---

## 4. Formato de salida JSON (OBLIGATORIO)

{
  "sources_by_lesson": [
    {
      "lesson_id": "ID exacto de la lección",
      "lesson_title": "Título de la lección",
      "components": [
        {
          "component_name": "DIALOGUE|READING|QUIZ|DEMO_GUIDE|EXERCISE",
          "is_critical": true,
          "candidate_sources": [
            {
              "title": "Nombre descriptivo del recurso",
              "url": "URL completa y verificable",
              "rationale": "Por qué esta fuente es relevante para este componente",
              "type": "video|artículo|documentación|guía|blog|podcast|libro",
              "fragment_to_use": "Qué parte exacta será útil (opcional)",
              "license": "Licencia o términos (opcional)",
              "requires_attribution": true,
              "citation_format": "Formato breve de cita (opcional)",
              "requires_download": false,
              "is_acceptable": true
            }
          ]
        }
      ]
    }
  ],
  "bitacora": [
    {
      "fecha": "AAAA-MM-DD",
      "modelo_version": "Gemini 1.5 Flash",
      "rol_plantilla": "Prompt Fase 2 - Curaduría",
      "input_prompt": "Resumen del prompt usado",
      "salida_resumen": "Resumen de lo generado",
      "link": "—",
      "parametros": "temperatura: 0.7",
      "estado_proximo_paso": "Aprobado|Revisar|Descartado"
    }
  ]
}

Responde SOLO con JSON válido, sin markdown ni texto adicional.`
}

// ============================================================================
// PROMPT ADAPTADO (prompt04_adaptado.txt - JSON estructurado)
// ============================================================================
function generateAdaptedPrompt(params: CurationPromptParams): string {
  const { lessonsText, courseName, ideaCentral, attemptNumber, gaps } = params

  let gapsSection = ''
  if (attemptNumber === 2 && gaps && gaps.length > 0) {
    gapsSection = `

### 2.3 Generación dirigida para gaps (Intento 2)

Si \`attemptNumber === 2\` y hay \`gaps\`:

- Enfócate ESPECIALMENTE en encontrar fuentes de reemplazo para los componentes listados en \`gaps\`.
- Las URLs DEBEN ser reales y accesibles públicamente SIN login ni pago.
- NO uses URLs de ejemplo o placeholders.
- SOLO usa fuentes de acceso abierto: YouTube, Wikipedia, Medium, sitios .edu, .gov, Khan Academy.
- EVITA sitios con paywall: HBR, Forbes, Gartner, ResearchGate, MIT Sloan, Inc.com, Prosci.
- Si el gap es por AUTH_REQUIRED o HTTP_403, busca alternativas 100% gratuitas y abiertas.
- SOLO genera fuentes para los gaps listados, NO para otros componentes.
- Las URLs deben ser COMPLETAS, no truncadas con "..."

**GAPS A RESOLVER:**
${gaps.join('\n')}`
  }

  return `# PROMPT 2/3 — FASE 2: Curaduría y trazabilidad (Fuentes + Bitácora) - ADAPTADO PARA SISTEMA

Actúa como **controlador instruccional y documentalista** para un curso de microlearning de IA.

Estás ejecutando la **FASE 2 de 3** (Plan → Curaduría → Producción).

Tu misión en esta fase:

Seleccionar **fuentes válidas y usables sin descarga obligatoria** para cada lección, y documentar el uso de IA en una **Bitácora En Vivo**.

---

## 0. Insumos

**CURSO:** ${courseName}
**IDEA CENTRAL:** ${ideaCentral}
**INTENTO:** ${attemptNumber || 1}

**COMPONENTES A CUBRIR:**
${lessonsText}

---

## 1. Reglas globales que debes respetar

1. **Formato**
   - **IMPORTANTE: Responde SOLO con JSON válido.**
   - No uses Markdown, tablas o texto fuera del JSON.
   - La estructura JSON debe ser exactamente la especificada en la sección 4.

2. **Componentes obligatorios por lección**
   - Toda lección debe contar con fuentes para:
     - **DIALOGUE** (Diálogo con Lia)
     - **READING** (Lectura/Audio)
     - **QUIZ** (Cuestionario final)
   - Además, según el plan instruccional, puede haber:
     - **DEMO_GUIDE** (Guía de demostración)
     - **EXERCISE** (Ejercicio práctico)

3. **Cero descargables obligatorios**
   - Solo acepta fuentes que NO requieran descarga obligatoria de archivos.
   - Si una fuente clave requiere descarga → NO la incluyas o márcala con \`requires_download: true\` y \`is_acceptable: false\`.

4. **Accesibilidad**
   - Preferir fuentes accesibles en pantalla (texto, video embebible, etc.).
   - Evitar recursos que dependan exclusivamente de elementos visuales no describibles.

   - Para cada componente, sugiere **1 fuente candidata** de alta calidad (la mejor que encuentres).
   - Para componentes CRÍTICOS (\`is_critical: true\`), sugiere al menos **3 fuentes**.

6. **FUENTES PREFERIDAS (acceso abierto - USAR ESTAS):**
   - Wikipedia y Wikimedia
   - Medium y blogs técnicos abiertos
   - Sitios .edu y universidades públicas
   - Documentación oficial de herramientas
   - GitHub y repositorios públicos
   - Khan Academy, Coursera (contenido gratuito)
   - Blogs de empresas tecnológicas (Google, Microsoft, AWS)
   - Sitios gubernamentales (.gov, .gob)
   - TED Talks y plataformas de conferencias académicas

7. **FUENTES A EVITAR (paywall/login - NO USAR):**
   - YouTube (youtube.com, youtu.be) - PROHIBIDO - No usar videos de YouTube
   - Harvard Business Review (hbr.org) - requiere suscripción
   - Forbes - muchos artículos con paywall
   - Gartner - requiere cuenta corporativa
   - ResearchGate - requiere login para descargar
   - MIT Sloan Review - paywall
   - Wall Street Journal, NYT, Financial Times
   - McKinsey, BCG, Bain (reportes de consultoría)
   - Inc.com - paywall frecuente
   - Prosci - contenido gated
   - LinkedIn Learning - requiere suscripción

8. **DOMINIOS CON ERRORES FRECUENTES (NO USAR - URLs rotas):**
   - es.educaplay.com - La mayoría de URLs dan 404
   - daypo.com / es.daypo.com - Errores de conexión frecuentes
   - psicoactiva.com - Tests dan 404
   - gestiopolis.com - Artículos antiguos dan 404
   - wordwall.net - Recursos dan 404
   - quizlet.com - Bloquea con 403
   - quizizz.com - Errores de fetch
   - scielo.org - PDFs frecuentemente dan 404
   - about.gitlab.com/handbook - Estructura cambió, 404s
   - web.archive.org - Muchos snapshots no disponibles
   - docs.google.com/spreadsheets - Frecuentemente restringidos

9. **URLs COMPLETAS**
   - Las URLs deben ser COMPLETAS, NO truncadas con "..."
   - Verifica mentalmente que cada URL sea accesible públicamente

---

## 2. Tareas de la FASE 2

### 2.1 Selección y organización de fuentes por lección

Para **cada componente** recibido:

1. Identifica **1 fuente candidata** de acceso abierto (la mejor que encuentres).

2. Para cada fuente, incluye:
   - **title**: Nombre descriptivo del recurso
   - **url**: URL completa y verificable (o referencia si no hay URL)
   - **rationale**: Razón pedagógica de por qué es relevante
   - **type**: Tipo de fuente (video, artículo, documentación, guía, blog, podcast, etc.)
   - **fragment_to_use**: Qué parte exacta será útil (sección, minuto, párrafo, idea) - opcional
   - **license**: Licencia o términos (ej: "CC BY-SA", "Documentación oficial", "Propia", "Fair Use") - opcional
   - **requires_attribution**: Si requiere atribución (true/false) - opcional
   - **citation_format**: Formato breve de cita recomendada - opcional
   - **requires_download**: Si requiere descarga obligatoria (true/false)
   - **is_acceptable**: Si es aceptable para uso (false si requires_download es true)

3. Prioriza:
   - Fuentes REALES y verificables cuando sea posible
   - Fuentes en español cuando existan
   - Variedad: libros, artículos web, videos, recursos interactivos
   - Fuentes accesibles sin descarga obligatoria

### 2.2 Filtrado según licencia y descargas

Para cada fuente:

1. Verifica (o razona) sobre su **licencia/Terms**:
   - ¿Se puede usar en contexto educativo?
   - ¿Se requiere atribución?

2. Evalúa **requires_download**:
   - Si requiere descargar un archivo como condición para obtener el contenido (p.ej. solo disponible en PDF descargable, ZIP, dataset, etc.) y no hay alternativa:
     - Marca \`requires_download: true\` y \`is_acceptable: false\`.
   - Prioriza siempre fuentes con \`requires_download: false\` y \`is_acceptable: true\`.
${gapsSection}

---

## 3. Definition of Done (FASE 2)

- Para **cada componente** recibido: existe **1 fuente candidata** de alta calidad.
- Para **todas las fuentes aceptadas**: \`requires_download: false\` y \`is_acceptable: true\`.
- La licencia/Terms está informada (si es posible determinarla).
- No quedan dependencias críticas que violen la política de "cero descargables obligatorios" sin estar claramente marcadas como \`is_acceptable: false\`.

---

## 4. Formato de salida JSON (OBLIGATORIO)

{
  "sources_by_lesson": [
    {
      "lesson_id": "ID exacto de la lección",
      "lesson_title": "Título de la lección",
      "components": [
        {
          "component_name": "DIALOGUE|READING|QUIZ|DEMO_GUIDE|EXERCISE",
          "is_critical": true,
          "candidate_sources": [
            {
              "title": "Nombre descriptivo del recurso",
              "url": "URL completa y verificable",
              "rationale": "Por qué esta fuente es relevante para este componente",
              "type": "video|artículo|documentación|guía|blog|podcast|libro",
              "fragment_to_use": "Qué parte exacta será útil (opcional)",
              "license": "Licencia o términos (opcional)",
              "requires_attribution": true,
              "citation_format": "Formato breve de cita (opcional)",
              "requires_download": false,
              "is_acceptable": true
            }
          ]
        }
      ]
    }
  ],
  "bitacora": [
    {
      "fecha": "AAAA-MM-DD",
      "modelo_version": "Gemini 1.5 Flash",
      "rol_plantilla": "Prompt Fase 2 - Curaduría",
      "input_prompt": "Resumen del prompt usado",
      "salida_resumen": "Resumen de lo generado",
      "link": "—",
      "parametros": "temperatura: 0.7",
      "estado_proximo_paso": "Aprobado|Revisar|Descartado"
    }
  ]
}

**REGLAS CRÍTICAS DEL JSON:**

1. **sources_by_lesson** debe contener una entrada por cada \`lesson_id\` único en los componentes recibidos.
2. **components** dentro de cada lección debe incluir TODOS los componentes recibidos para esa lección.
3. **candidate_sources** debe tener 1 fuente de alta calidad.
4. **url** debe ser una URL válida o referencia clara (no placeholders como "ejemplo.com").
5. **requires_download** y **is_acceptable** son obligatorios.
6. **bitacora** es opcional pero recomendado para trazabilidad.
7. NO uses campos adicionales fuera de los especificados.
8. NO incluyas texto fuera del JSON (ni explicaciones, ni Markdown, ni tablas).

**NOTAS IMPORTANTES:**

- Si un componente requiere fuentes pero no encuentras ninguna aceptable (sin descarga), incluye el componente con \`candidate_sources: []\` y documenta el problema en \`bitacora\`.
- Las URLs deben ser verificables. Si no puedes encontrar una URL real, usa una referencia descriptiva pero marca \`is_acceptable: false\` con razón en \`rationale\`.

---

**IMPORTANTE FINAL:** Responde SOLO con el JSON, sin texto adicional, sin Markdown, sin explicaciones fuera del JSON. El sistema parseará directamente el JSON y validará las URLs.`
}
