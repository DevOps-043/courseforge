'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { CheckCircle, XCircle, AlertCircle, Link2Off, Filter, Zap, Trophy, Eye, EyeOff } from 'lucide-react'
import { SourceRow } from './SourceRow'
import type { CurationRow } from '../types/curation.types'
import { getUrlStats } from '../validators/curation.validators'

type UrlFilter = 'all' | 'ok' | 'failed' | 'pending' | 'evaluationPending'

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

interface SourcesTableProps {
  rows: CurationRow[]
  onUpdateRow: (rowId: string, updates: Partial<CurationRow>) => Promise<{ success: boolean; error?: string }>
  onMarkAllFailedAsNoApta?: () => Promise<{ success: boolean; count: number }>
  onMarkAllPendingAsApta?: () => Promise<{ success: boolean; count: number }>
  onSelectWinner?: (lessonId: string, component: string, rowId: string) => Promise<{ success: boolean; error?: string }>
  metrics?: DetailedMetrics | null
  readOnly?: boolean
}

export function SourcesTable({
  rows,
  onUpdateRow,
  onMarkAllFailedAsNoApta,
  onMarkAllPendingAsApta,
  onSelectWinner,
  metrics,
  readOnly = false
}: SourcesTableProps) {
  const [urlFilter, setUrlFilter] = useState<UrlFilter>('all')
  const [hideNoApta, setHideNoApta] = useState(true) // Por defecto ocultar las no aptas
  const [bulkActionLoading, setBulkActionLoading] = useState(false)
  const [bulkActionResult, setBulkActionResult] = useState<string | null>(null)

  // Contar cuantas filas estan ocultas (no aptas)
  const hiddenNoAptaCount = useMemo(() => {
    return rows.filter(r => r.apta === false).length
  }, [rows])

  // Estadisticas de URLs
  const urlStats = useMemo(() => getUrlStats(rows), [rows])

  // Filtrar filas segun filtro de URL y estado de apta
  const filteredRows = useMemo(() => {
    // Primero aplicar filtro de no aptas (ocultar descartadas)
    let result = hideNoApta ? rows.filter(r => r.apta !== false) : rows

    // Luego aplicar filtro de URL
    switch (urlFilter) {
      case 'ok':
        return result.filter(r => r.url_status === 'OK')
      case 'failed':
        return result.filter(r => r.url_status !== 'OK' && r.url_status !== 'PENDING')
      case 'pending':
        return result.filter(r => r.url_status === 'PENDING')
      case 'evaluationPending':
        return result.filter(r => r.apta === null)
      default:
        return result
    }
  }, [rows, urlFilter, hideNoApta])

  // Handler para bulk action - marcar fallidas como NO APTA
  const handleMarkAllFailedAsNoApta = async () => {
    if (!onMarkAllFailedAsNoApta) return
    setBulkActionLoading(true)
    setBulkActionResult(null)
    try {
      const result = await onMarkAllFailedAsNoApta()
      if (result.success) {
        setBulkActionResult(`${result.count} fuente(s) marcada(s) como NO APTA`)
      }
    } catch (e) {
      setBulkActionResult('Error al ejecutar accion')
    } finally {
      setBulkActionLoading(false)
    }
  }

  // Handler para bulk action - marcar pendientes como APTA
  const handleMarkAllPendingAsApta = async () => {
    if (!onMarkAllPendingAsApta) return
    setBulkActionLoading(true)
    setBulkActionResult(null)
    try {
      const result = await onMarkAllPendingAsApta()
      if (result.success) {
        setBulkActionResult(`${result.count} fuente(s) marcada(s) como APTA`)
      }
    } catch (e) {
      setBulkActionResult('Error al ejecutar accion')
    } finally {
      setBulkActionLoading(false)
    }
  }

  // Agrupar filas por leccion y componente
  const groupedByLesson = useMemo(() => {
    const lessonMap = new Map<string, { title: string; components: Map<string, CurationRow[]> }>()

    for (const row of filteredRows) {
      let lesson = lessonMap.get(row.lesson_id)
      if (!lesson) {
        lesson = { title: row.lesson_title, components: new Map() }
        lessonMap.set(row.lesson_id, lesson)
      }

      const componentRows = lesson.components.get(row.component) || []
      componentRows.push(row)
      lesson.components.set(row.component, componentRows)
    }

    // Ordenar lecciones por número (extraer "Lección X.Y" del título)
    const sortedEntries = Array.from(lessonMap.entries()).sort((a, b) => {
      const titleA = a[1].title
      const titleB = b[1].title
      
      // Extraer números de lección (ej: "Lección 1.4" -> [1, 4])
      const matchA = titleA.match(/Lecci[oó]n\s+(\d+)\.(\d+)/i)
      const matchB = titleB.match(/Lecci[oó]n\s+(\d+)\.(\d+)/i)
      
      if (matchA && matchB) {
        const majorA = parseInt(matchA[1], 10)
        const majorB = parseInt(matchB[1], 10)
        if (majorA !== majorB) return majorA - majorB
        
        const minorA = parseInt(matchA[2], 10)
        const minorB = parseInt(matchB[2], 10)
        return minorA - minorB
      }
      
      // Fallback: ordenar alfabéticamente
      return titleA.localeCompare(titleB)
    })

    return new Map(sortedEntries)
  }, [filteredRows])

  // Usar métricas pasadas o calcular localmente
  const evalStats = useMemo(() => {
    if (metrics) return metrics

    return {
      urlOk: rows.filter(r => r.url_status === 'OK').length,
      urlFailed: rows.filter(r => r.url_status !== 'OK' && r.url_status !== 'PENDING').length,
      urlPending: rows.filter(r => r.url_status === 'PENDING').length,
      evaluated: rows.filter(r => r.apta !== null).length,
      pending: rows.filter(r => r.apta === null).length,
      aptaWithCoverageAndUrlOk: rows.filter(r =>
        r.apta === true &&
        r.cobertura_completa === true &&
        (r.url_status === 'OK' || r.forbidden_override)
      ).length,
      noApta: rows.filter(r => r.apta === false).length,
      autoEvaluated: rows.filter(r => r.auto_evaluated).length
    }
  }, [rows, metrics])

  // Calcular pendientes con URL OK (para el botón de bulk action)
  const pendingWithUrlOk = useMemo(() => {
    return rows.filter(r => r.apta === null && (r.url_status === 'OK' || r.forbidden_override)).length
  }, [rows])

  const getComponentStatus = (componentRows: CurationRow[]) => {
    const hasAptaWithCobertura = componentRows.some(
      r => r.apta === true && r.cobertura_completa === true && r.url_status === 'OK'
    )
    const allEvaluated = componentRows.every(r => r.apta !== null)
    const allNoApta = componentRows.every(r => r.apta === false)
    const allUrlsFailed = componentRows.every(r => r.url_status !== 'OK' && r.url_status !== 'PENDING')

    if (allUrlsFailed) return 'url-failed'
    if (hasAptaWithCobertura) return 'complete'
    if (allNoApta) return 'blocked'
    if (!allEvaluated) return 'pending'
    return 'partial'
  }

  const getComponentStatusIcon = (status: string) => {
    switch (status) {
      case 'complete':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'blocked':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'partial':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />
      case 'url-failed':
        return <Link2Off className="h-4 w-4 text-red-500" />
      default:
        return <AlertCircle className="h-4 w-4 text-gray-400" />
    }
  }

  const totalRows = rows.length

  return (
    <div className="space-y-4">
      {/* Metricas principales - 4 contadores separados */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* URL OK */}
            <div className="text-center p-3 rounded-lg bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800">
              <div className="flex items-center justify-center gap-1 text-green-700 dark:text-green-400 mb-1">
                <CheckCircle className="h-4 w-4" />
                <span className="text-xs font-medium">Enlaces Válidos</span>
              </div>
              <div className="text-2xl font-bold text-green-700 dark:text-green-400">{evalStats.urlOk}</div>
              <div className="text-xs text-green-600 dark:text-green-500">{totalRows > 0 ? Math.round(evalStats.urlOk / totalRows * 100) : 0}%</div>
            </div>

            {/* URL FAIL */}
            <div className="text-center p-3 rounded-lg bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800">
              <div className="flex items-center justify-center gap-1 text-red-700 dark:text-red-400 mb-1">
                <Link2Off className="h-4 w-4" />
                <span className="text-xs font-medium">Enlaces Rotos</span>
              </div>
              <div className="text-2xl font-bold text-red-700 dark:text-red-400">{evalStats.urlFailed}</div>
              <div className="text-xs text-red-600 dark:text-red-500">{totalRows > 0 ? Math.round(evalStats.urlFailed / totalRows * 100) : 0}%</div>
            </div>

            {/* Evaluadas */}
            <div className="text-center p-3 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
              <div className="flex items-center justify-center gap-1 text-blue-700 dark:text-blue-400 mb-1">
                <AlertCircle className="h-4 w-4" />
                <span className="text-xs font-medium">Evaluadas</span>
              </div>
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{evalStats.evaluated}</div>
              <div className="text-xs text-blue-600 dark:text-blue-500">de {totalRows} ({evalStats.autoEvaluated} auto)</div>
            </div>

            {/* Apta + Cobertura + URL OK */}
            <div className="text-center p-3 rounded-lg bg-emerald-50 border border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800">
              <div className="flex items-center justify-center gap-1 text-emerald-700 dark:text-emerald-400 mb-1">
                <Trophy className="h-4 w-4" />
                <span className="text-xs font-medium">Aprobadas</span>
              </div>
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{evalStats.aptaWithCoverageAndUrlOk}</div>
              <div className="text-xs text-emerald-600 dark:text-emerald-500">Listas para curso</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filtros y Bulk Actions */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-4 text-sm items-center justify-between">
            {/* Filtros */}
            <div className="flex flex-wrap gap-2 items-center">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Button
                variant={urlFilter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setUrlFilter('all')}
              >
                {hideNoApta ? `Visibles (${totalRows - hiddenNoAptaCount})` : `Todas (${totalRows})`}
              </Button>
              <Button
                variant={urlFilter === 'ok' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setUrlFilter('ok')}
                className={urlFilter === 'ok' ? '' : 'text-green-700 dark:text-green-400'}
              >
                Enlaces Válidos ({evalStats.urlOk})
              </Button>
              <Button
                variant={urlFilter === 'failed' ? 'destructive' : 'outline'}
                size="sm"
                onClick={() => setUrlFilter('failed')}
                className={urlFilter === 'failed' ? '' : 'text-red-700 dark:text-red-400'}
              >
                URL Fallida ({evalStats.urlFailed})
              </Button>
              {evalStats.pending > 0 && (
                <Button
                  variant={urlFilter === 'evaluationPending' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setUrlFilter('evaluationPending')}
                >
                  Pendientes ({evalStats.pending})
                </Button>
              )}

              {/* Toggle para mostrar/ocultar descartadas */}
              {hiddenNoAptaCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setHideNoApta(!hideNoApta)}
                  className="text-muted-foreground"
                >
                  {hideNoApta ? (
                    <>
                      <Eye className="h-4 w-4 mr-1" />
                      Mostrar {hiddenNoAptaCount} descartadas
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-4 w-4 mr-1" />
                      Ocultar descartadas
                    </>
                  )}
                </Button>
              )}
            </div>

            {/* Bulk Actions */}
            {!readOnly && (
              <div className="flex gap-2 items-center flex-wrap">
                {onMarkAllPendingAsApta && pendingWithUrlOk > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleMarkAllPendingAsApta}
                    disabled={bulkActionLoading}
                    className="text-green-700 dark:text-green-400"
                  >
                    <Zap className="h-3 w-3 mr-1" />
                    Marcar {pendingWithUrlOk} pendientes como APTA
                  </Button>
                )}
                {onMarkAllFailedAsNoApta && evalStats.urlFailed > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleMarkAllFailedAsNoApta}
                    disabled={bulkActionLoading}
                    className="text-red-700 dark:text-red-400"
                  >
                    <Zap className="h-3 w-3 mr-1" />
                    Marcar {evalStats.urlFailed} fallidas como NO APTA
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Resultado de bulk action */}
          {bulkActionResult && (
            <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-sm text-blue-700 dark:text-blue-400">
              {bulkActionResult}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Estadisticas detalladas de evaluacion */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Apta:</span>
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                {rows.filter(r => r.apta === true).length}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <span>No Apta:</span>
              <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">{evalStats.noApta}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <span>Sin evaluar:</span>
              <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">{evalStats.pending}</Badge>
            </div>
            {evalStats.autoEvaluated > 0 && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Zap className="h-4 w-4" />
                <span className="text-xs">{evalStats.autoEvaluated} auto-clasificadas</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Warning si hay muchas URLs fallidas sin procesar */}
      {evalStats.urlFailed > 0 && evalStats.urlFailed > evalStats.noApta && (
        <Card className="border-orange-200 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-800">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
              <Link2Off className="h-5 w-5" />
              <span className="font-medium">
                {evalStats.urlFailed} URLs fallidas detectadas.
              </span>
              <span className="text-sm">
                Usa el boton "Marcar fallidas como NO APTA" para procesarlas rapidamente.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabla por leccion */}
      {Array.from(groupedByLesson.entries()).map(([lessonId, lesson]) => (
        <Card key={lessonId}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{lesson.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from(lesson.components.entries()).map(([component, componentRows]) => {
              const status = getComponentStatus(componentRows)
              const isCritical = componentRows.some(r => r.is_critical)
              const okCount = componentRows.filter(r => r.url_status === 'OK').length
              const failedCount = componentRows.filter(r => r.url_status !== 'OK' && r.url_status !== 'PENDING').length

              return (
                <div key={component} className="space-y-2">
                  <div className="flex items-center gap-2">
                    {getComponentStatusIcon(status)}
                    <span className="font-medium text-sm">{component}</span>
                    {isCritical && (
                      <Badge variant="destructive" className="text-xs">CRITICO</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      ({componentRows.length} fuente{componentRows.length !== 1 ? 's' : ''})
                    </span>
                    {failedCount > 0 && (
                      <Badge className="bg-red-100 text-red-800 text-xs dark:bg-red-900/30 dark:text-red-400">
                        {failedCount} URL{failedCount !== 1 ? 's' : ''} fallida{failedCount !== 1 ? 's' : ''}
                      </Badge>
                    )}
                  </div>

                  <div className="space-y-2 pl-6">
                    {componentRows.map(row => (
                      <SourceRow
                        key={row.id}
                        row={row}
                        onUpdate={(updates) => onUpdateRow(row.id, updates)}
                        readOnly={readOnly}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ))}

      {filteredRows.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {urlFilter === 'all' ? 'No hay fuentes generadas aun' : `No hay fuentes con estado "${urlFilter}"`}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
