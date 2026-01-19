'use client'

import { CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import type { CurationDodCheck, CurationValidationCheck } from '../types/curation.types'

interface CurationDodChecklistProps {
  checklist: CurationDodCheck[]
  automaticChecks: CurationValidationCheck[]
}

const DOD_LABELS = {
  DOD_COVERAGE: 'Cobertura por leccion',
  DOD_CRITICAL: 'Componentes criticos cubiertos',
  DOD_OPERABILITY: 'Fuentes NO APTA con motivo',
  DOD_TRACEABILITY: 'Bitacora completa'
}

export function CurationDodChecklist({ checklist, automaticChecks }: CurationDodChecklistProps) {
  const allDodPassed = checklist.every(c => c.pass)
  const allAutomaticPassed = automaticChecks.filter(c => c.severity === 'error').every(c => c.pass)

  return (
    <div className="space-y-4">
      {/* DoD Checklist */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Checklist DoD Fase 2
            {allDodPassed ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-yellow-500" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {checklist.map((check) => (
            <div
              key={check.code}
              className={`flex items-start gap-3 p-3 rounded-lg ${
                check.pass ? 'bg-green-50' : 'bg-yellow-50'
              }`}
            >
              {check.pass ? (
                <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{check.code}</span>
                  <span className="font-medium text-sm">{check.label}</span>
                </div>
                {check.evidence && (
                  <p className="text-sm text-muted-foreground mt-1">{check.evidence}</p>
                )}
                {check.notes && (
                  <p className="text-sm text-yellow-700 mt-1">{check.notes}</p>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Validaciones Automaticas */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Validaciones Automaticas
            {allAutomaticPassed ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {automaticChecks.map((check, index) => (
            <div key={index} className="flex items-center gap-3">
              {check.pass ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : check.severity === 'error' ? (
                <XCircle className="h-4 w-4 text-red-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-yellow-500" />
              )}
              <span className="font-mono text-xs text-muted-foreground">{check.code}</span>
              <span className="text-sm">{check.message}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
