// GO-ESP-04: Validadores para Curaduria de Fuentes (con validacion de URLs)

import type {
  CurationRow,
  CurationValidationCheck,
  CurationDodCheck,
  CurationBlocker,
  RequiredComponent,
  DetectedGap,
  GapReason
} from '../types/curation.types'

/**
 * Verifica si una fuente cumple todos los requisitos para ser considerada valida
 * Incluye soporte para override de 403/paywall y fuentes manuales
 */
export function isSourceFullyValid(row: CurationRow): boolean {
  const urlOk = row.url_status === 'OK' || row.url_status === 'MANUAL' || row.forbidden_override === true
  return row.apta === true &&
         row.cobertura_completa === true &&
         urlOk
}

/**
 * Verifica si una fuente puede ser marcada como apta (URL debe ser OK o MANUAL)
 */
export function canMarkAsApta(row: CurationRow): boolean {
  return row.url_status === 'OK' || row.url_status === 'MANUAL'
}

// V00: URLs Operables (INFORMATIVO - no bloquea)
// Todas las fuentes marcadas como apta deben tener url_status=OK o MANUAL
export function validateUrlOperability(rows: CurationRow[]): CurationValidationCheck {
  const aptaWithBadUrl = rows.filter(
    r => r.apta === true && r.url_status !== 'OK' && r.url_status !== 'MANUAL' && !r.forbidden_override
  )

  const validUrls = rows.filter(
    r => r.url_status === 'OK' || r.url_status === 'MANUAL'
  )

  return {
    code: 'V00_URL_OPERABILITY',
    pass: aptaWithBadUrl.length === 0,
    message: aptaWithBadUrl.length === 0
      ? `URLs operables: ${validUrls.length}/${rows.length}`
      : `${aptaWithBadUrl.length} fuente(s) marcada(s) como apta con URL no funcional`,
    severity: 'warning' // Cambiado de 'error' a 'warning' - no bloquea aprobación
  }
}

// V01: Cobertura por Componente (INFORMATIVO - no bloquea)
// Para cada (lesson, component) requerido, existe >=1 row con apta=true AND cobertura_completa=true AND url_status=OK
export function validateCoveragePerComponent(
  rows: CurationRow[],
  requiredComponents: RequiredComponent[]
): CurationValidationCheck {
  const uncovered: string[] = []

  for (const req of requiredComponents) {
    const hasValidSource = rows.some(
      r => r.lesson_id === req.lesson_id &&
           r.component === req.component &&
           isSourceFullyValid(r)
    )

    if (!hasValidSource) {
      uncovered.push(`${req.lesson_title}: ${req.component}`)
    }
  }

  return {
    code: 'V01_COVERAGE_PER_COMPONENT',
    pass: uncovered.length === 0,
    message: uncovered.length === 0
      ? 'Todos los componentes tienen fuente valida (apta + cobertura + URL OK)'
      : `${uncovered.length} componente(s) sin cobertura valida: ${uncovered.slice(0, 3).join(', ')}${uncovered.length > 3 ? '...' : ''}`,
    severity: 'warning' // Cambiado de 'error' a 'warning' - no bloquea aprobación
  }
}

// V02: Criticos Requieren Cobertura Completa (INFORMATIVO - no bloquea)
// Si is_critical=true, debe haber al menos una fuente con apta=true, cobertura_completa=true y url_status=OK
export function validateCriticalCoverage(
  rows: CurationRow[],
  requiredComponents: RequiredComponent[]
): CurationValidationCheck {
  const criticalComponents = requiredComponents.filter(c => c.is_critical)
  const uncoveredCritical: string[] = []

  for (const critical of criticalComponents) {
    const hasValidSource = rows.some(
      r => r.lesson_id === critical.lesson_id &&
           r.component === critical.component &&
           isSourceFullyValid(r)
    )

    if (!hasValidSource) {
      uncoveredCritical.push(`${critical.lesson_title}: ${critical.component}`)
    }
  }

  return {
    code: 'V02_CRITICAL_COVERAGE',
    pass: uncoveredCritical.length === 0,
    message: uncoveredCritical.length === 0
      ? 'Todos los componentes criticos tienen cobertura valida'
      : `${uncoveredCritical.length} componente(s) CRITICO(s) sin cobertura valida`,
    severity: 'warning' // Cambiado de 'error' a 'warning' - no bloquea aprobación
  }
}

