"use client";
import { useMemo } from "react";
import { Combine, Layers3 } from "lucide-react";
import type { CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import { buildCompositionGroupIndex, resolveCompositionGroupSelection } from "@/domains/production/composition-editor/composition-group-hierarchy";

export function CompositionGroupSelectionControls({ document, editingGroupId, selectedClipIds, disabled, canCreateNestedGroups, canNestTimeline,
  onToggleGroup, onCreateGroup, onNestSelection }: {
  document: CompositionEditorDocument; editingGroupId: string | null; selectedClipIds: ReadonlySet<string>;
  disabled: boolean; canCreateNestedGroups: boolean; canNestTimeline: boolean;
  onToggleGroup?: (groupId: string) => void; onCreateGroup: () => void; onNestSelection?: () => void;
}) {
  const index = useMemo(() => buildCompositionGroupIndex(document.groups), [document.groups]);
  const selection = resolveCompositionGroupSelection(document, selectedClipIds, editingGroupId);
  const available = Boolean(selection && (canCreateNestedGroups || (!editingGroupId && !selection.childGroupIds.length)));
  const siblings = (document.groups ?? []).filter(group => (index.parentByGroupId.get(group.id) ?? null) === editingGroupId);
  return <section aria-label="Agrupar clips y grupos" className="space-y-2 rounded-lg border border-violet-300 bg-violet-50/50 p-3 dark:border-violet-400/30 dark:bg-violet-400/5">
    <h3 className="text-xs font-bold text-violet-900 dark:text-violet-100">Grupos y jerarquía</h3>
    <p className="text-[11px] leading-4 text-slate-600 dark:text-gray-300">Selecciona dos o más unidades del mismo nivel: clips, grupos o ambos. Marca grupos completos aquí o usa Shift/Ctrl/Cmd + clic en el timeline.</p>
    {siblings.length > 0 && <div role="group" aria-label="Grupos del nivel actual" className="max-h-48 space-y-1 overflow-y-auto">
      {siblings.map(group => {
        const leaves = index.leavesByGroupId.get(group.id) ?? [];
        return <label key={group.id} className="flex items-center gap-2 rounded border border-violet-200 px-2 py-1.5 text-xs dark:border-white/10">
          <input type="checkbox" aria-label={`Seleccionar grupo ${group.label || group.id}`} checked={leaves.length > 0 && leaves.every(id => selectedClipIds.has(id))}
            disabled={disabled || !onToggleGroup} onChange={() => onToggleGroup?.(group.id)} />
          <span className="min-w-0 flex-1 truncate">{group.label || group.id}</span><span className="text-[10px] text-slate-500">{leaves.length} clips</span>
        </label>;
      })}
    </div>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={disabled || !available} onClick={onCreateGroup} className="inline-flex items-center gap-1.5 rounded-md border border-violet-300 px-2.5 py-2 text-xs font-bold text-violet-800 disabled:opacity-40 dark:text-violet-100"><Combine size={13} /> Agrupar selección</button>
      <button type="button" disabled={disabled || !available || !canNestTimeline || !onNestSelection} onClick={onNestSelection} title="Colapsar la selección en un solo clip editable" className="inline-flex items-center gap-1.5 rounded-md border border-violet-300 px-2.5 py-2 text-xs font-bold text-violet-800 disabled:opacity-40 dark:text-violet-100"><Layers3 size={13} /> Anidar selección</button>
    </div>
    <p className="text-[10px] leading-4 text-slate-500 dark:text-gray-400">Agrupar conserva los clips visibles y crea un grupo padre. Anidar colapsa la selección en un clip editable.</p>
    {!canCreateNestedGroups && <p role="status" className="text-[11px] leading-4 text-amber-800 dark:text-amber-200">Agrupar agrupaciones no está habilitado en este entorno. Requiere habilitación del servidor y la migración SQL compatible; cambiar la selección no activa esta capacidad. Los clips sueltos todavía pueden agruparse en la raíz.</p>}
    {!selection && selectedClipIds.size > 0 && <p className="text-[11px] text-slate-500">Selecciona al menos dos unidades completas del mismo nivel. Para incluir este grupo como una unidad, vuelve a su nivel padre.</p>}
    {!canNestTimeline && <p className="text-[10px] text-slate-500">La anidación del timeline no está habilitada en este entorno.</p>}
  </section>;
}
