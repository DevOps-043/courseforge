"use client";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import type { CompositionClip, CompositionGroup } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionGroupBounds } from "@/domains/production/composition-editor/composition-group.service";
import { formatCompositionUiTimecode } from "@/domains/production/composition-editor/composition-ui-presentation";

interface CompositionNestedTimelineRowProps {
  group: CompositionGroup;
  bounds: CompositionGroupBounds;
  clip: CompositionClip;
  durationSeconds: number;
  previewDeltaSeconds: number;
  disabled: boolean;
  selected: boolean;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
  onEnter: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
}

export function CompositionNestedTimelineRow({ group, bounds, clip, durationSeconds, previewDeltaSeconds, disabled, selected, onSelect, onEnter, onKeyDown, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: CompositionNestedTimelineRowProps) {
  const label = group.label || "Secuencia anidada";
  return <div className="grid grid-cols-[160px_minmax(0,1fr)] items-stretch gap-2" data-nested-timeline-row={group.id}>
    <span className="sticky left-0 z-40 truncate bg-white px-2 py-2 text-[11px] font-semibold dark:bg-[#101720]">Anidación · {label}</span>
    <div className="relative h-9 overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5">
      <button type="button" data-nested-group-id={group.id} data-clip-id={clip.id} disabled={disabled}
        aria-label={`${label}, ${group.clipIds.length} clips. Doble clic o Enter para editar contenido`}
        aria-pressed={selected} onClick={onSelect} onDoubleClick={onEnter} onKeyDown={onKeyDown}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
        title={`${label} · ${formatCompositionUiTimecode(bounds.startSeconds)} – ${formatCompositionUiTimecode(bounds.endSeconds)} · Doble clic para editar contenido`}
        style={{ left: `${((bounds.startSeconds + previewDeltaSeconds) / durationSeconds) * 100}%`, width: `${(bounds.durationSeconds / durationSeconds) * 100}%` }}
        className={`absolute inset-y-1 min-w-5 touch-none select-none truncate rounded-md border px-3 text-left text-[10px] font-semibold disabled:opacity-60 ${selected ? "border-violet-600 bg-violet-600 text-white" : "border-violet-400 bg-violet-100 text-violet-950 dark:bg-violet-900 dark:text-violet-100"}`}>
        ▣ {label} · {group.clipIds.length} clips
      </button>
    </div>
  </div>;
}
