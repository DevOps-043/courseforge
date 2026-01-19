// GO-ESP-04: Servicio de Validacion de URLs

import type { UrlStatus, UrlValidationResult, AutoNoAptaReason } from '../types/curation.types'
import { URL_STATUS_TO_REASON } from '../types/curation.types'

const TIMEOUT_MS = 10000 // 10 segundos

/**
 * Verifica si una URL esta truncada (contiene "..." o "…")
 */
export function isUrlTruncated(url: string): boolean {
  if (!url || typeof url !== 'string') return false
  return url.includes('...') || url.includes('…')
}

/**
 * Normaliza una URL:
 * - Agrega https:// si falta protocolo
 * - Detecta URLs truncadas con "..."
 * - Valida formato basico
 */
export function normalizeUrl(input: string): { url: string | null; error?: string; isTruncated?: boolean } {
  if (!input || typeof input !== 'string') {
    return { url: null, error: 'URL vacia o invalida' }
  }

  let url = input.trim()

  // Detectar URLs truncadas
  if (isUrlTruncated(url)) {
    return { url: null, error: 'URL truncada detectada', isTruncated: true }
  }

  // Si no tiene protocolo, agregar https://
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    // Si empieza con www., agregar https://
    if (url.startsWith('www.')) {
      url = 'https://' + url
    } else {
      // Intentar agregar https://
      url = 'https://' + url
    }
  }

  // Validar formato basico de URL
  try {
    const parsed = new URL(url)
    // Verificar que tenga host valido
    if (!parsed.hostname || parsed.hostname.length < 3) {
      return { url: null, error: 'Hostname invalido' }
    }
    // Verificar que el hostname tenga al menos un punto (excepto localhost)
    if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') {
      return { url: null, error: 'Hostname sin dominio valido' }
    }
    return { url: parsed.href }
  } catch {
    return { url: null, error: 'URL malformada' }
  }
}

/**
 * Determina si un url_status debe auto-marcar la fuente como NO APTA
 */
export function shouldAutoReject(urlStatus: UrlStatus): boolean {
  // OK, PENDING y MANUAL no se rechazan automaticamente
  // MANUAL son fuentes agregadas por el operador que se confía sean válidas
  return urlStatus !== 'OK' && urlStatus !== 'PENDING' && urlStatus !== 'MANUAL'
}

/**
 * Obtiene la razon automatica de rechazo basada en url_status
 */
export function getAutoRejectReason(urlStatus: UrlStatus): AutoNoAptaReason | null {
  return URL_STATUS_TO_REASON[urlStatus] || null
}

/**
 * Obtiene descripcion legible del motivo de rechazo automatico
 */
export function getAutoRejectDescription(reason: AutoNoAptaReason): string {
  const descriptions: Record<AutoNoAptaReason, string> = {
    'HTTP_400': 'Error HTTP 400 - Peticion invalida',
    'HTTP_403': 'Acceso prohibido (403) - Posible paywall o login',
    'HTTP_404': 'Pagina no encontrada (404)',
    'HTTP_410': 'Contenido eliminado permanentemente (410)',
    'HTTP_500': 'Error del servidor (5xx)',
    'HTTP_503': 'Servicio no disponible (503)',
    'TIMEOUT': 'Timeout - El servidor no responde',
    'FETCH_FAILED': 'No se pudo conectar al servidor',
    'DNS_FAIL': 'DNS no resuelve - Dominio inexistente',
    'SSL_ERROR': 'Error de certificado SSL',
    'CONNECTION_ERROR': 'Error de conexion',
    'URL_TRUNCATED': 'URL truncada con "..." - URL incompleta',
    'URL_INVALID': 'URL invalida o malformada'
  }
  return descriptions[reason] || `Error: ${reason}`
}

/**
 * Verifica si una URL es accesible
 * Usa HEAD primero, fallback a GET si HEAD falla
 */
