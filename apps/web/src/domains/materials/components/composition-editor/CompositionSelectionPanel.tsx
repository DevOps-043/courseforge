import { Combine, FolderOpen, Layers3, LogOut, MousePointer2, Ungroup, X } from "lucide-react";
import type { CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import { formatCompositionTimecode } from "@/domains/production/composition-editor/composition-timecode";

interface CompositionSelectionPanelProps {
  document: CompositionEditorDocument;
  editingGroupId: string | null;
  onClear: () => void;
  onCreateGroup: () => void;
  onEnterGroup: () => void;
  onExitGroup: () => void;
  onInspectClip: (hfId: string) => void;
  onUngroup: () => void;
  saving: boolean;
  selectedClipIds: ReadonlySet<string>;
  selectedGroupId: string | null;
}

export function CompositionSelectionPanel({ document, editingGroupId, onClear, onCreateGroup, onEnterGroup, onExitGroup, onInspectClip, onUngroup, saving, selectedClipIds, selectedGroupId }: CompositionSelectionPanelProps) {
  const selectedClips = document.clips.filter((clip) => selectedClipIds.has(clip.id));
  const selectedGroup = document.groups?.find((group) => group.id === selectedGroupId) || null;
  const editingGroup = document.groups?.find((group) => group.id === editingGroupId) || null;
  const groupedClipIds = new Set((document.groups || []).flatMap((group) => group.clipIds));
  const canCreateGroup = selectedClips.length >= 2 && selectedClips.every((clip) => !groupedClipIds.has(clip.id));
  const tracksById = new Map(document.tracks.map((track) => [track.id, track]));

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
      {!editingGroup && <button type="button" disabled={saving || !canCreateGroup} onClick={onCreateGroup} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-2.5 py-2 text-xs font-bold text-violet-800 disabled:opacity-40 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-100"><Combine size={13} /> Agrupar selección</button>}
      {selectedGroup && !editingGroup && <button type="button" disabled={saving} onClick={onEnterGroup} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-2 text-xs font-bold text-slate-700 disabled:opacity-40 dark:border-white/15 dark:text-gray-200"><FolderOpen size={13} /> Editar contenido</button>}
      {selectedGroup && !editingGroup && <button type="button" disabled={saving} onClick={onUngroup} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-300 px-2.5 py-2 text-xs font-bold text-red-700 disabled:opacity-40 dark:border-red-400/30 dark:text-red-200"><Ungroup size={13} /> Desagrupar</button>}
      {editingGroup && <button type="button" disabled={saving} onClick={onExitGroup} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-2.5 py-2 text-xs font-bold text-violet-800 disabled:opacity-40 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-100"><LogOut size={13} /> Salir del grupo</button>}
      {!canCreateGroup && !selectedGroup && !editingGroup && selectedClips.length > 1 && <p className="text-[10px] leading-4 text-slate-500 dark:text-gray-400">Para crear un grupo, todos los assets seleccionados deben estar fuera de otra agrupación.</p>}
    </div>
  </div>;
}
