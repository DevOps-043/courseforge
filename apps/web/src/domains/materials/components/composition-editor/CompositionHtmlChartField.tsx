"use client";

import { CompositionAutosaveBoundary } from "./CompositionAutosaveBoundary";

import { useState } from "react";
import type { HtmlEditingInspectorView } from "@/domains/production/composition-editor/html-editing/html-editing-inspector.contract";
import { mergeHtmlEditingChartDataset, readHtmlEditingChartDataset } from "@/domains/production/composition-editor/html-editing/html-editing-chart.contract";
import { decodeHtmlEditingBoundedJson } from "@/domains/production/composition-editor/html-editing/html-editing-validation";
import { HTML_EDITING_LIMITS } from "@/domains/production/composition-editor/html-editing/html-editing.contract";

type ChartElement = Extract<HtmlEditingInspectorView["manifest"]["elements"][number], { kind: "CHART" }>;
export function CompositionHtmlChartField({ element, view, busy, onChange }: {
  element: ChartElement; view: HtmlEditingInspectorView; busy: boolean; onChange: (override: unknown) => Promise<boolean>;
}) {
  const stored = view.state.overrides.find(item => item.elementId === element.elementId);
  const original = readHtmlEditingChartDataset(element.chart);
  const [encodedDataset, setEncodedDataset] = useState(JSON.stringify(stored?.operation === "SET_CHART_DATA" ? stored.dataset : original, null, 2));
  const [error, setError] = useState<string | null>(null);
  function prepare() {
    if (busy) return;
    try {
      const chart = mergeHtmlEditingChartDataset(element.chart, decodeHtmlEditingBoundedJson(encodedDataset, HTML_EDITING_LIMITS.commandBytes));
      const saved = onChange({ operation: "SET_CHART_DATA", elementId: element.elementId, dataset: readHtmlEditingChartDataset(chart) });
      setError(null); return saved;
    } catch { setError("Datos inválidos: conserva el tipo del gráfico, labels alineados y valores numéricos dentro de los límites."); }
  }
  return <CompositionAutosaveBoundary value={encodedDataset} onCommit={prepare} disabled={busy}><fieldset disabled={busy} className="space-y-2 rounded border p-2">
    <legend>{element.label}</legend>
    <p>Datos tipados de {element.chart.type}. Solo modifica puntos, series o proporción; el título, estilo e identidad pertenecen a la plantilla.</p>
    <label>Dataset JSON
      <textarea rows={12} className="w-full font-mono" maxLength={HTML_EDITING_LIMITS.commandBytes}
        value={encodedDataset} onChange={event => { setEncodedDataset(event.target.value); setError(null); }} />
    </label>
    {error && <p role="alert">{error}</p>}

    <button type="button" data-composition-autosave-reset="true" onClick={() => { setEncodedDataset(JSON.stringify(original, null, 2)); setError(null);
      onChange({ operation: "RESET", elementId: element.elementId, property: "CHART" }); }}>Restaurar datos originales</button>
  </fieldset></CompositionAutosaveBoundary>;
}
