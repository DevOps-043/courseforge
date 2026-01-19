/**
 * Pruebas unitarias para validadores de curaduria
 *
 * Criterios de aceptacion:
 * 1. status 404 => apta=false (auto-clasificado)
 * 2. url contiene "..." => invalid (URL truncada)
 * 3. gating critico => bloquea aprobacion si falta cobertura
 */

import {
  isSourceFullyValid,
  canMarkAsApta,
  detectGaps,
  getCriticalGapsForGating,
  getUrlStats
} from '../validators/curation.validators'
import {
  shouldAutoReject,
  getAutoRejectReason,
  isUrlTruncated,
  normalizeUrl
} from '../services/urlValidation.service'
import type { CurationRow, RequiredComponent, UrlStatus } from '../types/curation.types'

describe('Auto-clasificacion de URLs fallidas', () => {
  describe('shouldAutoReject', () => {
    it('debe rechazar URLs con status 404', () => {
      expect(shouldAutoReject('NOT_FOUND')).toBe(true)
    })

    it('debe rechazar URLs con status 403', () => {
      expect(shouldAutoReject('FORBIDDEN')).toBe(true)
    })

    it('debe rechazar URLs con timeout', () => {
      expect(shouldAutoReject('TIMEOUT')).toBe(true)
    })

    it('debe rechazar URLs con DNS fail', () => {
      expect(shouldAutoReject('DNS_FAIL')).toBe(true)
    })

    it('debe rechazar URLs con SSL error', () => {
      expect(shouldAutoReject('SSL_ERROR')).toBe(true)
    })

    it('debe rechazar URLs con connection error', () => {
      expect(shouldAutoReject('CONNECTION_ERROR')).toBe(true)
    })

    it('debe rechazar URLs truncadas', () => {
      expect(shouldAutoReject('INVALID_URL_TRUNCATED')).toBe(true)
    })

    it('NO debe rechazar URLs con status OK', () => {
      expect(shouldAutoReject('OK')).toBe(false)
    })

    it('NO debe rechazar URLs pendientes', () => {
      expect(shouldAutoReject('PENDING')).toBe(false)
    })
  })

  describe('getAutoRejectReason', () => {
    it('debe retornar HTTP_404 para NOT_FOUND', () => {
      expect(getAutoRejectReason('NOT_FOUND')).toBe('HTTP_404')
    })

    it('debe retornar HTTP_403 para FORBIDDEN', () => {
      expect(getAutoRejectReason('FORBIDDEN')).toBe('HTTP_403')
    })

    it('debe retornar TIMEOUT para timeout', () => {
      expect(getAutoRejectReason('TIMEOUT')).toBe('TIMEOUT')
    })

    it('debe retornar URL_TRUNCATED para URL truncada', () => {
      expect(getAutoRejectReason('INVALID_URL_TRUNCATED')).toBe('URL_TRUNCATED')
    })

    it('debe retornar null para OK', () => {
      expect(getAutoRejectReason('OK')).toBe(null)
    })
  })
})

describe('Deteccion de URLs truncadas', () => {
  describe('isUrlTruncated', () => {
    it('debe detectar URLs con "..."', () => {
      expect(isUrlTruncated('https://example.com/path/to/...')).toBe(true)
    })

    it('debe detectar URLs con "…" (elipsis unicode)', () => {
      expect(isUrlTruncated('https://example.com/path…')).toBe(true)
    })

    it('debe detectar URLs con "..." en medio', () => {
      expect(isUrlTruncated('https://example.com/.../resource')).toBe(true)
    })

    it('NO debe detectar URLs completas', () => {
      expect(isUrlTruncated('https://example.com/path/to/resource')).toBe(false)
    })

    it('debe manejar strings vacios', () => {
      expect(isUrlTruncated('')).toBe(false)
    })
  })

  describe('normalizeUrl', () => {
    it('debe detectar URL truncada y retornar error', () => {
      const result = normalizeUrl('https://example.com/...')
      expect(result.url).toBe(null)
      expect(result.isTruncated).toBe(true)
    })

    it('debe normalizar URLs validas', () => {
      const result = normalizeUrl('https://example.com/path')
      expect(result.url).toBe('https://example.com/path')
      expect(result.isTruncated).toBeUndefined()
    })
  })
})

