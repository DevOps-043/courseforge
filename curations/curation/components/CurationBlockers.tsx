'use client'

import { useState } from 'react'
import { Plus, AlertTriangle, Trash2, Edit2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Textarea } from '@/shared/components/ui/textarea'
import { Badge } from '@/shared/components/ui/badge'
import type { CurationBlocker } from '../types/curation.types'

interface CurationBlockersProps {
  blockers: CurationBlocker[]
  onAdd: (blocker: Omit<CurationBlocker, 'id' | 'created_at'>) => void
  onUpdate: (blockerId: string, updates: Partial<CurationBlocker>) => void
  onRemove: (blockerId: string) => void
  readOnly?: boolean
}

const STATUS_CONFIG = {
  OPEN: { label: 'Abierto', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
  MITIGATING: { label: 'Mitigando', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  ACCEPTED: { label: 'Aceptado', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' }
}

export function CurationBlockers({
  blockers,
  onAdd,
  onUpdate,
  onRemove,
  readOnly = false
}: CurationBlockersProps) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    lesson_id: '',
    lesson_title: '',
    component: '',
    impact: '',
    owner: '',
    status: 'OPEN' as CurationBlocker['status']
  })

  const resetForm = () => {
    setFormData({
      lesson_id: '',
      lesson_title: '',
      component: '',
      impact: '',
      owner: '',
      status: 'OPEN'
    })
  }

  const handleAdd = () => {
    if (!formData.lesson_title.trim() || !formData.component.trim() || !formData.impact.trim()) {
      return
    }

    onAdd({
      lesson_id: formData.lesson_id || formData.lesson_title,
      lesson_title: formData.lesson_title,
      component: formData.component,
      impact: formData.impact,
      owner: formData.owner || 'Pendiente asignar',
      status: formData.status
    })

    resetForm()
    setShowAddForm(false)
  }

  const handleEdit = (blocker: CurationBlocker) => {
    setEditingId(blocker.id)
    setFormData({
      lesson_id: blocker.lesson_id,
      lesson_title: blocker.lesson_title,
      component: blocker.component,
      impact: blocker.impact,
      owner: blocker.owner,
      status: blocker.status
    })
  }

  const handleSaveEdit = () => {
    if (!editingId) return

    onUpdate(editingId, {
      impact: formData.impact,
      owner: formData.owner,
      status: formData.status
    })

    resetForm()
    setEditingId(null)
  }

  const formatDate = (dateStr: string) => {
    return new Intl.DateTimeFormat('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(new Date(dateStr))
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      {!readOnly && (
        <div className="flex justify-between items-center">
          <h3 className="font-medium flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Bloqueadores ({blockers.length})
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              resetForm()
              setShowAddForm(!showAddForm)
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            Agregar Bloqueador
          </Button>
        </div>
      )}

      {/* Formulario agregar */}
      {showAddForm && (
        <Card className="border-orange-500/50 dark:border-orange-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Nuevo Bloqueador</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="Titulo de la leccion"
                value={formData.lesson_title}
                onChange={(e) => setFormData({ ...formData, lesson_title: e.target.value })}
              />
              <Input
                placeholder="Componente (ej: DIALOGUE)"
                value={formData.component}
                onChange={(e) => setFormData({ ...formData, component: e.target.value })}
              />
            </div>

            <Textarea
              placeholder="Impacto del bloqueador..."
              value={formData.impact}
              onChange={(e) => setFormData({ ...formData, impact: e.target.value })}
              rows={2}
            />

            <Input
              placeholder="Responsable"
              value={formData.owner}
              onChange={(e) => setFormData({ ...formData, owner: e.target.value })}
            />

            <div className="flex gap-2">
              <Button onClick={handleAdd}>Guardar</Button>
              <Button variant="outline" onClick={() => setShowAddForm(false)}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista de bloqueadores */}
      <div className="space-y-2">
        {blockers.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              No hay bloqueadores registrados
            </CardContent>
          </Card>
        ) : (
          blockers.map(blocker => {
            const isEditing = editingId === blocker.id
            const statusConfig = STATUS_CONFIG[blocker.status]

            return (
              <Card key={blocker.id} className="border-orange-200 dark:border-orange-800">
                <CardContent className="py-3">
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="font-medium text-sm">
                        {blocker.lesson_title} - {blocker.component}
                      </div>

                      <Textarea
                        value={formData.impact}
                        onChange={(e) => setFormData({ ...formData, impact: e.target.value })}
                        rows={2}
                      />

                      <div className="grid grid-cols-2 gap-3">
                        <Input
                          placeholder="Responsable"
                          value={formData.owner}
                          onChange={(e) => setFormData({ ...formData, owner: e.target.value })}
                        />
                        <select
                          className="border rounded px-3 py-2 text-sm"
                          value={formData.status}
                          onChange={(e) => setFormData({
                            ...formData,
                            status: e.target.value as CurationBlocker['status']
                          })}
                        >
                          <option value="OPEN">Abierto</option>
                          <option value="MITIGATING">Mitigando</option>
                          <option value="ACCEPTED">Aceptado</option>
                        </select>
                      </div>

                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSaveEdit}>Guardar</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{blocker.lesson_title}</span>
                          <Badge variant="outline">{blocker.component}</Badge>
                          <Badge className={statusConfig.color}>{statusConfig.label}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{blocker.impact}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <span>Responsable: {blocker.owner}</span>
                          <span>Creado: {formatDate(blocker.created_at)}</span>
                        </div>
                      </div>

                      {!readOnly && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(blocker)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onRemove(blocker.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