// V03: NO APTA Requiere Motivo (INFORMATIVO - no bloquea)
// Si apta=false, motivo_no_apta no puede estar vacio
export function validateNoAptaHasReason(rows: CurationRow[]): CurationValidationCheck {
  const withoutReason = rows.filter(
    r => r.apta === false && (!r.motivo_no_apta || r.motivo_no_apta.trim().length === 0)
  )

  return {
    code: 'V03_NO_APTA_HAS_REASON',
    pass: withoutReason.length === 0,
    message: withoutReason.length === 0
      ? 'Todas las fuentes NO APTA tienen motivo documentado'
      : `${withoutReason.length} fuente(s) NO APTA sin motivo`,
    severity: 'warning' // Cambiado de 'error' a 'warning' - no bloquea aprobación
  }
}

// V04: Componente Sin Fuente Apta (Componente Huerfano) (INFORMATIVO - no bloquea)
// Si un componente solo tiene fuentes apta=false o ninguna fuente con url_status=OK/MANUAL, es un gap
export function validateNoOrphanComponents(
  rows: CurationRow[],
  requiredComponents: RequiredComponent[]
): CurationValidationCheck {
  const orphans: string[] = []

  for (const req of requiredComponents) {
    const componentRows = rows.filter(
      r => r.lesson_id === req.lesson_id && r.component === req.component
    )

    // Si no hay filas con url_status=OK/MANUAL y apta=true
    const hasValidSource = componentRows.some(r =>
      r.apta === true && (r.url_status === 'OK' || r.url_status === 'MANUAL' || r.forbidden_override)
    )

    if (!hasValidSource) {
      orphans.push(`${req.lesson_title}: ${req.component}`)
    }
  }

  return {
    code: 'V04_NO_ORPHAN_COMPONENTS',
    pass: orphans.length === 0,
    message: orphans.length === 0
      ? 'Todos los componentes tienen al menos una fuente apta con URL funcional'
      : `${orphans.length} componente(s) sin ninguna fuente apta funcional`,
    severity: 'warning' // Cambiado de 'error' a 'warning' - no bloquea aprobación
  }
}

// V05: Maximo de Intentos
export function validateMaxAttempts(attemptNumber: number): CurationValidationCheck {
  return {
    code: 'V05_MAX_ATTEMPTS',
    pass: attemptNumber <= 2,
    message: attemptNumber <= 2
      ? `Intento ${attemptNumber}/2`
      : 'Maximo de intentos excedido - requiere escalacion',
    severity: 'error'
  }
}

// V06: Todas las filas evaluadas (no hay pendientes)
export function validateAllRowsEvaluated(rows: CurationRow[]): CurationValidationCheck {
  const pending = rows.filter(r => r.apta === null)

  return {
    code: 'V06_ALL_ROWS_EVALUATED',
    pass: pending.length === 0,
    message: pending.length === 0
      ? 'Todas las fuentes han sido evaluadas'
      : `${pending.length} fuente(s) pendiente(s) de evaluacion`,
    severity: 'warning'
  }
}

// V07: URLs pendientes de validacion
export function validateNoUrlsPending(rows: CurationRow[]): CurationValidationCheck {
  const pending = rows.filter(r => r.url_status === 'PENDING')

  return {
    code: 'V07_URLS_VALIDATED',
    pass: pending.length === 0,
    message: pending.length === 0
      ? 'Todas las URLs han sido validadas'
      : `${pending.length} URL(s) pendiente(s) de validacion`,
    severity: 'warning'
  }
}

// Ejecutar todas las validaciones
export function runAllValidations(
  rows: CurationRow[],
  requiredComponents: RequiredComponent[],
  attemptNumber: number
): { automaticChecks: CurationValidationCheck[]; allPassed: boolean; hasErrors: boolean } {
  const automaticChecks = [
    validateUrlOperability(rows),
    validateCoveragePerComponent(rows, requiredComponents),
    validateCriticalCoverage(rows, requiredComponents),
    validateNoAptaHasReason(rows),
    validateNoOrphanComponents(rows, requiredComponents),
    validateMaxAttempts(attemptNumber),
    validateAllRowsEvaluated(rows),
    validateNoUrlsPending(rows)
  ]

  const errors = automaticChecks.filter(c => !c.pass && c.severity === 'error')
  const allPassed = automaticChecks.every(c => c.pass)

  return { automaticChecks, allPassed, hasErrors: errors.length > 0 }
}

