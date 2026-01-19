'use client'

import { useState } from 'react'
import { CheckCircle, XCircle, AlertCircle, ExternalLink, ChevronDown, ChevronUp, Link2Off, Shield, Clock, Zap, Unlock } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'
import { Badge } from '@/shared/components/ui/badge'
import type { CurationRow, UrlStatus } from '../types/curation.types'
import { getUrlStatusLabel, getUrlStatusColor, canOverrideForbidden } from '../services/urlValidation.service'

interface SourceRowProps {
  row: CurationRow
  onUpdate: (updates: Partial<CurationRow>) => Promise<{ success: boolean; error?: string }>
  readOnly?: boolean
}

export function SourceRow({ row, onUpdate, readOnly = false }: SourceRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [motivo, setMotivo] = useState(row.motivo_no_apta || '')
  const [error, setError] = useState<string | null>(null)

  // URL es valida para marcar como Apta (OK, MANUAL, o con override)
  const canMarkApta = row.url_status === 'OK' || row.url_status === 'MANUAL' || row.forbidden_override === true

  // Puede usar override (solo para 403/AUTH_REQUIRED)
  const canUseOverride = canOverrideForbidden(row.url_status)

  // Es auto-evaluada
  const isAutoEvaluated = row.auto_evaluated === true

  const getStatusIcon = () => {
    // Si tiene override, tratar como OK
    if (row.forbidden_override) {
      if (row.apta === null) return <AlertCircle className="h-4 w-4 text-yellow-500" />
      if (row.apta && row.cobertura_completa) return <CheckCircle className="h-4 w-4 text-green-500" />
      if (row.apta && !row.cobertura_completa) return <AlertCircle className="h-4 w-4 text-yellow-500" />
      return <XCircle className="h-4 w-4 text-red-500" />
    }

    // Primero verificar estado de URL
    if (row.url_status !== 'OK' && row.url_status !== 'MANUAL' && row.url_status !== 'PENDING') {
      // Si fue auto-evaluada, mostrar icono diferente
      if (isAutoEvaluated) {
        return <Zap className="h-4 w-4 text-orange-500" />
      }
      return <Link2Off className="h-4 w-4 text-red-500" />
    }
    if (row.url_status === 'PENDING') {
      return <Clock className="h-4 w-4 text-gray-400" />
    }

    // Luego verificar evaluacion HITL
    if (row.apta === null) {
      return <AlertCircle className="h-4 w-4 text-yellow-500" />
    }
    if (row.apta && row.cobertura_completa) {
      return <CheckCircle className="h-4 w-4 text-green-500" />
    }
    if (row.apta && !row.cobertura_completa) {
      return <AlertCircle className="h-4 w-4 text-yellow-500" />
    }
    return <XCircle className="h-4 w-4 text-red-500" />
  }

  const getStatusBg = () => {
    // Override activo tiene color especial
    if (row.forbidden_override) {
      if (row.apta === null) return 'bg-purple-50 border-purple-200 dark:bg-purple-900/20 dark:border-purple-800'
      if (row.apta && row.cobertura_completa) return 'bg-green-50 dark:bg-green-900/20'
      if (row.apta && !row.cobertura_completa) return 'bg-yellow-50 dark:bg-yellow-900/20'
      return 'bg-red-50 dark:bg-red-900/20'
    }

    // URL fallida tiene prioridad visual
    if (row.url_status !== 'OK' && row.url_status !== 'MANUAL' && row.url_status !== 'PENDING') {
      return 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
    }
    if (row.url_status === 'PENDING') {
      return 'bg-gray-50 dark:bg-slate-800'
    }

    if (row.apta === null) return 'bg-yellow-50 dark:bg-yellow-900/20'
    if (row.apta && row.cobertura_completa) return 'bg-green-50 dark:bg-green-900/20'
    if (row.apta && !row.cobertura_completa) return 'bg-yellow-50 dark:bg-yellow-900/20'
    return 'bg-red-50 dark:bg-red-900/20'
  }

  const handleAptaChange = async (value: boolean) => {
    setError(null)
    const result = await onUpdate({ apta: value })
    if (!result.success && result.error) {
      setError(result.error)
    }
    if (value) {
      setMotivo('')
    }
  }

  const handleCoberturaChange = async (value: boolean) => {
    setError(null)
    await onUpdate({ cobertura_completa: value })
  }

  const handleMotivoSave = async () => {
    await onUpdate({ motivo_no_apta: motivo })
  }

  const handleOverride = async () => {
    setError(null)
    const result = await onUpdate({ forbidden_override: true })
    if (!result.success && result.error) {
      setError(result.error)
    }
  }

  return (
    <div className={`border rounded-lg p-3 ${getStatusBg()}`}>
      <div className="flex items-start gap-3">
        {/* Status icon */}
        <div className="flex-shrink-0 mt-1">
          {getStatusIcon()}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate dark:text-slate-200">
              {row.source_title || row.source_ref}
            </span>
            {row.is_critical && (
              <Badge variant="destructive" className="text-xs">CRITICO</Badge>
            )}
            <Badge variant="outline" className="text-xs">{row.component}</Badge>

            {/* URL Status Badge */}
            <Badge className={`text-xs ${getUrlStatusColor(row.url_status)}`}>
              {getUrlStatusLabel(row.url_status)}
            </Badge>

            {/* Auto-evaluated badge */}
            {isAutoEvaluated && (
              <Badge className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                <Zap className="h-3 w-3 mr-1" />
                Auto
              </Badge>
            )}

            {/* Override badge */}
            {row.forbidden_override && (
              <Badge className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                <Unlock className="h-3 w-3 mr-1" />
                Override
              </Badge>
            )}
          </div>

          {/* URL con indicador de estado */}
          {row.source_ref && row.source_ref.startsWith('http') && (
            <div className="flex items-center gap-2 mt-1">
              <a
                href={row.source_ref}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-xs hover:underline flex items-center gap-1 ${
                  row.url_status === 'OK' || row.forbidden_override ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400 line-through'
                }`}
              >
                <ExternalLink className="h-3 w-3" />
                {row.source_ref.length > 50 ? row.source_ref.slice(0, 50) + '...' : row.source_ref}
              </a>
              {row.http_status_code && (
                <span className="text-xs text-muted-foreground">
                  ({row.http_status_code})
                </span>
              )}
            </div>
          )}

          {/* Failure reason */}
          {row.failure_reason && !row.forbidden_override && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              {row.failure_reason}
            </p>
          )}

          {/* Auto-reject reason */}
          {isAutoEvaluated && row.auto_reason && (
            <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
              Auto-clasificado: {row.motivo_no_apta}
            </p>
          )}

          {row.source_rationale && (
            <p className="text-xs text-muted-foreground mt-1">
              {row.source_rationale}
            </p>
          )}

          {/* Resultado Evaluación IA */}
          {row.notes && row.notes.startsWith('[R=') && (
            <div className="mt-2 p-2 rounded border bg-background/50 text-xs">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="h-3 w-3 text-blue-500" />
                <span className="font-semibold text-blue-700 dark:text-blue-400">Análisis de Calidad IA</span>
              </div>
              <p className="text-foreground/90 font-mono text-[10px] sm:text-xs">
                {row.notes.split(']')[0] + ']'}
              </p>
              <p className="text-muted-foreground mt-1">
                {row.notes.split(']').slice(1).join(']').trim()}
              </p>
            </div>
          )}

          {/* Error message */}
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-medium">
              {error}
            </p>
          )}
        </div>

        {/* Expand button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {/* Expanded controls */}
      {expanded && (
        <div className="mt-3 pt-3 border-t dark:border-slate-800 space-y-3">
          {/* Warning si URL no funciona y no tiene override */}
          {!canMarkApta && !row.forbidden_override && (
            <div className="flex items-center gap-2 p-2 bg-red-100 dark:bg-red-900/20 rounded text-sm text-red-700 dark:text-red-400">
              <Shield className="h-4 w-4" />
              <span>Esta fuente no puede marcarse como Apta porque la URL no es accesible.</span>
            </div>
          )}

          {/* Opcion de override para 403/paywall */}
          {canUseOverride && !row.forbidden_override && !readOnly && (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800">
              <p className="text-sm text-yellow-800 dark:text-yellow-400 mb-2">
                Esta URL requiere autenticacion o tiene acceso restringido (403).
                Si puedes acceder en tu entorno, puedes usar el override.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleOverride}
                className="text-yellow-700 dark:text-yellow-400"
              >
                <Unlock className="h-4 w-4 mr-2" />
                Accesible en mi entorno
              </Button>
            </div>
          )}

          {/* Override activo */}
          {row.forbidden_override && (
            <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded text-sm text-purple-700 dark:text-purple-400">
              <div className="flex items-center gap-2">
                <Unlock className="h-4 w-4" />
                <span>Override activo: Se permite evaluar a pesar del error HTTP.</span>
              </div>
            </div>
          )}

          {/* Apta selector */}
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium w-20">Apta:</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={row.apta === true ? 'default' : 'outline'}
                onClick={() => handleAptaChange(true)}
                disabled={readOnly || !canMarkApta}
                title={!canMarkApta ? 'URL no funcional' : undefined}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Si
              </Button>
              <Button
                size="sm"
                variant={row.apta === false ? 'destructive' : 'outline'}
                onClick={() => handleAptaChange(false)}
                disabled={readOnly}
              >
                <XCircle className="h-4 w-4 mr-1" />
                No
              </Button>
            </div>
          </div>

          {/* Motivo NO APTA */}
          {row.apta === false && (
            <div className="space-y-2">
              <span className="text-sm font-medium">Motivo (requerido):</span>
              <Textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                onBlur={handleMotivoSave}
                placeholder="Explica por que la fuente no es apta..."
                rows={2}
                disabled={readOnly}
                className="text-sm"
              />
            </div>
          )}

          {/* Cobertura selector (solo si es apta) */}
          {row.apta === true && (
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium w-20">Cobertura:</span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={row.cobertura_completa === true ? 'default' : 'outline'}
                  onClick={() => handleCoberturaChange(true)}
                  disabled={readOnly}
                >
                  Completa
                </Button>
                <Button
                  size="sm"
                  variant={row.cobertura_completa === false ? 'secondary' : 'outline'}
                  onClick={() => handleCoberturaChange(false)}
                  disabled={readOnly}
                >
                  Parcial
                </Button>
              </div>
            </div>
          )}

          {/* Notas */}
          <div className="space-y-2">
            <span className="text-sm font-medium">Notas (opcional):</span>
            <Textarea
              value={row.notes || ''}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              placeholder="Notas adicionales..."
              rows={1}
              disabled={readOnly}
              className="text-sm"
            />
          </div>

          {/* Info de validacion de URL */}
          {row.last_checked_at && (
            <p className="text-xs text-muted-foreground">
              URL verificada: {new Date(row.last_checked_at).toLocaleString('es-ES')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
