"use client";

import { CompositionAutosaveBoundary } from "./CompositionAutosaveBoundary";

import { useState } from "react";
import type { HtmlEditingInspectorView } from "@/domains/production/composition-editor/html-editing/html-editing-inspector.contract";
import { HTML_EDITING_STYLE_RANGE_POLICY, isHtmlEditingStyleRangeValue } from "@/domains/production/composition-editor/html-editing/html-editing-style-range.contract";

type RangeElement = Extract<HtmlEditingInspectorView["manifest"]["elements"][number], { kind: "RANGE_TOKEN" }>;
export function CompositionHtmlStyleRangeField({ element, view, busy, onChange }: {
  element: RangeElement; view: HtmlEditingInspectorView; busy: boolean; onChange: (override: unknown) => Promise<boolean>;
}) {
  const stored = view.state.overrides.find(item => item.elementId === element.elementId);
  const [encodedValue, setEncodedValue] = useState(String(stored?.operation === "SET_STYLE_RANGE" ? stored.value : element.range.defaultValue));
  const value = encodedValue.trim() === "" ? NaN : Number(encodedValue);
  const valid = isHtmlEditingStyleRangeValue(element.range, value);
  const policy = HTML_EDITING_STYLE_RANGE_POLICY[element.range.property];
  return <CompositionAutosaveBoundary value={encodedValue} onCommit={() => { if (!busy && valid) return onChange({ operation: "SET_STYLE_RANGE", elementId: element.elementId, tokenId: element.tokenId, value }); }} disabled={busy}><fieldset disabled={busy} className="space-y-2 rounded border p-2">
    <legend>{element.label}</legend>
    <label>Token {element.tokenId} ({element.range.property})
      <input type="number" value={encodedValue} min={element.range.minimum} max={element.range.maximum} step={element.range.step}
        onChange={event => setEncodedValue(event.target.value)} /> {policy.unit || "sin unidad"}
    </label>
    <p>Rango {element.range.minimum}–{element.range.maximum}; paso {element.range.step}. No permite CSS libre.</p>
    {!valid && <p role="alert">Introduce un valor dentro del rango y alineado al paso declarado.</p>}

    <button type="button" data-composition-autosave-reset="true" onClick={() => { setEncodedValue(String(element.range.defaultValue));
      onChange({ operation: "RESET", elementId: element.elementId, property: "RANGE_TOKEN" }); }}>Restaurar original</button>
  </fieldset></CompositionAutosaveBoundary>;
}
