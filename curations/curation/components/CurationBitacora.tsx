'use client'

import { useState } from 'react'
import { Plus, FileText, AlertCircle, ArrowRight, Trash2, MessageSquare } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'
import { Badge } from '@/shared/components/ui/badge'
import type { BitacoraEntry } from '../types/curation.types'

interface CurationBitacoraProps {
  entries: BitacoraEntry[]
  onAdd: (entry: Omit<BitacoraEntry, 'id' | 'created_at'>) => void
  readOnly?: boolean
}

const ENTRY_TYPE_CONFIG = {
  DECISION: { label: 'Decision', icon: FileText, color: 'bg-blue-100 text-blue-800' },
  DISCARD: { label: 'Descarte', icon: Trash2, color: 'bg-red-100 text-red-800' },
  GAP: { label: 'Brecha', icon: AlertCircle, color: 'bg-yellow-100 text-yellow-800' },
  NEXT_STEP: { label: 'Siguiente Paso', icon: ArrowRight, color: 'bg-green-100 text-green-800' },
  NOTE: { label: 'Nota', icon: MessageSquare, color: 'bg-gray-100 text-gray-800' }
}

export function CurationBitacora({ entries, onAdd, readOnly = false }: CurationBitacoraProps) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [newEntryType, setNewEntryType] = useState<BitacoraEntry['entry_type']>('NOTE')
  const [newEntryMessage, setNewEntryMessage] = useState('')

  const handleAdd = () => {
    if (!newEntryMessage.trim()) return

    onAdd({
      entry_type: newEntryType,
      message: newEntryMessage.trim()
    })

    setNewEntryMessage('')
    setShowAddForm(false)
  }

  const formatDate = (dateStr: string) => {
    return new Intl.DateTimeFormat('es-ES', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(dateStr))
  }

  return (
    <div className="space-y-4">
      {/* Header con boton agregar */}
      {!readOnly && (
        <div className="flex justify-between items-center">
          <h3 className="font-medium">Bitacora de Curaduria</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Agregar Entrada
          </Button>
        </div>
      )}

      {/* Formulario agregar */}
      {showAddForm && (
        <Card className="border-primary/50">
          <CardContent className="pt-4 space-y-3">
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(ENTRY_TYPE_CONFIG) as BitacoraEntry['entry_type'][]).map(type => {
                const config = ENTRY_TYPE_CONFIG[type]
                return (
                  <Button
                    key={type}
                    size="sm"
                    variant={newEntryType === type ? 'default' : 'outline'}
                    onClick={() => setNewEntryType(type)}
                  >
                    <config.icon className="h-4 w-4 mr-1" />
                    {config.label}
                  </Button>
                )
              })}
            </div>

            <Textarea
              value={newEntryMessage}
              onChange={(e) => setNewEntryMessage(e.target.value)}
              placeholder="Describe la decision, descarte, brecha o siguiente paso..."
              rows={3}
            />

            <div className="flex gap-2">
              <Button onClick={handleAdd} disabled={!newEntryMessage.trim()}>
                Guardar
              </Button>
              <Button variant="outline" onClick={() => setShowAddForm(false)}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista de entradas */}
      <div className="space-y-2">
        {entries.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              No hay entradas en la bitacora
            </CardContent>
          </Card>
        ) : (
          entries.slice().reverse().map(entry => {
            const config = ENTRY_TYPE_CONFIG[entry.entry_type] || ENTRY_TYPE_CONFIG.NOTE
            const Icon = config.icon

            return (
              <Card key={entry.id}>
                <CardContent className="py-3">
                  <div className="flex items-start gap-3">
                    <div className={`p-1.5 rounded ${config.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Badge className={config.color}>{config.label}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(entry.created_at)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">{entry.message}</p>
                      {entry.lesson_id && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Leccion: {entry.lesson_id} | Componente: {entry.component}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
