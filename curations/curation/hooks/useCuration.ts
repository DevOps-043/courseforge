'use client'

import { useState, useEffect, useCallback } from 'react'
import type {
  CurationPayload,
  CurationRow,
  BitacoraEntry,
  CurationBlocker,
  Esp04StepState
} from '../types/curation.types'
import { curationService } from '../services/curation.service'
import type { CurationPromptVersion } from '@/shared/config/prompts'

interface DetailedMetrics {
  urlOk: number
  urlFailed: number
  urlPending: number
  evaluated: number
  pending: number
  aptaWithCoverageAndUrlOk: number
  noApta: number
  autoEvaluated: number
}

interface UseCurationReturn {
  curation: CurationPayload | null
  loading: boolean
  error: string | null
  isGenerating: boolean
  isValidationRunning: boolean
  validationMinutesAgo: number | null
  metrics: DetailedMetrics | null
  startCuration: (promptVersion?: CurationPromptVersion, customPrompt?: string) => Promise<void>
  updateRow: (rowId: string, updates: Partial<CurationRow>) => Promise<{ success: boolean; error?: string }>
  addBitacoraEntry: (entry: Omit<BitacoraEntry, 'id' | 'created_at'>) => Promise<void>
  runAttempt2: () => Promise<void>
  submitToQA: () => Promise<void>
  applyQADecision: (decision: 'APPROVED' | 'CORRECTABLE' | 'BLOCKED', notes?: string) => Promise<void>
  addBlocker: (blocker: Omit<CurationBlocker, 'id' | 'created_at'>) => Promise<void>
  updateBlocker: (blockerId: string, updates: Partial<CurationBlocker>) => Promise<void>
  removeBlocker: (blockerId: string) => Promise<void>
  runValidations: () => Promise<{
    hasErrors: boolean
    canSubmitToQA: boolean
    criticalGating: {
      canApprove: boolean
      criticalGaps: Array<{ lesson_id: string; lesson_title: string; component: string; reason: string }>
    }
    attempt2Status: { shouldEnable: boolean; reason: string; gapsCount: number }
  }>
  markAllFailedAsNoApta: () => Promise<{ success: boolean; count: number }>
  markAllPendingAsApta: () => Promise<{ success: boolean; count: number }>
  selectWinnerForComponent: (lessonId: string, component: string, rowId: string) => Promise<{ success: boolean; error?: string }>
  revalidatePendingUrls: () => Promise<{ success: boolean; validated: number; ok: number; failed: number }>
  addManualSource: (lessonId: string, lessonTitle: string, component: string, url: string, title?: string) => Promise<{ success: boolean; error?: string }>
  fillMissingCoverage: () => Promise<{ success: boolean; message: string; gapsFound: number; searchingFor: number }>
  validateContentQuality: () => Promise<{ success: boolean; message: string; validating: number }>
  checkValidationStatus: () => Promise<{ running: boolean; minutesAgo?: number } | void>
  releaseValidationLock: () => Promise<void>
  resetAutoRejected: () => Promise<{ success: boolean; count: number }>
  refetch: () => Promise<void>
}

