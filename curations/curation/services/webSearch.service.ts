// GO-ESP-04: Servicio de Búsqueda Web en Tiempo Real
// Soporta: Tavily API, Serper API (Google), Brave Search API

export type SearchProvider = 'tavily' | 'serper' | 'brave'

export interface SearchResult {
  title: string
  url: string
  snippet: string
  source?: string
  score?: number
}

export interface WebSearchOptions {
  provider?: SearchProvider
  maxResults?: number
  searchDepth?: 'basic' | 'advanced'
  includeAnswer?: boolean
  includeDomains?: string[]
  excludeDomains?: string[]
}

const DEFAULT_EXCLUDE_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'hbr.org',
  'forbes.com',
  'gartner.com',
  'researchgate.net',
  'wsj.com',
  'nytimes.com',
  'ft.com',
  'mckinsey.com',
  'bcg.com',
  'bain.com',
  'linkedin.com',
  'quizlet.com',
  'educaplay.com',
  'daypo.com'
]

const DEFAULT_INCLUDE_DOMAINS = [
  'wikipedia.org',
  'medium.com',
  'github.com',
  'dev.to',
  'stackoverflow.com',
  'docs.microsoft.com',
  'cloud.google.com',
  'aws.amazon.com',
  'mozilla.org',
  'w3schools.com',
  'freecodecamp.org',
  'coursera.org',
  'edx.org',
  'khanacademy.org',
  'ted.com'
]

/**
 * Búsqueda con Tavily API (recomendada para IA)
 * https://tavily.com - Diseñada específicamente para agentes de IA
 */
async function searchWithTavily(
  query: string,
  options: WebSearchOptions = {}
): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY no configurada en .env')
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: options.searchDepth || 'basic',
      include_answer: options.includeAnswer ?? false,
      max_results: options.maxResults || 5,
      include_domains: options.includeDomains || [],
      exclude_domains: [...DEFAULT_EXCLUDE_DOMAINS, ...(options.excludeDomains || [])]
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Tavily API error: ${response.status} - ${error}`)
  }

  const data = await response.json()

  return (data.results || []).map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: r.content || r.snippet || '',
    source: new URL(r.url).hostname,
    score: r.score
  }))
}

/**
 * Búsqueda con Serper API (resultados de Google)
 * https://serper.dev - API económica para Google Search
 */
async function searchWithSerper(
  query: string,
  options: WebSearchOptions = {}
): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY
  if (!apiKey) {
    throw new Error('SERPER_API_KEY no configurada en .env')
  }

  // Construir query con filtros de dominio
  let searchQuery = query
  
  // Agregar exclusiones al query
  const excludes = [...DEFAULT_EXCLUDE_DOMAINS, ...(options.excludeDomains || [])]
  excludes.forEach(domain => {
    searchQuery += ` -site:${domain}`
  })

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      q: searchQuery,
      num: options.maxResults || 5,
      hl: 'es', // Resultados en español
      gl: 'mx'  // Región México/Latinoamérica
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Serper API error: ${response.status} - ${error}`)
  }

  const data = await response.json()

  return (data.organic || []).map((r: any) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet || '',
    source: new URL(r.link).hostname,
    score: r.position ? 1 - (r.position / 10) : undefined
  }))
}

/**
 * Búsqueda con Brave Search API
 * https://brave.com/search/api/ - Alternativa privacy-first
 */