// Generar checklist DoD
export function generateDodChecklist(
  rows: CurationRow[],
  requiredComponents: RequiredComponent[],
  blockers: CurationBlocker[],
  bitacoraCount: number
): CurationDodCheck[] {
  const v00 = validateUrlOperability(rows)
  const v01 = validateCoveragePerComponent(rows, requiredComponents)
  const v02 = validateCriticalCoverage(rows, requiredComponents)
  const v03 = validateNoAptaHasReason(rows)

  const okUrls = rows.filter(r => r.url_status === 'OK').length
  const totalUrls = rows.length

  return [
    {
      code: 'DOD_OPERABILITY',
      label: 'URLs verificadas y funcionales',
      pass: v00.pass && okUrls > 0,
      evidence: v00.pass
        ? `${okUrls}/${totalUrls} URLs funcionales`
        : undefined,
      notes: !v00.pass ? v00.message : undefined
    },
    {
      code: 'DOD_COVERAGE',
      label: 'Cobertura por leccion',
      pass: v01.pass,
      evidence: v01.pass
        ? `${requiredComponents.length} componentes cubiertos`
        : undefined,
      notes: !v01.pass ? v01.message : undefined
    },
    {
      code: 'DOD_CRITICAL',
      label: 'Componentes criticos cubiertos',
      pass: v02.pass,
      evidence: v02.pass
        ? 'Todos los criticos con cobertura completa'
        : undefined,
      notes: !v02.pass ? v02.message : undefined
    },
    {
      code: 'DOD_TRACEABILITY',
      label: 'Bitacora completa',
      pass: bitacoraCount > 0,
      evidence: bitacoraCount > 0
        ? `${bitacoraCount} entrada(s) en bitacora`
        : undefined,
      notes: bitacoraCount === 0
        ? 'Se requiere al menos una entrada en la bitacora'
        : undefined
    }
  ]
}

/**
 * Detecta gaps para Intento 2 con razon y detalles
 */
export function detectGaps(
  rows: CurationRow[],
  requiredComponents: RequiredComponent[]
): DetectedGap[] {
  const gaps: DetectedGap[] = []

  for (const req of requiredComponents) {
    const componentRows = rows.filter(
      r => r.lesson_id === req.lesson_id && r.component === req.component
    )

    // Caso 1: No hay filas para este componente
    if (componentRows.length === 0) {
      gaps.push({
        lesson_id: req.lesson_id,
        lesson_title: req.lesson_title,
        component: req.component,
        is_critical: req.is_critical,
        reason: 'NO_SOURCES',
        details: 'No hay fuentes sugeridas para este componente'
      })
      continue
    }

    // Caso 2: Todas las filas tienen URLs fallidas (excluyendo MANUAL que es válido)
    const urlFailedRows = componentRows.filter(r =>
      r.url_status !== 'OK' && r.url_status !== 'PENDING' && r.url_status !== 'MANUAL'
    )
    if (urlFailedRows.length === componentRows.length) {
      const failReasons = urlFailedRows.map(r => r.url_status).join(', ')
      gaps.push({
        lesson_id: req.lesson_id,
        lesson_title: req.lesson_title,
        component: req.component,
        is_critical: req.is_critical,
        reason: 'URL_FAIL',
        details: `${urlFailedRows.length} fuente(s) con URLs fallidas: ${failReasons}`
      })
      continue
    }

    // Caso 3: Hay filas con AUTH_REQUIRED
    const authRequired = componentRows.filter(r => r.url_status === 'AUTH_REQUIRED')
    const hasValidUrl = componentRows.some(r => r.url_status === 'OK' || r.url_status === 'MANUAL')
    if (authRequired.length > 0 && !hasValidUrl) {
      gaps.push({
        lesson_id: req.lesson_id,
        lesson_title: req.lesson_title,
        component: req.component,
        is_critical: req.is_critical,
        reason: 'AUTH_REQUIRED',
        details: `${authRequired.length} fuente(s) requieren autenticacion`
      })
      continue
    }

    // Caso 4: Todas las fuentes aptas no tienen cobertura completa o url_status no es OK/MANUAL
    const aptaRows = componentRows.filter(r => r.apta === true)
    if (aptaRows.length > 0) {
      const validRows = aptaRows.filter(r =>
        r.cobertura_completa === true && (r.url_status === 'OK' || r.url_status === 'MANUAL' || r.forbidden_override)
      )
      if (validRows.length === 0) {
        gaps.push({
          lesson_id: req.lesson_id,
          lesson_title: req.lesson_title,
          component: req.component,
          is_critical: req.is_critical,
          reason: 'NO_COVERAGE',
          details: `${aptaRows.length} fuente(s) apta(s) pero sin cobertura completa o URL fallida`
        })
        continue
      }
    }

    // Caso 5: Todas las fuentes fueron marcadas como NO APTA
    const allNoApta = componentRows.every(r => r.apta === false)
    if (allNoApta) {
      gaps.push({
        lesson_id: req.lesson_id,
        lesson_title: req.lesson_title,
        component: req.component,
        is_critical: req.is_critical,
        reason: 'ALL_NO_APTA',
        details: `Todas las ${componentRows.length} fuente(s) fueron marcadas como NO APTA`
      })
      continue
    }

    // Caso 6: Hay fuentes pendientes de evaluacion pero ninguna valida
    const pendingRows = componentRows.filter(r => r.apta === null)
    const hasFullyValid = componentRows.some(r => isSourceFullyValid(r))

    if (!hasFullyValid && pendingRows.length === 0) {
      gaps.push({
        lesson_id: req.lesson_id,
        lesson_title: req.lesson_title,
        component: req.component,
        is_critical: req.is_critical,
        reason: 'NO_COVERAGE',
        details: 'No hay fuentes que cumplan todos los criterios (apta + cobertura + URL OK)'
      })
    }
  }

  return gaps
}

