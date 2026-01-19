// GO-ESP-04: Servicio de Curaduria de Fuentes con Supabase

import { createClient } from '@/shared/lib/supabase/client'
import type {
  Esp04StepState,
  CurationPayload,
  CurationResult,
  CurationRow,
  BitacoraEntry,
  CurationBlocker,
  RequiredComponent,
  DetectedGap,
  UrlStatus
} from '../types/curation.types'
import {
  runAllValidations,
  generateDodChecklist,
  detectGaps,
  generateAutoBlockers,
  canMarkAsApta,
  getCriticalGapsForGating,
  shouldEnableAttempt2
} from '../validators/curation.validators'
import {
  shouldAutoReject,
  getAutoRejectReason,
  getAutoRejectDescription,
  isUrlTruncated,
  validateUrl
} from './urlValidation.service'
import { instructionalPlanService } from '@/domains/instructionalPlan/services/instructionalPlan.service'
import { artifactsService } from '@/domains/artifacts/services/artifacts.service'
import type { CurationPromptVersion } from '@/shared/config/prompts'

// Helper para obtener cliente Supabase (con tipos flexibles para nuevas tablas)
function getSupabase() {
  return createClient() as any
}

const generateId = () => Math.random().toString(36).substring(2, 11)

/**
 * Crea una fila de curaduria con auto-clasificacion basada en URL status
 * Asegura que todos los valores sean válidos para Supabase (sin undefined)
 */
function createCurationRowData(
  lessonId: string,
  lessonTitle: string,
  component: string,
  isCritical: boolean,
  source: { url?: string; title?: string; rationale?: string; url_status?: UrlStatus; http_status_code?: number; last_checked_at?: string; failure_reason?: string },
  notes?: string
): Record<string, any> {
  // Asegurar que source_ref no sea vacío (es NOT NULL en DB)
  const sourceRef = source.url || source.title || 'Sin referencia'
  const sourceTitle = source.title || sourceRef

  let urlStatus: UrlStatus = (source.url_status as UrlStatus) || 'PENDING'
  let failureReason = source.failure_reason || null

  if (source.url && isUrlTruncated(source.url)) {
    urlStatus = 'INVALID_URL_TRUNCATED'
    failureReason = 'URL truncada con "..." detectada'
  }

  const shouldReject = shouldAutoReject(urlStatus)
  const autoReason = shouldReject ? getAutoRejectReason(urlStatus) : null

  // Retornar objeto sin valores undefined (Supabase no los acepta)
  // Usamos Record<string, any> para permitir null en lugar de undefined
  return {
    lesson_id: lessonId,
    lesson_title: lessonTitle,
    component,
    is_critical: isCritical,
    source_ref: sourceRef,
    source_title: sourceTitle,
    source_rationale: source.rationale || null,
    url_status: urlStatus,
    http_status_code: source.http_status_code ?? null,
    last_checked_at: source.last_checked_at || null,
    failure_reason: failureReason,
    apta: shouldReject ? false : null,
    motivo_no_apta: autoReason ? getAutoRejectDescription(autoReason) : null,
    cobertura_completa: null,
    notes: notes || '',
    auto_evaluated: shouldReject,
    auto_reason: autoReason || null
  }
}