export async function validateUrl(rawUrl: string): Promise<UrlValidationResult> {
  const now = new Date().toISOString()

  // Normalizar URL primero
  const normalized = normalizeUrl(rawUrl)
  if (!normalized.url) {
    return {
      url_status: 'INVALID_URL',
      last_checked_at: now,
      failure_reason: normalized.error || 'URL invalida'
    }
  }

  const url = normalized.url

  try {
    // Crear AbortController para timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    // Intentar HEAD primero
    let response: Response
    try {
      response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CourseBot/1.0; +https://example.com/bot)'
        }
      })
    } catch (headError) {
      // Si HEAD falla, intentar GET
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CourseBot/1.0; +https://example.com/bot)'
        }
      })
    }

    clearTimeout(timeoutId)

    const statusCode = response.status
    const finalUrl = response.url

    // Determinar estado basado en codigo HTTP
    if (statusCode >= 200 && statusCode < 300) {
      return {
        url_status: 'OK',
        http_status_code: statusCode,
        last_checked_at: now,
        final_url: finalUrl !== url ? finalUrl : undefined
      }
    }

    if (statusCode >= 300 && statusCode < 400) {
      // Redirect - verificar si el destino final es OK
      return {
        url_status: 'OK',
        http_status_code: statusCode,
        last_checked_at: now,
        final_url: finalUrl !== url ? finalUrl : undefined
      }
    }

    if (statusCode === 401) {
      return {
        url_status: 'AUTH_REQUIRED',
        http_status_code: statusCode,
        last_checked_at: now,
        failure_reason: 'Requiere autenticacion (401)'
      }
    }

    if (statusCode === 403) {
      return {
        url_status: 'FORBIDDEN',
        http_status_code: statusCode,
        last_checked_at: now,
        failure_reason: 'Acceso prohibido (403)'
      }
    }

    if (statusCode === 404 || statusCode === 410) {
      return {
        url_status: 'NOT_FOUND',
        http_status_code: statusCode,
        last_checked_at: now,
        failure_reason: `Pagina no encontrada (${statusCode})`
      }
    }

    // Otros errores de servidor
    return {
      url_status: 'CONNECTION_ERROR',
      http_status_code: statusCode,
      last_checked_at: now,
      failure_reason: `Error HTTP ${statusCode}`
    }

  } catch (error: any) {
    // Manejar diferentes tipos de errores
    const errorMessage = error.message || String(error)

    if (error.name === 'AbortError' || errorMessage.includes('timeout')) {
      return {
        url_status: 'TIMEOUT',
        last_checked_at: now,
        failure_reason: `Timeout despues de ${TIMEOUT_MS / 1000}s`
      }
    }

    if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo') || errorMessage.includes('DNS')) {
      return {
        url_status: 'DNS_FAIL',
        last_checked_at: now,
        failure_reason: 'DNS no encontrado (NXDOMAIN)'
      }
    }

    if (errorMessage.includes('certificate') || errorMessage.includes('SSL') || errorMessage.includes('CERT')) {
      return {
        url_status: 'SSL_ERROR',
        last_checked_at: now,
        failure_reason: 'Error de certificado SSL'
      }
    }

    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ECONNRESET')) {
      return {
        url_status: 'CONNECTION_ERROR',
        last_checked_at: now,
        failure_reason: 'Conexion rechazada/reiniciada'
      }
    }

    // Error generico
    return {
      url_status: 'CONNECTION_ERROR',
      last_checked_at: now,
      failure_reason: errorMessage.slice(0, 100)
    }
  }
}

/**
 * Valida multiples URLs en paralelo (con limite de concurrencia)
 */
export async function validateUrls(
  urls: string[],
  concurrency: number = 5
): Promise<Map<string, UrlValidationResult>> {
  const results = new Map<string, UrlValidationResult>()

  // Procesar en lotes para evitar sobrecargar
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(async url => {
        const result = await validateUrl(url)
        return { url, result }
      })
    )

    for (const { url, result } of batchResults) {
      results.set(url, result)
    }
  }

  return results
}

/**
 * Verifica si un url_status permite marcar como "Apta"
 */
export function isUrlStatusValidForApta(status: UrlStatus): boolean {
  return status === 'OK' || status === 'MANUAL'
}

/**
 * Obtiene descripcion legible del estado de URL
 */
export function getUrlStatusLabel(status: UrlStatus): string {
  const labels: Record<UrlStatus, string> = {
    PENDING: 'Pendiente',
    OK: 'Accesible',
    MANUAL: 'Manual',
    NOT_FOUND: '404',
    DNS_FAIL: 'DNS fail',
    TIMEOUT: 'Timeout',
    FORBIDDEN: '403',
    AUTH_REQUIRED: 'Login req.',
    INVALID_URL: 'URL invalida',
    INVALID_URL_TRUNCATED: 'URL truncada',
    SSL_ERROR: 'SSL error',
    CONNECTION_ERROR: 'Conexion',
    SERVER_ERROR: '5xx'
  }
  return labels[status] || status
}

/**
 * Obtiene color CSS para el estado de URL
 */
export function getUrlStatusColor(status: UrlStatus): string {
  const colors: Record<UrlStatus, string> = {
    PENDING: 'bg-gray-100 text-gray-800',
    OK: 'bg-green-100 text-green-800',
    MANUAL: 'bg-blue-100 text-blue-800',
    NOT_FOUND: 'bg-red-100 text-red-800',
    DNS_FAIL: 'bg-red-100 text-red-800',
    TIMEOUT: 'bg-orange-100 text-orange-800',
    FORBIDDEN: 'bg-yellow-100 text-yellow-800',
    AUTH_REQUIRED: 'bg-yellow-100 text-yellow-800',
    INVALID_URL: 'bg-red-100 text-red-800',
    INVALID_URL_TRUNCATED: 'bg-red-100 text-red-800',
    SSL_ERROR: 'bg-red-100 text-red-800',
    CONNECTION_ERROR: 'bg-red-100 text-red-800',
    SERVER_ERROR: 'bg-red-100 text-red-800'
  }
  return colors[status] || 'bg-gray-100 text-gray-800'
}

/**
 * Verifica si el status de URL permite override manual (403/AUTH_REQUIRED)
 */
export function canOverrideForbidden(status: UrlStatus): boolean {
  return status === 'FORBIDDEN' || status === 'AUTH_REQUIRED'
}
