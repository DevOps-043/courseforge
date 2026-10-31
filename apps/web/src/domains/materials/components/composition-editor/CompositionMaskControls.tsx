"use client";

import { useEffect, useRef, useState } from "react";
import type { CompositionClip } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";
import type { CompositionVisualMask } from "@/domains/production/composition-editor/composition-visual-mask";
import { CompositionAutosaveBoundary, useCompositionAutosavePending } from "./CompositionAutosaveBoundary";

export function CompositionMaskControls({ clip, disabled, onPatch, onPreview }: {
  clip: CompositionClip; disabled: boolean;
  onPatch: (operations: CompositionEditorPatchOperation[], summary: string) => Promise<boolean>;
  onPreview: (hfId: string, mask: CompositionVisualMask | null, reset?: boolean) => void;
}) {
  const pending = useCompositionAutosavePending();
  const [mask, setMask] = useState<CompositionVisualMask | null>(clip.mask ?? null);
  const preview = useRef(onPreview);
  useEffect(() => { preview.current = onPreview; }, [clip.mask, onPreview]);
  useEffect(() => { if (!pending) setMask(clip.mask ?? null); }, [clip.mask, pending]);
  useEffect(() => () => preview.current(clip.hfId, null, true), [clip.hfId]);
  useEffect(() => { if (disabled) preview.current(clip.hfId, null, true); }, [disabled, clip.hfId]);
  const change = (next: CompositionVisualMask | null) => { setMask(next); onPreview(clip.hfId, next); };
  return <CompositionAutosaveBoundary value={mask} disabled={disabled}
    onCommit={() => onPatch([{ type: "clip.mask", clipId: clip.id, mask }], `Ajustó la máscara visual de ${clip.label}.`)}>
    <fieldset disabled={disabled} className="space-y-2 border-t border-slate-200 pt-3 disabled:opacity-50 dark:border-white/10">
      <legend className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Máscara visual</legend>
      <label className="block text-xs text-slate-600 dark:text-gray-300">Forma
        <select value={mask?.shape ?? "NONE"} onChange={(event) => {
          const shape = event.target.value;
          change(shape === "CIRCLE" || shape === "ELLIPSE" ? { shape } : shape === "ROUNDED_RECT" ? { shape, radiusPercent: 15 } : null);
        }} className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white">
          <option value="NONE">Sin máscara</option><option value="CIRCLE">Círculo</option>
          <option value="ELLIPSE">Elipse</option><option value="ROUNDED_RECT">Rectángulo redondeado</option>
        </select>
      </label>
      {mask?.shape === "ROUNDED_RECT" && <label className="block text-xs text-slate-600 dark:text-gray-300">
        Redondeo: {mask.radiusPercent}%
        <input type="range" min="0" max="50" step="1" value={mask.radiusPercent}
          onChange={(event) => change({ shape: "ROUNDED_RECT", radiusPercent: Number(event.target.value) })}
          className="mt-1 w-full accent-cyan-500" />
      </label>}
      <p className="text-[10px] leading-4 text-slate-500 dark:text-gray-400">La máscara se combina con el recorte por bordes. No modifica el archivo original. Selecciona «Sin máscara» para quitarla.</p>
    </fieldset>
  </CompositionAutosaveBoundary>;
}