/**
 * Generar bloqueadores automaticos tras Intento 2
 */
export function generateAutoBlockers(
  gaps: DetectedGap[],
  attemptNumber: number
): Omit<CurationBlocker, 'id' | 'created_at'>[] {
  if (attemptNumber < 2 || gaps.length === 0) return []

  return gaps.map(gap => {
    let reasonText = ''
    switch (gap.reason) {
      case 'URL_FAIL': reasonText = 'URLs no funcionan'; break
      case 'AUTH_REQUIRED': reasonText = 'Requiere autenticacion'; break
      case 'NO_COVERAGE': reasonText = 'Sin cobertura completa'; break
      case 'NO_SOURCES': reasonText = 'Sin fuentes'; break
      case 'ALL_NO_APTA': reasonText = 'Todas NO APTA'; break
    }

    return {
      lesson_id: gap.lesson_id,
      lesson_title: gap.lesson_title,
      component: gap.component,
      impact: `Componente ${gap.component} de leccion "${gap.lesson_title}" sin fuente valida tras 2 intentos. Razon: ${reasonText}. ${gap.details || ''}`,
      owner: 'Pendiente asignar',
      status: 'OPEN' as const
    }
  })
}

/**
 * Estadisticas de URLs
 */
export function getUrlStats(rows: CurationRow[]): {
  total: number
  ok: number
  failed: number
  pending: number
  byStatus: Record<string, number>
} {
  const byStatus: Record<string, number> = {}

  for (const row of rows) {
    byStatus[row.url_status] = (byStatus[row.url_status] || 0) + 1
  }

  return {
    total: rows.length,
    ok: byStatus['OK'] || 0,
    failed: rows.filter(r => r.url_status !== 'OK' && r.url_status !== 'PENDING').length,
    pending: byStatus['PENDING'] || 0,
    byStatus
  }
}

/**
 * Verifica si todos los componentes críticos tienen al menos una fuente válida
 * NOTA: Gating deshabilitado - ya no es obligatorio que todos los componentes tengan URL válida
 * Siempre retorna canApprove: true
 */
export function getCriticalGapsForGating(
  rows: CurationRow[],
  requiredComponents: RequiredComponent[]
): {
  canApprove: boolean
  criticalGaps: Array<{
    lesson_id: string
    lesson_title: string
    component: string
    reason: string
  }>
} {
  // Gating deshabilitado - siempre permitir aprobar
  return {
    canApprove: true,
    criticalGaps: []
  }
}

/**
 * Verifica si se debe habilitar el Intento 2 basado en gaps
 */
export function shouldEnableAttempt2(
  rows: CurationRow[],
  requiredComponents: RequiredComponent[],
  attemptNumber: number
): {
  shouldEnable: boolean
  reason: string
  gapsCount: number
} {
  if (attemptNumber >= 2) {
    return { shouldEnable: false, reason: 'Máximo de intentos alcanzado', gapsCount: 0 }
  }

  const gaps = detectGaps(rows, requiredComponents)
  const criticalGaps = gaps.filter(g => g.is_critical)

  if (criticalGaps.length > 0) {
    return {
      shouldEnable: true,
      reason: `${criticalGaps.length} componente(s) crítico(s) sin cobertura válida`,
      gapsCount: criticalGaps.length
    }
  }

  if (gaps.length > 0) {
    return {
      shouldEnable: true,
      reason: `${gaps.length} componente(s) sin cobertura válida`,
      gapsCount: gaps.length
    }
  }

  return { shouldEnable: false, reason: 'Todos los componentes tienen cobertura', gapsCount: 0 }
}
