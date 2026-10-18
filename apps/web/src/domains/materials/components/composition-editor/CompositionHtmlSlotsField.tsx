"use client";

import { CompositionAutosaveBoundary } from "./CompositionAutosaveBoundary";

import { useState } from "react";
import type { HtmlEditingInspectorView } from "@/domains/production/composition-editor/html-editing/html-editing-inspector.contract";
import { prepareHtmlEditingSlotMove } from "@/domains/production/composition-editor/composition-html-editing-slot-order.client";

type SlotsElement = Extract<HtmlEditingInspectorView["manifest"]["elements"][number], { kind: "SLOTS" }>;
export function CompositionHtmlSlotsField({ element, view, busy, onChange }: {
  element: SlotsElement; view: HtmlEditingInspectorView; busy: boolean; onChange: (override: unknown) => Promise<boolean>;
}) {
  const stored = view.state.overrides.find(item => item.elementId === element.elementId);
  const [itemIds, setItemIds] = useState(stored?.operation === "SET_SLOT_ORDER" ? [...stored.itemIds] : [...element.itemIds]);
  const [error, setError] = useState<string | null>(null);
  function move(fromIndex: number, toIndex: number) {
    if (busy) return;
    try {
      const next = prepareHtmlEditingSlotMove({ declaration: element, itemIds, fromIndex, toIndex });
      setItemIds(next.itemIds); setError(null);
    } catch { setError("No se pudo preparar ese movimiento dentro de los slots declarados."); }
  }
  return <CompositionAutosaveBoundary value={itemIds} onCommit={() => onChange({ operation: "SET_SLOT_ORDER", elementId: element.elementId, itemIds: [...itemIds] })} disabled={busy}><fieldset disabled={busy} className="space-y-2 rounded border p-2">
    <legend>{element.label}</legend>
    <p>Cada movimiento guarda el orden de elementos existentes sin moverlos a otro contenedor.</p>
    <ol aria-label={`Orden de ${element.label}`}>{itemIds.map((id, index) => <li key={id}>
      <span>{index + 1}. {view.manifest.elements.find(item => item.elementId === id)?.label ?? id}</span>
      <button type="button" disabled={index === 0} aria-label={`Subir ${id}`} onClick={() => move(index, index - 1)}>Subir</button>
      <button type="button" disabled={index === itemIds.length - 1} aria-label={`Bajar ${id}`} onClick={() => move(index, index + 1)}>Bajar</button>
    </li>)}</ol>
    {error && <p role="alert">{error}</p>}

    <button type="button" data-composition-autosave-reset="true" onClick={() => { setItemIds([...element.itemIds]); setError(null);
      onChange({ operation: "RESET", elementId: element.elementId, property: "SLOTS" }); }}>Restaurar orden original</button>
  </fieldset></CompositionAutosaveBoundary>;
}