export function useCuration(artifactId: string): UseCurationReturn {
  const [curation, setCuration] = useState<CurationPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isValidationRunning, setIsValidationRunning] = useState(false)
  const [validationMinutesAgo, setValidationMinutesAgo] = useState<number | null>(null)

  const fetchCuration = useCallback(async () => {
    try {
      const data = await curationService.getCuration(artifactId)
      setCuration(data)
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Error al obtener curaduria')
    } finally {
      setLoading(false)
    }
  }, [artifactId])

  // Función para verificar si hay una validación en curso
  const checkValidationStatus = useCallback(async () => {
    try {
      const status = await curationService.isValidationRunning(artifactId)
      setIsValidationRunning(status.running)
      setValidationMinutesAgo(status.minutesAgo ?? null)
      return status // Devolver el status para uso directo
    } catch (err) {
      console.error('[useCuration] Error verificando estado de validación:', err)
      return { running: false }
    }
  }, [artifactId])

  useEffect(() => {
    fetchCuration()
    checkValidationStatus()
  }, [fetchCuration, checkValidationStatus])

  // Polling para verificar estado de validación cada 10 segundos
  useEffect(() => {
    const interval = setInterval(checkValidationStatus, 10000)
    return () => clearInterval(interval)
  }, [checkValidationStatus])

  // Polling mientras genera (activado por isGenerating O por estado PHASE2_GENERATING)
  useEffect(() => {
    // Activar polling si isGenerating es true O si el estado actual es PHASE2_GENERATING
    const shouldPoll = isGenerating || curation?.state === 'PHASE2_GENERATING'
    if (!shouldPoll) return

    console.log('[useCuration] Polling activo - isGenerating:', isGenerating, 'state:', curation?.state)

    const interval = setInterval(async () => {
      try {
        const state = await curationService.getState(artifactId)
        console.log('[useCuration] Estado actual:', state)

        if (state !== 'PHASE2_GENERATING') {
          console.log('[useCuration] Estado cambió a:', state, '- refrescando datos')
          setIsGenerating(false)
          await fetchCuration()
        }
      } catch (err) {
        console.error('[useCuration] Error en polling:', err)
      }
    }, 3000) // Polling cada 3 segundos

    return () => clearInterval(interval)
  }, [isGenerating, curation?.state, artifactId, fetchCuration])

  const startCuration = async (promptVersion: CurationPromptVersion = 'default', customPrompt?: string) => {
    setIsGenerating(true)
    setError(null)

    try {
      const result = await curationService.startCuration(artifactId, promptVersion, customPrompt)
      if (!result.success) {
        setError(result.error || 'Error al iniciar curaduria')
        setIsGenerating(false)
      }
    } catch (err: any) {
      setError(err.message || 'Error inesperado')
      setIsGenerating(false)
    }
  }

  const updateRow = async (rowId: string, updates: Partial<CurationRow>): Promise<{ success: boolean; error?: string }> => {
    const result = await curationService.updateRow(artifactId, rowId, updates)
    await fetchCuration()
    return result
  }

  const addBitacoraEntry = async (entry: Omit<BitacoraEntry, 'id' | 'created_at'>) => {
    await curationService.addBitacoraEntry(artifactId, entry)
    await fetchCuration()
  }

  const runAttempt2 = async () => {
    setIsGenerating(true)
    setError(null)

    try {
      const result = await curationService.runAttempt2(artifactId)
      if (!result.success) {
        setError(result.error || 'Error al ejecutar intento 2')
      }
      setIsGenerating(false)
      await fetchCuration()
    } catch (err: any) {
      setError(err.message || 'Error inesperado')
      setIsGenerating(false)
    }
  }

  const submitToQA = async () => {
    try {
      const result = await curationService.submitToQA(artifactId)
      if (!result.success) {
        setError(result.error || 'Error al enviar a QA')
      }
      await fetchCuration()
    } catch (err: any) {
      setError(err.message || 'Error inesperado')
    }
  }

  const applyQADecision = async (
    decision: 'APPROVED' | 'CORRECTABLE' | 'BLOCKED',
    notes?: string
  ) => {
    await curationService.applyQADecision(artifactId, decision, notes)
    await fetchCuration()
  }

  const addBlocker = async (blocker: Omit<CurationBlocker, 'id' | 'created_at'>) => {
    await curationService.addBlocker(artifactId, blocker)
    await fetchCuration()
  }

  const updateBlocker = async (blockerId: string, updates: Partial<CurationBlocker>) => {
    await curationService.updateBlocker(artifactId, blockerId, updates)
    await fetchCuration()
  }

  const removeBlocker = async (blockerId: string) => {
    await curationService.removeBlocker(artifactId, blockerId)
    await fetchCuration()
  }

  const runValidations = async () => {
    const result = await curationService.runValidations(artifactId)
    await fetchCuration()
    return result
  }

  const markAllFailedAsNoApta = async () => {
    const result = await curationService.markAllFailedAsNoApta(artifactId)
    await fetchCuration()
    return result
  }

  const markAllPendingAsApta = async () => {
    const result = await curationService.markAllPendingAsApta(artifactId)
    await fetchCuration()
    return result
  }

  const selectWinnerForComponent = async (lessonId: string, component: string, rowId: string) => {
    const result = await curationService.selectWinnerForComponent(artifactId, lessonId, component, rowId)
    await fetchCuration()
    return result
  }

  const revalidatePendingUrls = async () => {
    if (!curation) return { success: false, validated: 0, ok: 0, failed: 0 }
    const result = await curationService.revalidatePendingUrls(artifactId)
    await fetchCuration()
    return result
  }

  const addManualSource = async (lessonId: string, lessonTitle: string, component: string, url: string, title?: string) => {
    const result = await curationService.addManualSource(artifactId, lessonId, lessonTitle, component, url, title)
    await fetchCuration()
    return result
  }

  const fillMissingCoverage = async () => {
    setIsGenerating(true)
    const result = await curationService.fillMissingCoverage(artifactId)
    if (!result.success || result.searchingFor === 0) {
      // Si no hay búsqueda activa, dejar de mostrar "generando"
      setIsGenerating(false)
    }
    // Si hay búsqueda activa, el polling se encargará de actualizar cuando termine
    await fetchCuration()
    return result
  }

  const validateContentQuality = async () => {
    const result = await curationService.validateContentQuality(artifactId)
    await fetchCuration()
    return result
  }

  // Calcular métricas detalladas
  const metrics = curation ? curationService.getDetailedMetrics(curation.rows) : null

  return {
    curation,
    loading,
    error,
    isGenerating,
    isValidationRunning,
    validationMinutesAgo,
    metrics,
    startCuration,
    updateRow,
    addBitacoraEntry,
    runAttempt2,
    submitToQA,
    applyQADecision,
    addBlocker,
    updateBlocker,
    removeBlocker,
    runValidations,
    markAllFailedAsNoApta,
    markAllPendingAsApta,
    selectWinnerForComponent,
    revalidatePendingUrls,
    addManualSource,
    fillMissingCoverage,
    validateContentQuality,
    checkValidationStatus,
    releaseValidationLock: async () => {
      await curationService.releaseValidationLock(artifactId)
      await checkValidationStatus()
    },
    resetAutoRejected: async () => {
      setLoading(true)
      const result = await curationService.resetAutoRejected(artifactId)
      await fetchCuration()
      setLoading(false)
      return result
    },
    refetch: fetchCuration
  }
}