export const curationService = {
  /**
   * Transformar datos de DB a CurationPayload
   */
  async transformFromDb(curationData: Record<string, unknown>, rows: Record<string, unknown>[], blockers: Record<string, unknown>[], bitacora: Record<string, unknown>[]): Promise<CurationPayload> {
    return {
      artifact_id: curationData.artifact_id as string,
      attempt_number: curationData.attempt_number as 1 | 2,
      rows: rows.map(r => ({
        id: r.id as string,
        lesson_id: r.lesson_id as string,
        lesson_title: r.lesson_title as string,
        component: r.component as string,
        is_critical: r.is_critical as boolean,
        source_ref: r.source_ref as string,
        source_title: r.source_title as string,
        source_rationale: r.source_rationale as string,
        url_status: r.url_status as UrlStatus,
        http_status_code: r.http_status_code as number | undefined,
        last_checked_at: r.last_checked_at as string | undefined,
        failure_reason: r.failure_reason as string | undefined,
        apta: r.apta as boolean | null,
        motivo_no_apta: r.motivo_no_apta as string | undefined,
        cobertura_completa: r.cobertura_completa as boolean | null,
        notes: r.notes as string,
        auto_evaluated: r.auto_evaluated as boolean,
        auto_reason: r.auto_reason as CurationRow['auto_reason'],
        forbidden_override: r.forbidden_override as boolean
      })),
      bitacora: bitacora.map(b => ({
        id: b.id as string,
        entry_type: (b.event_data as any)?.entry_type || 'NOTE',
        message: (b.event_data as any)?.message || '',
        created_at: b.created_at as string
      })),
      blockers: blockers.map(b => ({
        id: b.id as string,
        lesson_id: b.lesson_id as string,
        lesson_title: b.lesson_title as string,
        component: b.component as string,
        impact: b.impact as string,
        owner: b.owner as string,
        status: b.status as 'OPEN' | 'MITIGATING' | 'ACCEPTED',
        created_at: b.created_at as string
      })),
      dod: {
        checklist: [],
        automatic_checks: []
      },
      qa_decision: curationData.qa_decision as CurationPayload['qa_decision'],
      state: curationData.state as Esp04StepState
    }
  },

  async startCuration(artifactId: string, promptVersion: CurationPromptVersion = 'default', customPrompt?: string): Promise<CurationResult> {
    const supabase = getSupabase()

    const plan = await instructionalPlanService.getPlan(artifactId)
    if (!plan) {
      return { success: false, state: 'PHASE2_DRAFT', error: 'Plan instruccional no encontrado' }
    }

    if (plan.state !== 'STEP_APPROVED') {
      return { success: false, state: 'PHASE2_DRAFT', error: 'El Paso 3 debe estar aprobado' }
    }

    const artifact = await artifactsService.getById(artifactId)
    if (!artifact) {
      return { success: false, state: 'PHASE2_DRAFT', error: 'Artefacto no encontrado' }
    }

    // Crear curation en DB
    const { data: curation, error } = await supabase
      .from('curation')
      .upsert({
        artifact_id: artifactId,
        attempt_number: 1,
        state: 'PHASE2_GENERATING'
      }, {
        onConflict: 'artifact_id'
      })
      .select()
      .maybeSingle()

    if (error || !curation) {
      console.error('[ESP-04] Error creando curation:', error)
      return { success: false, state: 'PHASE2_DRAFT', error: 'Error creando curation' }
    }

    // Limpiar rows y blockers anteriores
    await supabase.from('curation_rows').delete().eq('curation_id', curation.id)
    await supabase.from('curation_blockers').delete().eq('curation_id', curation.id)

    // Registrar evento
    await supabase.from('pipeline_events').insert({
      artifact_id: artifactId,
      step_id: 'ESP-04',
      event_type: 'GENERATION_STARTED',
      event_data: { promptVersion }
    })

    const courseName = (artifact.nombres as string[])?.[0] || artifact.idea_central
    this.runPipeline(artifactId, curation.id, plan.lesson_plans, artifact.idea_central, courseName, promptVersion, customPrompt)

    return { success: true, state: 'PHASE2_GENERATING' }
  },

  async runPipeline(
    artifactId: string,
    curationId: string,
    lessonPlans: any[],
    ideaCentral: string,
    courseName: string,
    promptVersion: CurationPromptVersion = 'default',
    customPrompt?: string
  ): Promise<void> {
    const supabase = getSupabase()

    try {
      console.log('[ESP-04] 🚀 Iniciando generación con Background Functions (15 min limit)...')

      // 1. Obtener Token de Sesión para pasarlo al Background Function (manejo de RLS)
      console.log('[ESP-04] Obteniendo sesión...')
      let { data: { session } } = await supabase.auth.getSession()
      
      if (!session?.access_token) {
        console.warn('[ESP-04] Sesión no encontrada, intentando refresh...')
        const refresh = await supabase.auth.refreshSession()
        session = refresh.data.session
      }

      const accessToken = session?.access_token

      if (!accessToken) {
        console.error('[ESP-04] Sesión AUTH:', session)
        // ALERTA: Estamos procediendo sin token de usuario. 
        // Si las políticas RLS (Row Level Security) requieren autenticación, esto fallará en el insert.
        // Pero permitimos continuar para depuración o si hay configuración permisiva.
        console.warn('⚠️ PROCEEDING WITHOUT SESSION TOKEN. INSERT MIGHT FAIL.')
      } else {
        console.log('[ESP-04] Sesión válida encontrada.')
      }

      // 2. Aplanar componentes
      const allComponents: RequiredComponent[] = []
      for (const lp of lessonPlans) {
        for (const comp of lp.components || []) {
          allComponents.push({
            lesson_id: lp.lesson_id,
            lesson_title: lp.lesson_title,
            component: comp.type,
            is_critical: comp.type === 'DIALOGUE' || comp.type === 'READING' || comp.type === 'QUIZ'
          })
        }
      }

      console.log(`[ESP-04] Enviando ${allComponents.length} componentes al proceso de fondo...`)

      // 3. Llamar a la Background Function
      // Nota: Esta llamada retorna 202 Accepted casi inmediatamente.
      const response = await fetch('/.netlify/functions/curation-background', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          curationId,
          artifactId,
          components: allComponents,
          courseName,
          ideaCentral,
          accessToken: accessToken || '', // Fallback a string vacío
          attemptNumber: 1,
          promptVersion,
          customPrompt
        })
      })

      if (!response.ok) {
        throw new Error(`Error iniciando background function: ${response.statusText}`)
      }

      console.log('[ESP-04] ✅ Proceso de fondo iniciado correctamente. La curaduría continuará en el servidor.')
      
      // La UI debe reaccionar al cambio de estado en la DB o hacer polling.
      // El background function actualizará el estado a 'PHASE2_GENERATED' al terminar.

    } catch (error: any) {
      console.error('[ESP-04] Error fatal al iniciar pipeline:', error)
      await supabase
        .from('curation')
        .update({ state: 'PHASE2_BLOCKED' })
        .eq('id', curationId)
    }
  },

  // Revalidar todas las URLs pendientes (llamado manualmente)
  async revalidatePendingUrls(artifactId: string): Promise<{ success: boolean; validated: number; ok: number; failed: number }> {
    const supabase = getSupabase()
    console.log('[ESP-04] Revalidando URLs pendientes...')

    try {
      // Obtener curation_id primero
      const { data: curation } = await supabase
        .from('curation')
        .select('id')
        .eq('artifact_id', artifactId)
        .maybeSingle()

      if (!curation) {
        return { success: false, validated: 0, ok: 0, failed: 0 }
      }

      // Obtener filas con URLs pendientes o sin validar
      const { data: rows } = await supabase
        .from('curation_rows')
        .select('id, source_ref, url_status')
        .eq('curation_id', curation.id)
        .or('url_status.eq.PENDING,url_status.is.null')

      if (!rows || rows.length === 0) {
        console.log('[ESP-04] No hay URLs pendientes para validar')
        return { success: true, validated: 0, ok: 0, failed: 0 }
      }

      console.log(`[ESP-04] Revalidando ${rows.length} URLs...`)
      let okCount = 0
      let failedCount = 0

      // Validar en lotes de 3 para evitar saturar
      const BATCH_SIZE = 3
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE)

        await Promise.all(batch.map(async (row: { id: string; source_ref: string }) => {
          try {
            const response = await fetch('/api/validate-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: row.source_ref })
            })
            const result = await response.json()

            const updateData: Record<string, unknown> = {
              url_status: result.url_status,
              http_status_code: result.http_status_code,
              last_checked_at: result.last_checked_at,
              failure_reason: result.failure_reason
            }

            if (result.url_status === 'OK') {
              okCount++
            } else if (result.url_status !== 'PENDING') {
              failedCount++
              // Auto-rechazar si la URL falló
              if (shouldAutoReject(result.url_status)) {
                const reason = getAutoRejectReason(result.url_status)
                if (reason) {
                  updateData.apta = false
                  updateData.auto_evaluated = true
                  updateData.auto_reason = reason
                  updateData.motivo_no_apta = getAutoRejectDescription(reason)
                }
              }
            }

            await supabase
              .from('curation_rows')
              .update(updateData)
              .eq('id', row.id)

          } catch (error) {
            console.error(`[ESP-04] Error validando URL:`, error)
            failedCount++
          }
        }))
      }

      console.log(`[ESP-04] Revalidación completada: ${okCount} OK, ${failedCount} fallidas`)
      return { success: true, validated: rows.length, ok: okCount, failed: failedCount }

    } catch (error) {
      console.error('[ESP-04] Error en revalidación:', error)
      return { success: false, validated: 0, ok: 0, failed: 0 }
    }
  },

  // Agregar fuente manual (auto-aprobada)
  async addManualSource(
    artifactId: string,
    lessonId: string,
    lessonTitle: string,
    component: string,
    url: string,
    title?: string
  ): Promise<{ success: boolean; error?: string }> {
    const supabase = getSupabase()
    console.log(`[ESP-04] Agregando fuente manual para ${lessonId}/${component}`)

    try {
      // Obtener curation_id
      const { data: curation } = await supabase
        .from('curation')
        .select('id')
        .eq('artifact_id', artifactId)
        .maybeSingle()

      if (!curation) {
        return { success: false, error: 'No se encontró la curación' }
      }

      // Crear la fila con fuente manual - auto-aprobada
      const isCritical = ['DIALOGUE', 'READING', 'QUIZ'].includes(component)
      const rowData = {
        curation_id: curation.id,
        lesson_id: lessonId,
        lesson_title: lessonTitle,
        component: component,
        is_critical: isCritical,
        source_ref: url,
        source_title: title || 'Fuente agregada manualmente',
        source_rationale: 'Agregado manualmente por el operador',
        url_status: 'MANUAL',  // Estado especial para fuentes manuales
        apta: true,  // Auto-aprobada
        cobertura_completa: true,  // Asumimos cobertura completa
        notes: 'Fuente agregada manualmente - aprobada automáticamente',
        auto_evaluated: false,  // No es auto-evaluada, es manual
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      const { error } = await supabase
        .from('curation_rows')
        .insert(rowData)

      if (error) {
        console.error('[ESP-04] Error insertando fuente manual:', error)
        return { success: false, error: error.message }
      }

      // Registrar en bitácora
      await supabase.from('pipeline_events').insert({
        artifact_id: artifactId,
        step_id: 'ESP-04',
        entity_type: 'curation',
        entity_id: curation.id,
        event_type: 'NOTE',
        event_data: {
          entry_type: 'MANUAL_SOURCE',
          message: `Fuente manual agregada para ${lessonTitle} - ${component}: ${url}`
        }
      })

      console.log('[ESP-04] Fuente manual agregada exitosamente')
      return { success: true }

    } catch (error: any) {
      console.error('[ESP-04] Error agregando fuente manual:', error)
      return { success: false, error: error.message }
    }
  },

  // Valida URLs pendientes en segundo plano
  async validatePendingUrlsInBackground(curationId: string): Promise<void> {
    const supabase = getSupabase()
    console.log('[ESP-04] Iniciando validación de URLs en segundo plano...')

    try {
      // Obtener filas con URLs pendientes
      const { data: rows } = await supabase
        .from('curation_rows')
        .select('id, source_ref')
        .eq('curation_id', curationId)
        .eq('url_status', 'PENDING')

      if (!rows || rows.length === 0) {
        console.log('[ESP-04] No hay URLs pendientes para validar')
        return
      }

      console.log(`[ESP-04] Validando ${rows.length} URLs...`)

      // Validar en lotes de 5 para no saturar
      const BATCH_SIZE = 5
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE)

        await Promise.all(batch.map(async (row: { id: string; source_ref: string }) => {
          try {
            // Usar API del servidor para evitar CORS
            const response = await fetch('/api/validate-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: row.source_ref })
            })
            const result = await response.json()

            const updateData: Record<string, unknown> = {
              url_status: result.url_status,
              http_status_code: result.http_status_code,
              last_checked_at: result.last_checked_at,
              failure_reason: result.failure_reason
            }

            // Auto-rechazar si la URL falló
            if (shouldAutoReject(result.url_status)) {
              const reason = getAutoRejectReason(result.url_status)
              if (reason) {
                updateData.apta = false
                updateData.auto_evaluated = true
                updateData.auto_reason = reason
                updateData.motivo_no_apta = getAutoRejectDescription(reason)
              }
            }

            await supabase
              .from('curation_rows')
              .update(updateData)
              .eq('id', row.id)

          } catch (error) {
            console.error(`[ESP-04] Error validando URL ${row.source_ref}:`, error)
          }
        }))
      }

      console.log('[ESP-04] Validación de URLs completada')

    } catch (error) {
      console.error('[ESP-04] Error en validación de URLs:', error)
    }
  },

  async getCuration(artifactId: string): Promise<CurationPayload | null> {
    const supabase = getSupabase()

    const { data: curation } = await supabase
      .from('curation')
      .select('*')
      .eq('artifact_id', artifactId)
      .maybeSingle()

    if (!curation) return null

    const { data: rows } = await supabase
      .from('curation_rows')
      .select('*')
      .eq('curation_id', curation.id)
      .order('created_at')

    const { data: blockers } = await supabase
      .from('curation_blockers')
      .select('*')
      .eq('curation_id', curation.id)
      .order('created_at')

    const { data: bitacora } = await supabase
      .from('pipeline_events')
      .select('*')
      .eq('artifact_id', artifactId)
      .eq('step_id', 'ESP-04')
      .eq('entity_type', 'curation')
      .order('created_at')

    return this.transformFromDb(curation, rows || [], blockers || [], bitacora || [])
  },

  async getState(artifactId: string): Promise<Esp04StepState> {
    const supabase = getSupabase()

    const { data } = await supabase
      .from('curation')
      .select('state')
      .eq('artifact_id', artifactId)
      .maybeSingle()

    return (data?.state as Esp04StepState) || 'PHASE2_DRAFT'
  },

  async updateRow(
    artifactId: string,
    rowId: string,
    updates: Partial<CurationRow>
  ): Promise<{ success: boolean; error?: string }> {
    const supabase = getSupabase()

    const { data: row } = await supabase
      .from('curation_rows')
      .select('*, curation:curation_id(id, artifact_id, state)')
      .eq('id', rowId)
      .maybeSingle()

    if (!row) return { success: false, error: 'Fila no encontrada' }

    const curation = row.curation as any
    if (curation.artifact_id !== artifactId) {
      return { success: false, error: 'Fila no pertenece a este artifact' }
    }

    if (updates.forbidden_override === true) {
      if (row.url_status !== 'FORBIDDEN' && row.url_status !== 'AUTH_REQUIRED') {
        return { success: false, error: 'Override solo disponible para 403 o login' }
      }
      updates.auto_evaluated = false
      updates.apta = null
      updates.motivo_no_apta = undefined
      updates.auto_reason = undefined
    }

    if (updates.apta === true) {
      const hasOverride = updates.forbidden_override === true || row.forbidden_override === true
      const canMark = canMarkAsApta(row as CurationRow) || hasOverride

      if (!canMark) {
        return { success: false, error: `No se puede marcar como Apta: URL no funcional (${row.url_status})` }
      }
    }

    if (updates.apta === false && !row.auto_evaluated) {
      updates.cobertura_completa = null
      updates.auto_evaluated = false
    }

    await supabase
      .from('curation_rows')
      .update(updates)
      .eq('id', rowId)

    if (curation.state === 'PHASE2_GENERATED') {
      await supabase
        .from('curation')
        .update({ state: 'PHASE2_HITL_REVIEW' })
        .eq('id', curation.id)
    }

    return { success: true }
  },

  async addBitacoraEntry(
    artifactId: string,
    entry: Omit<BitacoraEntry, 'id' | 'created_at'>
  ): Promise<void> {
    const supabase = getSupabase()

    const { data: curation } = await supabase
      .from('curation')
      .select('id')
      .eq('artifact_id', artifactId)
      .maybeSingle()

    if (!curation) return

    await supabase.from('pipeline_events').insert({
      artifact_id: artifactId,
      step_id: 'ESP-04',
      entity_type: 'curation',
      entity_id: curation.id,
      event_type: entry.entry_type,
      event_data: {
        entry_type: entry.entry_type,
        message: entry.message
      }
    })
  },

  async getRequiredComponents(artifactId: string): Promise<RequiredComponent[]> {
    const plan = await instructionalPlanService.getPlan(artifactId)
    if (!plan) return []

    const components: RequiredComponent[] = []
    for (const lp of plan.lesson_plans) {
      for (const comp of lp.components || []) {
        components.push({
          lesson_id: lp.lesson_id,
          lesson_title: lp.lesson_title,
          component: comp.type,
          is_critical: comp.type === 'DIALOGUE' || comp.type === 'READING' || comp.type === 'QUIZ'
        })
      }
    }
    return components
  },

  /**
   * Busca fuentes para componentes sin cobertura usando Google Search (Gemini)
   * Llama al background function solo para los componentes que faltan
   */
  async fillMissingCoverage(artifactId: string): Promise<{
    success: boolean
    message: string
    gapsFound: number
    searchingFor: number
  }> {
    const supabase = getSupabase()
    console.log('[ESP-04] 🔍 Verificando cobertura y buscando fuentes faltantes...')

    try {
      // Obtener curation
      const curation = await this.getCuration(artifactId)
      if (!curation) {
        return { success: false, message: 'Curaduría no encontrada', gapsFound: 0, searchingFor: 0 }
      }

      // Obtener componentes requeridos y detectar gaps
      const requiredComponents = await this.getRequiredComponents(artifactId)
      const gaps = detectGaps(curation.rows, requiredComponents)

      if (gaps.length === 0) {
        console.log('[ESP-04] ✅ Todos los componentes tienen cobertura')
        return { success: true, message: 'Todos los componentes tienen cobertura', gapsFound: 0, searchingFor: 0 }
      }

      console.log(`[ESP-04] ⚠️ Detectados ${gaps.length} componentes sin cobertura válida`)

      // Convertir gaps a RequiredComponent para el background function
      const missingComponents: RequiredComponent[] = gaps.map(gap => ({
        lesson_id: gap.lesson_id,
        lesson_title: gap.lesson_title,
        component: gap.component,
        is_critical: gap.is_critical
      }))

      // Obtener sesión
      let { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        const refresh = await supabase.auth.refreshSession()
        session = refresh.data.session
      }

      // Obtener artifact para courseName e ideaCentral
      const artifact = await artifactsService.getById(artifactId)
      if (!artifact) {
        return { success: false, message: 'Artifact no encontrado', gapsFound: gaps.length, searchingFor: 0 }
      }

      // Obtener curation_id de la DB
      const { data: dbCuration } = await supabase
        .from('curation')
        .select('id')
        .eq('artifact_id', artifactId)
        .maybeSingle()

      if (!dbCuration) {
        return { success: false, message: 'Curation no encontrada en DB', gapsFound: gaps.length, searchingFor: 0 }
      }

      // Actualizar estado a GENERATING
      await supabase
        .from('curation')
        .update({ state: 'PHASE2_GENERATING' })
        .eq('id', dbCuration.id)

      // Registrar evento
      await supabase.from('pipeline_events').insert({
        artifact_id: artifactId,
        step_id: 'ESP-04',
        entity_type: 'curation',
        entity_id: dbCuration.id,
        event_type: 'INFO',
        event_data: {
          message: `Buscando fuentes para ${missingComponents.length} componentes sin cobertura...`,
          gaps: gaps.map(g => ({ lesson: g.lesson_title, component: g.component, reason: g.reason }))
        }
      })

      console.log(`[ESP-04] 🚀 Enviando ${missingComponents.length} componentes al proceso de búsqueda...`)

      // Llamar al background function SOLO con los componentes faltantes
      const response = await fetch('/.netlify/functions/curation-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          curationId: dbCuration.id,
          artifactId,
          components: missingComponents,
          courseName: (artifact.nombres as string[])?.[0] || artifact.idea_central,
          ideaCentral: artifact.idea_central || '',
          accessToken: session?.access_token || '',
          attemptNumber: curation.attempt_number,
          gaps: gaps.map(g => g.component), // Lista de gaps para el prompt
          promptVersion: 'default'
        })
      })

      if (!response.ok) {
        throw new Error(`Error iniciando búsqueda: ${response.statusText}`)
      }

      console.log('[ESP-04] ✅ Búsqueda de fuentes faltantes iniciada')

      return {
        success: true,
        message: `Buscando fuentes para ${missingComponents.length} componentes...`,
        gapsFound: gaps.length,
        searchingFor: missingComponents.length
      }

    } catch (error: any) {
      console.error('[ESP-04] Error en fillMissingCoverage:', error)
      return { success: false, message: error.message, gapsFound: 0, searchingFor: 0 }
    }
  },

  /**
   * Valida la calidad del contenido de las fuentes usando Gemini
   * Analiza el contenido real de cada URL para determinar si es valioso
   */
  async validateContentQuality(artifactId: string): Promise<{
    success: boolean
    message: string
    validating: number
  }> {
    const supabase = getSupabase()
    console.log('[ESP-04] 🔍 Iniciando validación de calidad de contenido...')

    try {
      // Obtener curation
      const curation = await this.getCuration(artifactId)
      if (!curation) {
        return { success: false, message: 'Curaduría no encontrada', validating: 0 }
      }

      // CONTROL DE CONCURRENCIA: Verificar si ya hay una validación en curso
      // Buscar eventos recientes (últimos 15 minutos) de tipo "validación iniciada" sin "completada"
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
      const { data: recentEvents } = await supabase
        .from('pipeline_events')
        .select('id, event_type, event_data, created_at')
        .eq('artifact_id', artifactId)
        .eq('step_id', 'ESP-04')
        .gte('created_at', fifteenMinutesAgo)
        .order('created_at', { ascending: false })
        .limit(10)

      // Verificar si hay un proceso en curso
      const validationStarted = recentEvents?.find((e: { event_data?: { message?: string }; created_at: string }) =>
        e.event_data?.message?.includes('Iniciando validación completa')
      )
      const validationCompleted = recentEvents?.find((e: { event_data?: { message?: string } }) =>
        e.event_data?.message?.includes('Validación completa finalizada') ||
        e.event_data?.message?.includes('completada')
      )

      if (validationStarted && !validationCompleted) {
        const startTime = new Date(validationStarted.created_at)
        const elapsedMinutes = Math.round((Date.now() - startTime.getTime()) / 60000)
        console.log(`[ESP-04] ⚠️ Ya hay una validación en curso (iniciada hace ${elapsedMinutes} min)`)
        return {
          success: false,
          message: `Ya hay una validación en curso (iniciada hace ${elapsedMinutes} min). Espera a que termine.`,
          validating: 0
        }
      }

      // Obtener curation_id de la DB
      const { data: dbCuration } = await supabase
        .from('curation')
        .select('id')
        .eq('artifact_id', artifactId)
        .maybeSingle()

      if (!dbCuration) {
        return { success: false, message: 'Curation no encontrada en DB', validating: 0 }
      }

      // Filtrar filas que necesitan validación de contenido:
      // - URL status OK o MANUAL
      // - No tienen veredicto de APTA aún (apta es null o undefined)
      // - O tienen apta=true pero NO fueron evaluadas por IA (auto_evaluated !== true)
      console.log('[ESP-04] 🟢 validateContentQuality invocado. Filas totales:', curation.rows.length)

      const rowsToValidate = curation.rows.filter(row => {
        const hasValidUrl = row.url_status === 'OK' || row.url_status === 'MANUAL'
        const neverEvaluated = row.apta === null || row.apta === undefined
        const needsRealEvaluation = row.auto_evaluated !== true // No fue evaluado por IA
        
        // Validar si: tiene URL válida Y (nunca fue evaluado O necesita evaluación real de IA)
        return hasValidUrl && (neverEvaluated || needsRealEvaluation)
      })

      console.log(`[ESP-04] 🔍 Filas pendientes de validación: ${rowsToValidate.length}`)
      if (curation.rows.length > 0) {
        console.log(`[ESP-04] Ejemplo fila[0]: apta=${curation.rows[0].apta}, auto_evaluated=${curation.rows[0].auto_evaluated}, url_status=${curation.rows[0].url_status}`)
      }

      if (rowsToValidate.length === 0) {
        console.log('[ESP-04] ✅ Todas las fuentes ya han sido validadas por IA.')
        return { success: true, message: 'Todas las fuentes ya han sido validadas', validating: 0 }
      }

      console.log(`[ESP-04] 📝 Preparando validación para ${rowsToValidate.length} fuentes...`)

      // Obtener artifact para courseName e ideaCentral
      let artifact
      try {
        artifact = await artifactsService.getById(artifactId)
      } catch (err) {
        console.error('[ESP-04] Error obteniendo artefacto:', err)
        return { success: false, message: 'Error obteniendo datos del artefacto', validating: 0 }
      }

      if (!artifact) {
        return { success: false, message: 'Artifact no encontrado', validating: 0 }
      }

      // Preparar payload para la background function
      const rowsPayload = rowsToValidate.map(row => ({
        id: row.id,
        source_ref: row.source_ref,
        source_title: row.source_title,
        lesson_id: row.lesson_id,
        lesson_title: row.lesson_title,
        component: row.component,
        is_critical: row.is_critical
      }))

      // Llamar a la background function de validación de contenido
      const response = await fetch('/.netlify/functions/content-validation-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          curationId: dbCuration.id,
          artifactId,
          courseName: (artifact.nombres as string[])?.[0] || artifact.idea_central,
          ideaCentral: artifact.idea_central || '',
          rows: rowsPayload
        })
      })

      // Las background functions de Netlify devuelven 202 cuando se encolan exitosamente
      // NO devuelven JSON, solo un status de aceptado
      if (response.status === 202) {
        console.log('[ESP-04] ✅ Validación de contenido iniciada en segundo plano.')
        return {
          success: true,
          message: `Validación iniciada para ${rowsToValidate.length} fuentes. El proceso continuará en segundo plano.`,
          validating: rowsToValidate.length
        }
      }

      // Manejar error 409 (conflicto - ya hay una validación en curso)
      if (response.status === 409) {
        try {
          const errorData = await response.json()
          console.log('[ESP-04] ⚠️ Validación en conflicto:', errorData.message)
          return {
            success: false,
            message: errorData.message || 'Ya hay una validación en curso para este artefacto. Espera a que termine.',
            validating: 0
          }
        } catch {
          return {
            success: false,
            message: 'Ya hay una validación en curso. Espera unos minutos y vuelve a intentar.',
            validating: 0
          }
        }
      }

      if (!response.ok) {
        throw new Error(`Error iniciando validación: ${response.statusText}`)
      }

      // Solo intentar parsear JSON si NO es 202 (caso de ejecución síncrona local)
      let result = { apta: 0, noApta: 0 }
      try {
        const text = await response.text()
        if (text) {
          result = JSON.parse(text)
        }
      } catch {
        console.log('[ESP-04] Respuesta no JSON, asumiendo proceso en segundo plano.')
      }
      console.log('[ESP-04] ✅ Validación de contenido completada:', result)

      return {
        success: true,
        message: `Validación completada: ${result.apta || 0} aptas, ${result.noApta || 0} no aptas`,
        validating: rowsToValidate.length
      }

    } catch (error: any) {
      console.error('[ESP-04] Error en validateContentQuality:', error)
      return { success: false, message: error.message, validating: 0 }
    }
  },

  async runValidations(artifactId: string): Promise<{
    hasErrors: boolean
    canSubmitToQA: boolean
    gaps: DetectedGap[]
    criticalGating: {
      canApprove: boolean
      criticalGaps: Array<{ lesson_id: string; lesson_title: string; component: string; reason: string }>
    }
    attempt2Status: { shouldEnable: boolean; reason: string; gapsCount: number }
  }> {
    const curation = await this.getCuration(artifactId)
    if (!curation) {
      return {
        hasErrors: true,
        canSubmitToQA: false,
        gaps: [],
        criticalGating: { canApprove: false, criticalGaps: [] },
        attempt2Status: { shouldEnable: false, reason: 'Curaduria no encontrada', gapsCount: 0 }
      }
    }

    const requiredComponents = await this.getRequiredComponents(artifactId)
    const validation = runAllValidations(curation.rows, requiredComponents, curation.attempt_number)
    const gaps = detectGaps(curation.rows, requiredComponents)
    const criticalGating = getCriticalGapsForGating(curation.rows, requiredComponents)
    const attempt2Status = shouldEnableAttempt2(curation.rows, requiredComponents, curation.attempt_number)

    return {
      hasErrors: validation.hasErrors,
      canSubmitToQA: !validation.hasErrors || curation.blockers.length > 0,
      gaps,
      criticalGating,
      attempt2Status
    }
  },

  async submitToQA(artifactId: string): Promise<CurationResult> {
    const supabase = getSupabase()
    const curation = await this.getCuration(artifactId)

    if (!curation) {
      return { success: false, state: 'PHASE2_DRAFT', error: 'Curaduria no encontrada' }
    }

    const { canSubmitToQA } = await this.runValidations(artifactId)

    // Gating deshabilitado - ya no es obligatorio que todos los componentes tengan URL válida
    // Solo verificamos errores de validación básicos

    if (!canSubmitToQA) {
      return { success: false, state: curation.state, error: 'Hay errores de validacion sin resolver' }
    }

    await supabase
      .from('curation')
      .update({ state: 'PHASE2_READY_FOR_QA' })
      .eq('artifact_id', artifactId)

    return { success: true, state: 'PHASE2_READY_FOR_QA' }
  },

  async runAttempt2(artifactId: string): Promise<CurationResult> {
    const supabase = getSupabase()
    const curation = await this.getCuration(artifactId)

    if (!curation) {
      return { success: false, state: 'PHASE2_DRAFT', error: 'Curaduria no encontrada' }
    }

    if (curation.attempt_number >= 2) {
      return { success: false, state: curation.state, error: 'Maximo de intentos alcanzado' }
    }

    const requiredComponents = await this.getRequiredComponents(artifactId)
    const gaps = detectGaps(curation.rows, requiredComponents)

    if (gaps.length === 0) {
      return { success: false, state: curation.state, error: 'No hay gaps que resolver' }
    }

    const { data: dbCuration } = await supabase
      .from('curation')
      .select('id')
      .eq('artifact_id', artifactId)
      .maybeSingle()

    if (!dbCuration) {
      return { success: false, state: 'PHASE2_DRAFT', error: 'Curation no encontrada en DB' }
    }

    await supabase
      .from('curation')
      .update({ attempt_number: 2, state: 'PHASE2_GENERATING' })
      .eq('id', dbCuration.id)

    const artifact = await artifactsService.getById(artifactId)
    const plan = await instructionalPlanService.getPlan(artifactId)

    if (!artifact || !plan) {
      await supabase
        .from('curation')
        .update({ state: 'PHASE2_BLOCKED' })
        .eq('id', dbCuration.id)
      return { success: false, state: 'PHASE2_BLOCKED', error: 'Datos no encontrados' }
    }

    try {
      const response = await fetch('/api/curation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          components: requiredComponents,
          courseName: (artifact.nombres as string[])?.[0] || artifact.idea_central,
          ideaCentral: artifact.idea_central,
          attemptNumber: 2,
          gaps,
          validateUrls: true,
          skipAutoRetry: true  // Evitar timeout en Netlify
        })
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const content = await response.json()

      const rowsToInsert = []
      for (const lesson of content.sources_by_lesson || []) {
        for (const comp of lesson.components || []) {
          for (const source of comp.candidate_sources || []) {
            const rowData = createCurationRowData(
              lesson.lesson_id,
              lesson.lesson_title,
              comp.component_name,
              comp.is_critical,
              {
                url: source.url,
                title: source.title,
                rationale: source.rationale,
                url_status: source.url_status,
                http_status_code: source.http_status_code,
                last_checked_at: source.last_checked_at,
                failure_reason: source.failure_reason
              },
              '(Intento 2)'
            )
            rowsToInsert.push({
              curation_id: dbCuration.id,
              ...rowData
            })
          }
        }
      }

      if (rowsToInsert.length > 0) {
        await supabase.from('curation_rows').insert(rowsToInsert)
      }

      await supabase.from('pipeline_events').insert({
        artifact_id: artifactId,
        step_id: 'ESP-04',
        entity_type: 'curation',
        entity_id: dbCuration.id,
        event_type: 'NEXT_STEP',
        event_data: {
          entry_type: 'NEXT_STEP',
          message: `Intento 2: ${gaps.length} gap(s), ${rowsToInsert.length} nuevas fuentes.`
        }
      })

      await supabase
        .from('curation')
        .update({ state: 'PHASE2_HITL_REVIEW' })
        .eq('id', dbCuration.id)

      return { success: true, state: 'PHASE2_HITL_REVIEW' }

    } catch (error: any) {
      await supabase
        .from('curation')
        .update({ state: 'PHASE2_BLOCKED' })
        .eq('id', dbCuration.id)
      return { success: false, state: 'PHASE2_BLOCKED', error: error.message }
    }
  },

  async applyQADecision(
    artifactId: string,
    decision: 'APPROVED' | 'CORRECTABLE' | 'BLOCKED',
    notes?: string
  ): Promise<void> {
    const supabase = getSupabase()

    const { data: curation } = await supabase
      .from('curation')
      .select('id, attempt_number')
      .eq('artifact_id', artifactId)
      .maybeSingle()

    if (!curation) return

    const qaDecision = {
      decision,
      reviewed_by: 'qa-user',
      reviewed_at: new Date().toISOString(),
      notes
    }

    let newState: Esp04StepState
    switch (decision) {
      case 'APPROVED':
        newState = 'PHASE2_APPROVED'
        break
      case 'CORRECTABLE':
        newState = 'PHASE2_CORRECTABLE'
        break
      case 'BLOCKED':
        newState = 'PHASE2_BLOCKED'

        const requiredComponents = await this.getRequiredComponents(artifactId)
        const curationData = await this.getCuration(artifactId)
        if (curationData) {
          const gaps = detectGaps(curationData.rows, requiredComponents)
          const autoBlockers = generateAutoBlockers(gaps, curation.attempt_number)

          if (autoBlockers.length > 0) {
            const blockersToInsert = autoBlockers.map(b => ({
              curation_id: curation.id,
              lesson_id: b.lesson_id,
              lesson_title: b.lesson_title,
              component: b.component,
              impact: b.impact,
              owner: b.owner,
              status: 'OPEN'
            }))
            await supabase.from('curation_blockers').insert(blockersToInsert)
          }
        }
        break
    }

    await supabase
      .from('curation')
      .update({ qa_decision: qaDecision, state: newState })
      .eq('id', curation.id)

    await supabase.from('pipeline_events').insert({
      artifact_id: artifactId,
      step_id: 'ESP-04',
      event_type: `QA_${decision}`,
      event_data: qaDecision
    })
  },

  async addBlocker(
    artifactId: string,
    blocker: Omit<CurationBlocker, 'id' | 'created_at'>
  ): Promise<void> {
    const supabase = getSupabase()

    const { data: curation } = await supabase
      .from('curation')
      .select('id')
      .eq('artifact_id', artifactId)
      .maybeSingle()

    if (!curation) return

    await supabase.from('curation_blockers').insert({
      curation_id: curation.id,
      ...blocker
    })
  },

  async updateBlocker(
    artifactId: string,
    blockerId: string,
    updates: Partial<CurationBlocker>
  ): Promise<void> {
    const supabase = getSupabase()

    await supabase
      .from('curation_blockers')
      .update(updates)
      .eq('id', blockerId)
  },

  async removeBlocker(artifactId: string, blockerId: string): Promise<void> {
    const supabase = getSupabase()

    await supabase
      .from('curation_blockers')
      .delete()
      .eq('id', blockerId)
  },

  async markAllFailedAsNoApta(artifactId: string): Promise<{ success: boolean; count: number; error?: string }> {
    const supabase = getSupabase()
    const curation = await this.getCuration(artifactId)

    if (!curation) return { success: false, count: 0, error: 'Curaduria no encontrada' }

    const { data: dbCuration } = await supabase
      .from('curation')
      .select('id')
      .eq('artifact_id', artifactId)
      .maybeSingle()

    if (!dbCuration) return { success: false, count: 0, error: 'Curation no encontrada' }

    const rowsToUpdate = curation.rows.filter(r =>
      r.url_status !== 'OK' &&
      r.url_status !== 'PENDING' &&
      (r.apta === null || r.auto_evaluated)
    )

    let count = 0
    for (const row of rowsToUpdate) {
      const reason = getAutoRejectReason(row.url_status)
      await supabase
        .from('curation_rows')
        .update({
          apta: false,
          motivo_no_apta: reason ? getAutoRejectDescription(reason) : `URL fallida: ${row.url_status}`,
          auto_evaluated: true,
          auto_reason: reason || undefined
        })
        .eq('id', row.id)
      count++
    }

    if (count > 0) {
      await supabase.from('pipeline_events').insert({
        artifact_id: artifactId,
        step_id: 'ESP-04',
        entity_type: 'curation',
        entity_id: dbCuration.id,
        event_type: 'DECISION',
        event_data: {
          entry_type: 'DECISION',
          message: `Bulk action: ${count} fuente(s) con URL fallida marcada(s) como NO APTA.`
        }
      })

      if (curation.state === 'PHASE2_GENERATED') {
        await supabase
          .from('curation')
          .update({ state: 'PHASE2_HITL_REVIEW' })
          .eq('id', dbCuration.id)
      }
    }

    return { success: true, count }
  },

  async selectWinnerForComponent(
    artifactId: string,
    lessonId: string,
    component: string,
    rowId: string
  ): Promise<{ success: boolean; error?: string }> {
    const supabase = getSupabase()
    const curation = await this.getCuration(artifactId)

    if (!curation) return { success: false, error: 'Curaduria no encontrada' }

    const targetRow = curation.rows.find(r => r.id === rowId)
    if (!targetRow) return { success: false, error: 'Fila no encontrada' }

    if (targetRow.url_status !== 'OK' && !targetRow.forbidden_override) {
      return { success: false, error: 'Solo se pueden seleccionar fuentes con URL funcional' }
    }

    // Marcar ganadora
    await supabase
      .from('curation_rows')
      .update({ apta: true, cobertura_completa: true })
      .eq('id', rowId)

    // Desmarcar otras del mismo componente
    const otherRows = curation.rows.filter(
      r => r.lesson_id === lessonId &&
           r.component === component &&
           r.id !== rowId &&
           r.apta === true
    )

    for (const row of otherRows) {
      await supabase
        .from('curation_rows')
        .update({ cobertura_completa: false })
        .eq('id', row.id)
    }

    const { data: dbCuration } = await supabase
      .from('curation')
      .select('id, state')
      .eq('artifact_id', artifactId)
      .maybeSingle()

    if (dbCuration?.state === 'PHASE2_GENERATED') {
      await supabase
        .from('curation')
        .update({ state: 'PHASE2_HITL_REVIEW' })
        .eq('id', dbCuration.id)
    }

    return { success: true }
  },

  getDetailedMetrics(rows: CurationRow[]): {
    urlOk: number
    urlFailed: number
    urlPending: number
    evaluated: number
    pending: number
    aptaWithCoverageAndUrlOk: number
    noApta: number
    autoEvaluated: number
  } {
    return {
      urlOk: rows.filter(r => r.url_status === 'OK' || r.url_status === 'MANUAL').length,
      urlFailed: rows.filter(r => r.url_status !== 'OK' && r.url_status !== 'PENDING' && r.url_status !== 'MANUAL').length,
      urlPending: rows.filter(r => r.url_status === 'PENDING').length,
      evaluated: rows.filter(r => r.apta !== null).length,
      pending: rows.filter(r => r.apta === null).length,
      aptaWithCoverageAndUrlOk: rows.filter(r =>
        r.apta === true &&
        r.cobertura_completa === true &&
        (r.url_status === 'OK' || r.url_status === 'MANUAL' || r.forbidden_override)
      ).length,
      noApta: rows.filter(r => r.apta === false).length,
      autoEvaluated: rows.filter(r => r.auto_evaluated).length
    }
  },

  async markAllPendingAsApta(artifactId: string): Promise<{ success: boolean; count: number; error?: string }> {
    const supabase = getSupabase()
    const curation = await this.getCuration(artifactId)

    if (!curation) return { success: false, count: 0, error: 'Curaduria no encontrada' }

    const { data: dbCuration } = await supabase
      .from('curation')
      .select('id')
      .eq('artifact_id', artifactId)
      .maybeSingle()

    if (!dbCuration) return { success: false, count: 0, error: 'Curation no encontrada' }

    const rowsToUpdate = curation.rows.filter(r =>
      r.apta === null &&
      (r.url_status === 'OK' || r.forbidden_override)
    )

    let count = 0
    for (const row of rowsToUpdate) {
      await supabase
        .from('curation_rows')
        .update({
          apta: true,
          cobertura_completa: true,
          auto_evaluated: false
        })
        .eq('id', row.id)
      count++
    }

    if (count > 0) {
      await supabase.from('pipeline_events').insert({
        artifact_id: artifactId,
        step_id: 'ESP-04',
        entity_type: 'curation',
        entity_id: dbCuration.id,
        event_type: 'DECISION',
        event_data: {
          entry_type: 'DECISION',
          message: `Bulk action: ${count} fuente(s) pendiente(s) marcada(s) como APTA.`
        }
      })

      if (curation.state === 'PHASE2_GENERATED') {
        await supabase
          .from('curation')
          .update({ state: 'PHASE2_HITL_REVIEW' })
          .eq('id', dbCuration.id)
      }
    }

    return { success: true, count }
  },

  /**
   * Resetear estado de filas rechazadas automáticamente para permitir re-validación
   */
  async resetAutoRejected(artifactId: string): Promise<{ success: boolean; count: number }> {
    const supabase = getSupabase()
    
    // Obtener filas auto-rechazadas
    const { data: rows } = await supabase
      .from('curation_rows')
      .select('id')
      .eq('artifact_id', artifactId)
      .eq('auto_evaluated', true)
      .eq('apta', false)

    if (!rows || rows.length === 0) {
      return { success: true, count: 0 }
    }

    const ids = rows.map((r: any) => r.id)

    // Resetear a estado pendiente
    const { error } = await supabase
      .from('curation_rows')
      .update({
        apta: null,
        cobertura_completa: null,
        auto_evaluated: false,
        auto_reason: null,
        motivo_no_apta: null,
        notes: null // Limpiar notas anteriores
      })
      .in('id', ids)

    if (error) {
      console.error('[CurationService] Error reseteando filas:', error)
      throw new Error('Error al resetear filas rechazadas')
    }

    return { success: true, count: ids.length }
  },

  /**
   * Verificar si hay una validación de contenido en curso para este artifact
   */
  async isValidationRunning(artifactId: string): Promise<{ running: boolean; startedAt?: string; minutesAgo?: number }> {
    const supabase = getSupabase()

    const { data: lock } = await supabase
      .from('pipeline_events')
      .select('id, created_at, event_data')
      .eq('artifact_id', artifactId)
      .eq('step_id', 'ESP-04')
      .eq('event_type', 'VALIDATION_LOCK')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!lock) {
      return { running: false }
    }

    const lockData = lock.event_data as { expiry?: string; released?: boolean }
    const lockExpired = lockData.expiry && new Date(lockData.expiry) < new Date()
    const lockReleased = lockData.released === true

    if (lockExpired || lockReleased) {
      return { running: false }
    }

    const minutesAgo = Math.round((Date.now() - new Date(lock.created_at).getTime()) / 60000)

    return {
      running: true,
      startedAt: lock.created_at,
      minutesAgo
    }
  },

  /**
   * Forzar liberación del lock de validación
   */
  async releaseValidationLock(artifactId: string): Promise<void> {
    const supabase = getSupabase()
    
    const { data: lock } = await supabase
      .from('pipeline_events')
      .select('id, event_data')
      .eq('artifact_id', artifactId)
      .eq('step_id', 'ESP-04')
      .eq('event_type', 'VALIDATION_LOCK')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lock) {
       await supabase.from('pipeline_events').update({
          event_data: {
             ...(lock.event_data as object),
             released: true,
             manual_release: true,
             message: 'Lock liberado manualmente por usuario'
          }
       }).eq('id', lock.id)
    }
  }
}