describe('Gating de componentes criticos', () => {
  const createRow = (overrides: Partial<CurationRow>): CurationRow => ({
    id: 'row-1',
    lesson_id: 'L1',
    lesson_title: 'Leccion 1',
    component: 'DIALOGUE',
    is_critical: true,
    source_ref: 'https://example.com',
    url_status: 'OK',
    apta: null,
    cobertura_completa: null,
    ...overrides
  })

  const criticalComponent: RequiredComponent = {
    lesson_id: 'L1',
    lesson_title: 'Leccion 1',
    component: 'DIALOGUE',
    is_critical: true
  }

  describe('getCriticalGapsForGating', () => {
    it('debe bloquear si no hay fuente valida para componente critico', () => {
      // Fuente con URL OK pero marcada como NO APTA
      const rows: CurationRow[] = [
        createRow({ url_status: 'OK', apta: false, motivo_no_apta: 'Contenido inadecuado' })
      ]
      const result = getCriticalGapsForGating(rows, [criticalComponent])

      expect(result.canApprove).toBe(false)
      expect(result.criticalGaps.length).toBe(1)
      expect(result.criticalGaps[0].reason).toBe('Todas marcadas NO APTA')
    })

    it('debe permitir si hay fuente valida (apta + cobertura + URL OK)', () => {
      const rows: CurationRow[] = [
        createRow({ apta: true, cobertura_completa: true, url_status: 'OK' })
      ]
      const result = getCriticalGapsForGating(rows, [criticalComponent])

      expect(result.canApprove).toBe(true)
      expect(result.criticalGaps.length).toBe(0)
    })

    it('debe bloquear si hay apta pero sin cobertura completa', () => {
      const rows: CurationRow[] = [
        createRow({ apta: true, cobertura_completa: false, url_status: 'OK' })
      ]
      const result = getCriticalGapsForGating(rows, [criticalComponent])

      expect(result.canApprove).toBe(false)
      expect(result.criticalGaps[0].reason).toBe('Falta cobertura completa')
    })

    it('debe bloquear si todas las URLs fallaron', () => {
      const rows: CurationRow[] = [
        createRow({ url_status: 'NOT_FOUND', apta: false }),
        createRow({ id: 'row-2', url_status: 'TIMEOUT', apta: false })
      ]
      const result = getCriticalGapsForGating(rows, [criticalComponent])

      expect(result.canApprove).toBe(false)
      expect(result.criticalGaps[0].reason).toBe('Todas las URLs fallidas')
    })

    it('debe permitir si hay override activo y fuente valida', () => {
      const rows: CurationRow[] = [
        createRow({
          url_status: 'FORBIDDEN',
          forbidden_override: true,
          apta: true,
          cobertura_completa: true
        })
      ]
      const result = getCriticalGapsForGating(rows, [criticalComponent])

      expect(result.canApprove).toBe(true)
    })
  })

  describe('isSourceFullyValid', () => {
    it('debe ser valida con apta + cobertura + URL OK', () => {
      const row = createRow({ apta: true, cobertura_completa: true, url_status: 'OK' })
      expect(isSourceFullyValid(row)).toBe(true)
    })

    it('NO debe ser valida si URL falla', () => {
      const row = createRow({ apta: true, cobertura_completa: true, url_status: 'NOT_FOUND' })
      expect(isSourceFullyValid(row)).toBe(false)
    })

    it('NO debe ser valida si no es apta', () => {
      const row = createRow({ apta: false, cobertura_completa: true, url_status: 'OK' })
      expect(isSourceFullyValid(row)).toBe(false)
    })

    it('NO debe ser valida sin cobertura completa', () => {
      const row = createRow({ apta: true, cobertura_completa: false, url_status: 'OK' })
      expect(isSourceFullyValid(row)).toBe(false)
    })

    it('debe ser valida con override activo', () => {
      const row = createRow({
        apta: true,
        cobertura_completa: true,
        url_status: 'FORBIDDEN',
        forbidden_override: true
      })
      expect(isSourceFullyValid(row)).toBe(true)
    })
  })
})

describe('detectGaps', () => {
  const createRow = (overrides: Partial<CurationRow>): CurationRow => ({
    id: 'row-1',
    lesson_id: 'L1',
    lesson_title: 'Leccion 1',
    component: 'DIALOGUE',
    is_critical: true,
    source_ref: 'https://example.com',
    url_status: 'OK',
    apta: null,
    cobertura_completa: null,
    ...overrides
  })

  const component: RequiredComponent = {
    lesson_id: 'L1',
    lesson_title: 'Leccion 1',
    component: 'DIALOGUE',
    is_critical: true
  }

  it('debe detectar gap si no hay fuentes', () => {
    const gaps = detectGaps([], [component])
    expect(gaps.length).toBe(1)
    expect(gaps[0].reason).toBe('NO_SOURCES')
  })

  it('debe detectar gap si todas las URLs fallaron', () => {
    const rows = [
      createRow({ url_status: 'NOT_FOUND' }),
      createRow({ id: 'row-2', url_status: 'TIMEOUT' })
    ]
    const gaps = detectGaps(rows, [component])
    expect(gaps.length).toBe(1)
    expect(gaps[0].reason).toBe('URL_FAIL')
  })

  it('debe detectar gap si todas son NO APTA', () => {
    const rows = [
      createRow({ apta: false, motivo_no_apta: 'Contenido inadecuado' }),
      createRow({ id: 'row-2', apta: false, motivo_no_apta: 'Desactualizado' })
    ]
    const gaps = detectGaps(rows, [component])
    expect(gaps.length).toBe(1)
    expect(gaps[0].reason).toBe('ALL_NO_APTA')
  })

  it('NO debe detectar gap si hay fuente valida', () => {
    const rows = [
      createRow({ apta: true, cobertura_completa: true, url_status: 'OK' })
    ]
    const gaps = detectGaps(rows, [component])
    expect(gaps.length).toBe(0)
  })
})

describe('getUrlStats', () => {
  const createRow = (status: UrlStatus): CurationRow => ({
    id: Math.random().toString(),
    lesson_id: 'L1',
    lesson_title: 'Leccion 1',
    component: 'DIALOGUE',
    is_critical: true,
    source_ref: 'https://example.com',
    url_status: status,
    apta: null,
    cobertura_completa: null
  })

  it('debe contar correctamente URLs OK y fallidas', () => {
    const rows = [
      createRow('OK'),
      createRow('OK'),
      createRow('NOT_FOUND'),
      createRow('TIMEOUT'),
      createRow('PENDING')
    ]

    const stats = getUrlStats(rows)

    expect(stats.total).toBe(5)
    expect(stats.ok).toBe(2)
    expect(stats.failed).toBe(2)
    expect(stats.pending).toBe(1)
  })
})
