"use client";

import { useState } from "react";
import type { CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";
import { COMPOSITION_LAYER_DEPTH_LIMIT, COMPOSITION_LAYER_MAX } from "@/domains/production/composition-editor/composition-layer-depth";

interface CompositionLayerManagerProps {
  document: CompositionEditorDocument;
  disabled: boolean;
  onPatch: (operations: CompositionEditorPatchOperation[], summary: string) => Promise<boolean>;
}

export function CompositionLayerManager({ document, disabled, onPatch }: CompositionLayerManagerProps) {
  const [pending, setPending] = useState(false);
  const extras = document.extraLayerDepths || [];
  const nextDepth = Math.max(COMPOSITION_LAYER_MAX, ...extras) + 1;
  const blocked = disabled || pending;
  const apply = async (operation: CompositionEditorPatchOperation, summary: string) => {
    setPending(true);
    try { await onPatch([operation], summary); }
    finally { setPending(false); }
  };
  const remove = (depth: number) => {
    const occupants = document.clips.filter(clip => clip.layout.zIndex === depth);
    if (occupants.length) {
      if (!window.confirm(`La capa ${depth} contiene ${occupants.length} elemento(s), incluidos los ocultos. ¿Quieres quitar la capa y esos elementos?`)) return;
      if (!window.confirm(`Segunda confirmación: se quitarán ${occupants.length} elemento(s) de la capa ${depth}. Los assets originales se conservan y puedes deshacer esta edición. ¿Confirmas la eliminación?`)) return;
    }
    void apply({ type: "layer.remove", depth, confirmedClipIds: occupants.map(clip => clip.id) }, `Quitó la capa adicional ${depth} y ${occupants.length} elemento(s).`);
  };
  return <section aria-label="Capas visuales" className="mb-3 space-y-2 rounded-lg border border-slate-200 p-3 text-xs dark:border-white/10">
    <p className="font-semibold">Capas visuales</p>
    <p className="text-slate-500 dark:text-gray-400">Las capas base 0–10 se conservan. Agrega planos adicionales cuando los necesites.</p>
    <button type="button" disabled={blocked || nextDepth > COMPOSITION_LAYER_DEPTH_LIMIT} onClick={() => void apply({ type: "layer.add", depth: nextDepth }, `Agregó la capa visual ${nextDepth}.`)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40 dark:border-white/20">Agregar capa {nextDepth <= COMPOSITION_LAYER_DEPTH_LIMIT ? nextDepth : ""}</button>
    {nextDepth > COMPOSITION_LAYER_DEPTH_LIMIT && <p role="status">Se alcanzó el límite técnico de profundidad ({COMPOSITION_LAYER_DEPTH_LIMIT}).</p>}
    <ul className="max-h-40 space-y-1 overflow-y-auto">{extras.map(depth => {
      const occupants = document.clips.filter(clip => clip.layout.zIndex === depth);
      const locked = occupants.some(clip => document.tracks.find(track => track.id === clip.trackId)?.locked);
      return <li key={depth} className="flex items-center justify-between gap-2">
        <span>Capa {depth} · {occupants.length} elemento(s)</span>
        <button type="button" disabled={blocked || locked} title={locked ? "Desbloquea las pistas de sus elementos antes de quitar esta capa." : undefined} aria-label={`Quitar capa ${depth}`} onClick={() => remove(depth)} className="rounded border border-red-300 px-2 py-1 text-red-700 disabled:opacity-40 dark:text-red-300">Quitar</button>
      </li>;
    })}</ul>
  </section>;
}
