"use client";

import { useEffect, useRef, useState } from "react";
import { COMPOSITION_REFERENCE_GUIDE_COLOR, COMPOSITION_REFERENCE_GUIDE_LIMIT, type CompositionReferenceGuide, type CompositionReferenceGuides } from "@/domains/production/composition-editor/composition-reference-guides";

export function CompositionReferenceGuidesPanel({ state, canvas, onChange, onClose, storageError, panelId }: {
  state: CompositionReferenceGuides; canvas: { width: number; height: number };
  onChange: (state: CompositionReferenceGuides) => void; onClose: () => void; storageError: string | null;
  panelId?: string;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    const previous = document.activeElement;
    panel?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected && (document.activeElement === document.body || panel?.contains(document.activeElement))) previous.focus({ preventScroll: true });
    };
  }, []);
  const add = (axis: "x" | "y") => onChange({ visible: true, guides: [...state.guides,
    { id: crypto.randomUUID(), axis, ratio: 0.5, color: COMPOSITION_REFERENCE_GUIDE_COLOR }] });
  return <section ref={panelRef} id={panelId} tabIndex={-1} aria-label="Líneas de referencia" onKeyDown={event => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); onClose(); }
  }} className="space-y-3 border-y border-slate-200 bg-slate-50 p-3 text-xs dark:border-white/10 dark:bg-slate-900">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong className="text-slate-800 dark:text-white">Guías personalizables · Líneas de referencia</strong>
      <button type="button" onClick={onClose} className="text-slate-600 underline dark:text-gray-300">Cerrar guías</button>
    </div>
    <p className="text-slate-500 dark:text-gray-400">Añade líneas horizontales o verticales y personaliza su posición y color. Son independientes de la rejilla fija. Sólo se ven en el editor y se guardan en este navegador. Arrastra las líneas o indica su posición. Usa Snap para alinear elementos.</p>
    {state.guides.length === 0 && <p className="text-slate-600 dark:text-gray-300">Para crear tu primera referencia, pulsa «Añadir vertical» o «Añadir horizontal».</p>}
    <div className="flex flex-wrap gap-3 text-slate-700 dark:text-gray-200">
      <label><input type="checkbox" checked={state.visible} onChange={event => onChange({ ...state, visible: event.target.checked })} /> Mostrar guías</label>
      <button type="button" disabled={state.guides.length >= COMPOSITION_REFERENCE_GUIDE_LIMIT} onClick={() => add("x")} className="underline disabled:opacity-40">Añadir vertical</button>
      <button type="button" disabled={state.guides.length >= COMPOSITION_REFERENCE_GUIDE_LIMIT} onClick={() => add("y")} className="underline disabled:opacity-40">Añadir horizontal</button>
      <span>{state.guides.length}/{COMPOSITION_REFERENCE_GUIDE_LIMIT}</span>
    </div>
    <div className="max-h-48 space-y-2 overflow-y-auto">
      {state.guides.map((guide, index) => <GuideRow key={guide.id} guide={guide} index={index} canvas={canvas}
        onChange={next => onChange({ ...state, guides: state.guides.map(item => item.id === next.id ? next : item) })}
        onRemove={() => onChange({ ...state, guides: state.guides.filter(item => item.id !== guide.id) })} />)}
    </div>
    {storageError && <p role="status" className="text-amber-700 dark:text-amber-300">{storageError}</p>}
  </section>;
}

function GuideRow({ guide, index, canvas, onChange, onRemove }: {
  guide: CompositionReferenceGuide; index: number; canvas: { width: number; height: number };
  onChange: (guide: CompositionReferenceGuide) => void; onRemove: () => void;
}) {
  const extent = guide.axis === "x" ? canvas.width : canvas.height;
  const position = Math.round(guide.ratio * extent * 100) / 100;
  const [value, setValue] = useState(String(position));
  useEffect(() => setValue(String(position)), [position]);
  const inputClass = "rounded border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white";
  return <div className="flex flex-wrap items-center gap-2">
    <select aria-label={`Orientación de guía ${index + 1}`} className={inputClass} value={guide.axis}
      onChange={event => onChange({ ...guide, axis: event.target.value === "x" ? "x" : "y" })}>
      <option value="x">Vertical</option><option value="y">Horizontal</option>
    </select>
    <label className="text-slate-600 dark:text-gray-300">Posición (px) <input aria-label={`Posición de guía ${index + 1} en píxeles`}
      className={`${inputClass} w-24`} type="number" step="any" min="0" max={extent} value={value}
      onBlur={() => setValue(String(position))} onChange={event => {
        setValue(event.target.value);
        const number = event.target.valueAsNumber;
        if (Number.isFinite(number) && number >= 0 && number <= extent) onChange({ ...guide, ratio: number / extent });
      }} /></label>
    <input type="color" aria-label={`Color de guía ${index + 1}`} value={guide.color} onChange={event => onChange({ ...guide, color: event.target.value })} />
    <button type="button" aria-label={`Eliminar guía ${index + 1}`} onClick={onRemove} className="text-red-700 underline dark:text-red-300">Eliminar</button>
  </div>;
}
