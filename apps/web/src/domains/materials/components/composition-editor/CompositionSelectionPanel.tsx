"use client";

import { useState, type ReactNode } from "react";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ChevronsLeft, ClipboardCopy, ClipboardPaste, Combine, Copy, FolderOpen, Layers3, LogOut, MousePointer2, Trash2, Ungroup, X } from "lucide-react";
import type { CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import { formatCompositionTimecode } from "@/domains/production/composition-editor/composition-timecode";
import type {
  CompositionSelectionAlignment,
  CompositionSelectionAlignmentTarget,
  CompositionSelectionDistributionAxis,
} from "@/domains/production/composition-editor/composition-selection-layout.service";
import {
  clampCompositionTimelineFrameStep,
  type CompositionTimelineKeyboardEditMode,
} from "@/domains/production/composition-editor/composition-timeline-interaction.service";

interface CompositionSelectionPanelProps {
  canPaste: boolean;
  document: CompositionEditorDocument;
  editingGroupId: string | null;
  frameStep: number;
  keyboardEditMode: CompositionTimelineKeyboardEditMode;
  onAlign: (alignment: CompositionSelectionAlignment, target: CompositionSelectionAlignmentTarget) => void;
  onClear: () => void;
  onCopy: () => void;
  onCreateGroup: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onDistribute: (axis: CompositionSelectionDistributionAxis) => void;
  onEnterGroup: () => void;
  onExitGroup: () => void;
  onInspectClip: (hfId: string) => void;
  onFrameStepChange: (frameStep: number) => void;
  onKeyboardEditModeChange: (mode: CompositionTimelineKeyboardEditMode) => void;
  onPaste: () => void;
  onRippleDelete: () => void;
  onRoll: (edge: "LEFT" | "RIGHT", deltaFrames: number) => void;
  onSlide: (deltaFrames: number) => void;
  onUngroup: () => void;
  saving: boolean;
  selectedClipIds: ReadonlySet<string>;
  selectedGroupId: string | null;
}

export function CompositionSelectionPanel({ canPaste, document, editingGroupId, frameStep, keyboardEditMode, onAlign, onClear, onCopy, onCreateGroup, onDelete, onDistribute, onDuplicate, onEnterGroup, onExitGroup, onFrameStepChange, onInspectClip, onKeyboardEditModeChange, onPaste, onRippleDelete, onRoll, onSlide, onUngroup, saving, selectedClipIds, selectedGroupId }: CompositionSelectionPanelProps) {
  const [alignmentTarget, setAlignmentTarget] = useState<CompositionSelectionAlignmentTarget>("CANVAS");
  const selectedClips = document.clips.filter((clip) => selectedClipIds.has(clip.id));
  const selectedGroup = document.groups?.find((group) => group.id === selectedGroupId) || null;
  const editingGroup = document.groups?.find((group) => group.id === editingGroupId) || null;
  const groupedClipIds = new Set((document.groups || []).flatMap((group) => group.clipIds));
  const canCreateGroup = selectedClips.length >= 2 && selectedClips.every((clip) => !groupedClipIds.has(clip.id));
  const tracksById = new Map(document.tracks.map((track) => [track.id, track]));
  const hasLockedTrack = selectedClips.some((clip) => tracksById.get(clip.trackId)?.locked);
  const visualClipCount = selectedClips.filter((clip) => tracksById.get(clip.trackId)?.kind !== "AUDIO").length;

  if (!selectedClips.length) {
    return <div className="grid min-h-44 place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-4 text-center text-xs leading-5 text-slate-500 dark:border-white/15 dark:bg-white/5 dark:text-gray-400"><span><MousePointer2 className="mx-auto mb-2" size={20} />Activa <strong>Selección múltiple</strong> en el timeline o usa Ctrl/Cmd o Shift + clic para elegir assets.</span></div>;
  }

  return <div className="space-y-3">
    <section className="rounded-lg border border-violet-200 bg-violet-50/70 p-3 text-violet-950 dark:border-violet-400/25 dark:bg-violet-400/10 dark:text-violet-100">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-bold"><Layers3 size={14} /> {selectedClips.length} asset{selectedClips.length === 1 ? "" : "s"} seleccionado{selectedClips.length === 1 ? "" : "s"}</p>
          <p className="mt-1 truncate text-[10px] opacity-75">{editingGroup ? `Editando ${editingGroup.label || editingGroup.id}` : selectedGroup ? selectedGroup.label || "Agrupación seleccionada" : "Selección del timeline"}</p>
        </div>
        <button type="button" disabled={saving} onClick={onClear} className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-white px-2 py-1 text-[10px] font-bold disabled:opacity-40 dark:border-violet-300/30 dark:bg-white/10"><X size={11} /> Limpiar</button>
      </div>
    </section>

    <div className="space-y-1.5" aria-label="Assets seleccionados">
      {selectedClips.map((clip) => {
        const track = tracksById.get(clip.trackId);
        return <button key={clip.id} type="button" onClick={() => onInspectClip(clip.hfId)} className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-left transition-colors hover:border-cyan-300 hover:bg-cyan-50/60 dark:border-white/10 dark:bg-white/5 dark:hover:border-cyan-400/40 dark:hover:bg-cyan-400/10">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-cyan-50 text-[9px] font-black text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-200">{clip.kind.slice(0, 3)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-slate-900 dark:text-white">{clip.label}</span>
            <span className="mt-0.5 block truncate text-[10px] text-slate-500 dark:text-gray-400">{track?.label || clip.trackId} · {formatCompositionTimecode(clip.startSeconds)}–{formatCompositionTimecode(clip.startSeconds + clip.durationSeconds)}</span>
          </span>
        </button>;
      })}
    </div>

    <div className="grid gap-2 border-t border-slate-200 pt-3 dark:border-white/10">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={saving} onClick={onCopy} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-2 text-xs font-bold text-slate-700 disabled:opacity-40 dark:border-white/15 dark:text-gray-200"><ClipboardCopy size={13} /> Copiar</button>
        <button type="button" disabled={saving || !canPaste} onClick={onPaste} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-2 text-xs font-bold text-emerald-800 disabled:opacity-40 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100"><ClipboardPaste size={13} /> Pegar en playhead</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={saving || hasLockedTrack} onClick={onDuplicate} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-cyan-300 bg-cyan-50 px-2.5 py-2 text-xs font-bold text-cyan-800 disabled:opacity-40 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-100"><Copy size={13} /> Duplicar</button>
        <button type="button" disabled={saving || hasLockedTrack} onClick={onDelete} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-300 px-2.5 py-2 text-xs font-bold text-red-700 disabled:opacity-40 dark:border-red-400/30 dark:text-red-200"><Trash2 size={13} /> Eliminar</button>
      </div>
      <button type="button" disabled={saving || hasLockedTrack} onClick={onRippleDelete} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs font-bold text-amber-800 disabled:opacity-40 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"><ChevronsLeft size={13} /> Eliminar y cerrar hueco</button>
      {hasLockedTrack && <p className="text-[10px] leading-4 text-amber-700 dark:text-amber-200">Desbloquea todas las pistas seleccionadas para usar acciones masivas.</p>}
      <section className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-white/10">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400">Layout visual</p>
          <select
            aria-label="Referencia de alineación"
            className="rounded border border-slate-300 bg-transparent px-1.5 py-1 text-[10px] text-slate-800 dark:border-white/15 dark:text-white"
            disabled={saving}
            onChange={(event) => setAlignmentTarget(event.target.value as CompositionSelectionAlignmentTarget)}
            value={alignmentTarget}
          >
            <option value="CANVAS">Al canvas</option>
            <option value="SELECTION">A la selección</option>
          </select>
        </div>
        <div className="grid grid-cols-3 gap-1.5" aria-label="Alinear elementos visuales">
          <LayoutButton disabled={saving || hasLockedTrack || visualClipCount < (alignmentTarget === "CANVAS" ? 1 : 2)} label="Izquierda" onClick={() => onAlign("LEFT", alignmentTarget)}><AlignStartVertical size={13} /></LayoutButton>
          <LayoutButton disabled={saving || hasLockedTrack || visualClipCount < (alignmentTarget === "CANVAS" ? 1 : 2)} label="Centro H" onClick={() => onAlign("HORIZONTAL_CENTER", alignmentTarget)}><AlignCenterVertical size={13} /></LayoutButton>
          <LayoutButton disabled={saving || hasLockedTrack || visualClipCount < (alignmentTarget === "CANVAS" ? 1 : 2)} label="Derecha" onClick={() => onAlign("RIGHT", alignmentTarget)}><AlignEndVertical size={13} /></LayoutButton>
          <LayoutButton disabled={saving || hasLockedTrack || visualClipCount < (alignmentTarget === "CANVAS" ? 1 : 2)} label="Arriba" onClick={() => onAlign("TOP", alignmentTarget)}><AlignStartHorizontal size={13} /></LayoutButton>
          <LayoutButton disabled={saving || hasLockedTrack || visualClipCount < (alignmentTarget === "CANVAS" ? 1 : 2)} label="Centro V" onClick={() => onAlign("VERTICAL_CENTER", alignmentTarget)}><AlignCenterHorizontal size={13} /></LayoutButton>
          <LayoutButton disabled={saving || hasLockedTrack || visualClipCount < (alignmentTarget === "CANVAS" ? 1 : 2)} label="Abajo" onClick={() => onAlign("BOTTOM", alignmentTarget)}><AlignEndHorizontal size={13} /></LayoutButton>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <LayoutButton disabled={saving || hasLockedTrack || visualClipCount < 3} label="Distribuir H" onClick={() => onDistribute("HORIZONTAL")}><AlignHorizontalDistributeCenter size={13} /></LayoutButton>
          <LayoutButton disabled={saving || hasLockedTrack || visualClipCount < 3} label="Distribuir V" onClick={() => onDistribute("VERTICAL")}><AlignVerticalDistributeCenter size={13} /></LayoutButton>
        </div>
        <p className="text-[10px] leading-4 text-slate-500 dark:text-gray-400">Opera sobre las cajas persistidas del layout. El audio se ignora y los grupos visuales deben seleccionarse completos.</p>
      </section>
      <section className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-white/10">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400">Edición por frame</p>
          <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-gray-400">
            Paso
            <input
              aria-label="Frames por ajuste de roll o slide"
              className="w-14 rounded border border-slate-300 bg-transparent px-1.5 py-1 text-right font-mono text-[10px] text-slate-800 dark:border-white/15 dark:text-white"
              disabled={saving}
              max={300}
              min={1}
              onChange={(event) => onFrameStepChange(clampCompositionTimelineFrameStep(Number(event.target.value)))}
              type="number"
              value={frameStep}
            />
            f
          </label>
        </div>
        <label className="flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-500 dark:text-gray-400">
          Atajo Alt + ←/→
          <select
            aria-label="Operación del atajo de edición por frame"
            className="rounded border border-slate-300 bg-transparent px-1.5 py-1 text-[10px] text-slate-800 dark:border-white/15 dark:text-white"
            disabled={saving}
            onChange={(event) => onKeyboardEditModeChange(event.target.value as CompositionTimelineKeyboardEditMode)}
            value={keyboardEditMode}
          >
            <option value="SLIDE">Slide</option>
            <option value="ROLL_LEFT">Roll entrada</option>
            <option value="ROLL_RIGHT">Roll salida</option>
          </select>
        </label>
        <p className="text-[10px] leading-4 text-slate-500 dark:text-gray-400">Los grupos alineados y pares avatar‑voz se ajustan como una sola edición atómica. También puedes mantener Alt mientras arrastras el bloque o sus bordes.</p>
        <div className="grid grid-cols-2 gap-1.5">
          <FrameEditButton disabled={saving || hasLockedTrack} label={`Slide −${frameStep}f`} onClick={() => onSlide(-frameStep)} />
          <FrameEditButton disabled={saving || hasLockedTrack} label={`Slide +${frameStep}f`} onClick={() => onSlide(frameStep)} />
          <FrameEditButton disabled={saving || hasLockedTrack} label={`Roll entrada −${frameStep}f`} onClick={() => onRoll("LEFT", -frameStep)} />
          <FrameEditButton disabled={saving || hasLockedTrack} label={`Roll entrada +${frameStep}f`} onClick={() => onRoll("LEFT", frameStep)} />
          <FrameEditButton disabled={saving || hasLockedTrack} label={`Roll salida −${frameStep}f`} onClick={() => onRoll("RIGHT", -frameStep)} />
          <FrameEditButton disabled={saving || hasLockedTrack} label={`Roll salida +${frameStep}f`} onClick={() => onRoll("RIGHT", frameStep)} />
        </div>
      </section>
      {!editingGroup && <button type="button" disabled={saving || !canCreateGroup} onClick={onCreateGroup} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-2.5 py-2 text-xs font-bold text-violet-800 disabled:opacity-40 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-100"><Combine size={13} /> Agrupar selección</button>}
      {selectedGroup && !editingGroup && <button type="button" disabled={saving} onClick={onEnterGroup} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-2 text-xs font-bold text-slate-700 disabled:opacity-40 dark:border-white/15 dark:text-gray-200"><FolderOpen size={13} /> Editar contenido</button>}
      {selectedGroup && !editingGroup && <button type="button" disabled={saving} onClick={onUngroup} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-300 px-2.5 py-2 text-xs font-bold text-red-700 disabled:opacity-40 dark:border-red-400/30 dark:text-red-200"><Ungroup size={13} /> Desagrupar</button>}
      {editingGroup && <button type="button" disabled={saving} onClick={onExitGroup} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-2.5 py-2 text-xs font-bold text-violet-800 disabled:opacity-40 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-100"><LogOut size={13} /> Salir del grupo</button>}
      {!canCreateGroup && !selectedGroup && !editingGroup && selectedClips.length > 1 && <p className="text-[10px] leading-4 text-slate-500 dark:text-gray-400">Para crear un grupo, todos los assets seleccionados deben estar fuera de otra agrupación.</p>}
    </div>
  </div>;
}

function FrameEditButton({ disabled, label, onClick }: { disabled: boolean; label: string; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="rounded border border-slate-300 px-2 py-1.5 text-[10px] font-bold disabled:opacity-40 dark:border-white/15">{label}</button>;
}

function LayoutButton({ children, disabled, label, onClick }: { children: ReactNode; disabled: boolean; label: string; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} title={label} className="inline-flex items-center justify-center gap-1 rounded border border-slate-300 px-2 py-1.5 text-[10px] font-bold disabled:opacity-40 dark:border-white/15">{children}<span>{label}</span></button>;
}