async function searchWithBrave(
  query: string,
  options: WebSearchOptions = {}
): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) {
    throw new Error('BRAVE_SEARCH_API_KEY no configurada en .env')
  }

  const params = new URLSearchParams({
    q: query,
    count: String(options.maxResults || 5),
    search_lang: 'es',
    country: 'mx'
  })

  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey
    }
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Brave Search API error: ${response.status} - ${error}`)
  }

  const data = await response.json()

  // Filtrar dominios excluidos
  const excludes = [...DEFAULT_EXCLUDE_DOMAINS, ...(options.excludeDomains || [])]
  
  return (data.web?.results || [])
    .filter((r: any) => {
      try {
        const hostname = new URL(r.url).hostname
        return !excludes.some(domain => hostname.includes(domain))
      } catch {
        return false
      }
    })
    .map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.description || '',
      source: new URL(r.url).hostname
    }))
}

/**
 * Función principal de búsqueda web
 * Detecta automáticamente qué API está configurada
 */
export async function searchWeb(
  query: string,
  options: WebSearchOptions = {}
): Promise<SearchResult[]> {
  // Detectar proveedor automáticamente si no se especifica
  let provider = options.provider

  if (!provider) {
    if (process.env.TAVILY_API_KEY) {
      provider = 'tavily'
    } else if (process.env.SERPER_API_KEY) {
      provider = 'serper'
    } else if (process.env.BRAVE_SEARCH_API_KEY) {
      provider = 'brave'
    } else {
      throw new Error(
        'No hay API de búsqueda configurada. Agrega TAVILY_API_KEY, SERPER_API_KEY o BRAVE_SEARCH_API_KEY en .env'
      )
    }
  }

  console.log(`[WebSearch] Usando proveedor: ${provider}`)
  console.log(`[WebSearch] Query: "${query}"`)

  switch (provider) {
    case 'tavily':
      return searchWithTavily(query, options)
    case 'serper':
      return searchWithSerper(query, options)
    case 'brave':
      return searchWithBrave(query, options)
    default:
      throw new Error(`Proveedor de búsqueda no soportado: ${provider}`)
  }
}

/**
 * Busca fuentes para un componente específico de una lección
 */
export async function searchSourcesForComponent(
  lessonTitle: string,
  componentType: string,
  courseName: string,
  options: WebSearchOptions = {}
): Promise<SearchResult[]> {
  // Construir query optimizado según tipo de componente
  const queryTemplates: Record<string, string> = {
    'DIALOGUE': `${lessonTitle} artículo explicación conceptos ${courseName}`,
    'READING': `${lessonTitle} guía tutorial lectura ${courseName}`,
    'QUIZ': `${lessonTitle} ejercicios preguntas evaluación ${courseName}`,
    'DEMO_GUIDE': `${lessonTitle} tutorial paso a paso demostración ${courseName}`,
    'EXERCISE': `${lessonTitle} ejercicios prácticos casos estudio ${courseName}`
  }

  const query = queryTemplates[componentType] || `${lessonTitle} ${componentType} ${courseName}`

  return searchWeb(query, {
    ...options,
    maxResults: options.maxResults || 5
  })
}

/**
 * Busca fuentes para múltiples componentes en paralelo
 */
export async function searchSourcesForLesson(
  lessonTitle: string,
  components: Array<{ component: string; is_critical: boolean }>,
  courseName: string,
  options: WebSearchOptions = {}
): Promise<Map<string, SearchResult[]>> {
  const results = new Map<string, SearchResult[]>()

  // Buscar en paralelo (limitado a 3 concurrent para no saturar APIs)
  const batchSize = 3
  for (let i = 0; i < components.length; i += batchSize) {
    const batch = components.slice(i, i + batchSize)
    const promises = batch.map(async (comp) => {
      try {
        const sources = await searchSourcesForComponent(
          lessonTitle,
          comp.component,
          courseName,
          {
            ...options,
            // Más resultados para componentes críticos
            maxResults: comp.is_critical ? 5 : 3
          }
        )
        return { component: comp.component, sources }
      } catch (error) {
        console.error(`[WebSearch] Error buscando ${comp.component}:`, error)
        return { component: comp.component, sources: [] }
      }
    })

    const batchResults = await Promise.all(promises)
    batchResults.forEach(({ component, sources }) => {
      results.set(component, sources)
    })
  }

  return results
}

/**
 * Verifica si hay alguna API de búsqueda configurada
 */
export function isWebSearchAvailable(): boolean {
  return !!(
    process.env.TAVILY_API_KEY ||
    process.env.SERPER_API_KEY ||
    process.env.BRAVE_SEARCH_API_KEY
  )
}

/**
 * Retorna qué proveedor está disponible
 */
export function getAvailableSearchProvider(): SearchProvider | null {
  if (process.env.TAVILY_API_KEY) return 'tavily'
  if (process.env.SERPER_API_KEY) return 'serper'
  if (process.env.BRAVE_SEARCH_API_KEY) return 'brave'
  return null
}
