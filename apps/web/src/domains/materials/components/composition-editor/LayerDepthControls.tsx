"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Layers2, Save } from "lucide-react";
import type { CompositionClip } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";
import {
  COMPOSITION_LAYER_MAX,
  COMPOSITION_LAYER_MIN,
  clampCompositionLayerDepth,
} from "@/domains/production/composition-editor/composition-layer-depth";

interface LayerDepthControlsProps {
  clip: CompositionClip;
  disabled: boolean;
  onPatch: (operations: CompositionEditorPatchOperation[], summary: string) => Promise<boolean>;
}

export function LayerDepthControls({ clip, disabled, onPatch }: LayerDepthControlsProps) {
  const [depth, setDepth] = useState(String(clip.layout.zIndex));

  useEffect(() => setDepth(String(clip.layout.zIndex)), [clip.id, clip.layout.zIndex]);

  const persistDepth = async (requestedDepth: number) => {
    const nextDepth = clampCompositionLayerDepth(requestedDepth);
    if (nextDepth === clip.layout.zIndex) {
      setDepth(String(nextDepth));
      return;
    }
    await onPatch(
      [{ clipId: clip.id, layout: { zIndex: nextDepth }, type: "clip.layout" }],
      `Movió ${clip.label} al plano visual ${nextDepth}.`,
    );
  };

  const saveTypedDepth = () => {
    const requestedDepth = Number(depth);
    if (!Number.isFinite(requestedDepth)) {
      setDepth(String(clip.layout.zIndex));
      return;
    }
    void persistDepth(requestedDepth);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers2 className="text-[var(--engine-accent-strong)]" size={15} />
          <div>
            <p className="text-[11px] font-bold text-slate-800 dark:text-gray-100">Profundidad visual</p>
            <p className="text-[10px] text-slate-500 dark:text-gray-400">{describeDepth(clip.layout.zIndex)} · z-index {clip.layout.zIndex}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={disabled || clip.layout.zIndex <= COMPOSITION_LAYER_MIN}
            aria-label={`Enviar ${clip.label} un plano hacia atrás`}
            onClick={() => void persistDepth(clip.layout.zIndex - 1)}
            className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-white disabled:opacity-40 dark:border-white/15 dark:text-gray-300 dark:hover:bg-white/10"
            title="Enviar un plano atrás"
          >
            <ArrowDown size={14} />
          </button>
          <button
            type="button"
            disabled={disabled || clip.layout.zIndex >= COMPOSITION_LAYER_MAX}
            aria-label={`Traer ${clip.label} un plano hacia delante`}
            onClick={() => void persistDepth(clip.layout.zIndex + 1)}
            className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-white disabled:opacity-40 dark:border-white/15 dark:text-gray-300 dark:hover:bg-white/10"
            title="Traer un plano al frente"
          >
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
      <label className="mt-2 flex items-end gap-2 text-[10px] font-semibold text-slate-600 dark:text-gray-300">
        <span className="flex-1">Plano exacto
          <input
            aria-label={`Profundidad visual de ${clip.label}`}
            disabled={disabled}
            type="number"
            min={COMPOSITION_LAYER_MIN}
            max={COMPOSITION_LAYER_MAX}
            step={1}
            value={depth}
            onChange={(event) => setDepth(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") saveTypedDepth(); }}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white"
          />
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={saveTypedDepth}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--engine-accent)] px-2 py-1.5 text-[10px] font-bold text-[#0A6455] disabled:opacity-40 dark:text-[var(--engine-accent)]"
        >
          <Save size={12} /> Guardar plano
        </button>
      </label>
    </div>
  );
}

function describeDepth(depth: number) {
  if (depth === COMPOSITION_LAYER_MIN) return "Fondo";
  if (depth === COMPOSITION_LAYER_MAX) return "Primer plano";
  return "Plano intermedio";
}
