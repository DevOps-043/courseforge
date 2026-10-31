"use client";

import { useRef, useState } from "react";
import { CompositionAutosaveBoundary } from "./CompositionAutosaveBoundary";
import { HTML_EDITING_LIMITS, isHtmlEditingDeclaredAttributeValue } from "@/domains/production/composition-editor/html-editing/html-editing.contract";
import type { HtmlEditingInspectorView } from "@/domains/production/composition-editor/html-editing/html-editing-inspector.contract";
import { stageHtmlEditingFieldOverride, stageHtmlEditingTargetReset } from "@/domains/production/composition-editor/composition-html-editing-field-command.client";
import { CompositionHtmlSlotsField } from "./CompositionHtmlSlotsField";
import { CompositionHtmlChartField } from "./CompositionHtmlChartField";
import { CompositionHtmlStyleRangeField } from "./CompositionHtmlStyleRangeField";

type Element = HtmlEditingInspectorView["manifest"]["elements"][number];
export function CompositionHtmlEditableFields({ view, busy, onCommit }: {
  view: HtmlEditingInspectorView; busy: boolean; onCommit: (overrides: unknown) => Promise<boolean>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitRef = useRef(false);
  async function commit(prepare: () => unknown): Promise<boolean> {
    if (busy || submitRef.current) return false;
    submitRef.current = true; setSubmitting(true); setError(null);
    try { return await onCommit(prepare()); }
    catch { setError("No se confirmó el cambio HTML. Conserva el seguimiento antes de reintentar."); return false; }
    finally { submitRef.current = false; setSubmitting(false); }
  }
  const targetGroups = new Map<string, Element[]>();
  for (const element of view.manifest.elements) {
    const target = element.targetElementId ?? element.elementId;
    targetGroups.set(target, [...(targetGroups.get(target) ?? []), element]);
  }
  return <div className="space-y-3" aria-label="Edición de campos HTML">
    <p>Los campos válidos se guardan automáticamente al terminar de editarlos. Cada cambio conserva su revisión e historial HTML.</p>
    {submitting && <p role="status">Guardando revisión HTML…</p>}
    {error && <p role="alert">{error}</p>}
    {[...targetGroups].filter(([, fields]) => fields.length > 1).map(([target, fields]) => <button key={target} type="button" disabled={busy || submitting}
      onClick={() => void commit(() => stageHtmlEditingTargetReset(view, [], target))}>Restaurar elemento completo ({fields.length} campos)</button>)}
    {view.manifest.elements.map(element => <EditableField key={`${view.revisionSha256}:${element.elementId}`} element={element} view={view} busy={busy || submitting}
      onChange={override => commit(() => stageHtmlEditingFieldOverride(view, [], override))} />)}
  </div>;
}

function EditableField({ element, view, busy, onChange }: {
  element: Element; view: HtmlEditingInspectorView; busy: boolean; onChange: (override: unknown) => Promise<boolean>;
}) {
  if (element.kind === "SLOTS") return <CompositionHtmlSlotsField element={element} view={view} busy={busy} onChange={onChange} />;
  if (element.kind === "CHART") return <CompositionHtmlChartField element={element} view={view} busy={busy} onChange={onChange} />;
  if (element.kind === "RANGE_TOKEN") return <CompositionHtmlStyleRangeField element={element} view={view} busy={busy} onChange={onChange} />;
  return <EditableScalarField element={element} view={view} busy={busy} onChange={onChange} />;
}
function EditableScalarField({ element, view, busy, onChange }: {
  element: Exclude<Element, { kind: "SLOTS" | "CHART" | "RANGE_TOKEN" }>; view: HtmlEditingInspectorView; busy: boolean; onChange: (override: unknown) => Promise<boolean>;
}) {
  const original = view.defaults.find(item => item.elementId === element.elementId);
  const override = view.state.overrides.find(item => item.elementId === element.elementId);
  const [text, setText] = useState(override?.operation === "SET_TEXT" ? override.value : original?.kind === "TEXT" ? original.value : "");
  const localeChoices = element.kind === "TEXT" ? element.localePolicy?.allowedLocales ?? [] : [];
  const initialLocale = override?.operation === "SET_TEXT" ? override.locale : original?.kind === "TEXT" ? original.locale : undefined;
  const [localeKey, setLocaleKey] = useState(initialLocale ? `${initialLocale.language}:${initialLocale.direction}` : "");
  const selectedLocale = localeChoices.find(locale => `${locale.language}:${locale.direction}` === localeKey);
  const [assetId, setAssetId] = useState(override?.operation === "SET_IMAGE" ? override.assetId : original?.kind === "IMAGE" ? original.assetId ?? "" : "");
  const [fit, setFit] = useState<"CONTAIN" | "COVER">(override?.operation === "SET_IMAGE" ? override.fit : original?.kind === "IMAGE" && original.fit ? original.fit : element.kind === "IMAGE" ? element.allowedFits[0]! : "CONTAIN");
  const [choiceId, setChoiceId] = useState(override?.operation === "SET_THEME" ? override.choiceId : original?.kind === "THEME" ? original.choiceId ?? "" : "");
  const [attributeValue, setAttributeValue] = useState(override?.operation === "SET_ATTRIBUTE" ? override.value : original?.kind === "ATTRIBUTE" ? original.value ?? "" : "");
  const [visible, setVisible] = useState(override?.operation === "SET_VISIBILITY" ? override.visible : original?.kind === "VISIBILITY" ? original.visible : true);
  const imageChoices = element.kind === "IMAGE" ? element.allowedAssetIds.filter(id => view.grantedAssetIds.includes(id)) : [];
  const textCharacters = Array.from(text).length;
  const valid = element.kind === "TEXT" ? textCharacters <= element.maxCharacters && text.length <= HTML_EDITING_LIMITS.textCharacters
    && (!element.localePolicy || selectedLocale !== undefined)
    : element.kind === "IMAGE" ? imageChoices.includes(assetId) && element.allowedFits.includes(fit)
      : element.kind === "THEME" ? element.allowedChoiceIds.includes(choiceId)
        : element.kind === "ATTRIBUTE" ? isHtmlEditingDeclaredAttributeValue(element, attributeValue)
          : true;
  function submit() {
    if (busy || !valid) return;
    const common = { elementId: element.elementId };
    return onChange(element.kind === "TEXT" ? { ...common, operation: "SET_TEXT", value: text,
      ...(element.localePolicy ? { locale: selectedLocale } : {}) }
      : element.kind === "IMAGE" ? { ...common, operation: "SET_IMAGE", assetId, fit }
        : element.kind === "THEME" ? { ...common, operation: "SET_THEME", tokenId: element.tokenId, choiceId }
          : element.kind === "ATTRIBUTE" ? { ...common, operation: "SET_ATTRIBUTE", attributeName: element.attributeName, value: attributeValue }
            : { ...common, operation: "SET_VISIBILITY", visible });
  }
  return <CompositionAutosaveBoundary serialize value={{text, localeKey, assetId, fit, choiceId, attributeValue, visible}} onCommit={submit} disabled={busy} className="space-y-1 rounded border p-2">
    <fieldset disabled={busy} className="space-y-1">
      <legend>{element.label}</legend>
      {element.kind === "TEXT" && <label className="block">Texto
        {element.multiline ? <textarea className="block w-full" value={text} lang={selectedLocale?.language} dir={selectedLocale?.direction}
          maxLength={Math.min(HTML_EDITING_LIMITS.textCharacters, element.maxCharacters * 2)} onChange={event => setText(event.target.value)} />
          : <input className="block w-full" type="text" value={text} lang={selectedLocale?.language} dir={selectedLocale?.direction}
            maxLength={Math.min(HTML_EDITING_LIMITS.textCharacters, element.maxCharacters * 2)} onChange={event => setText(event.target.value)} />}
        <span>{textCharacters}/{element.maxCharacters}</span>
      </label>}
      {element.kind === "TEXT" && element.localePolicy && <label className="block">Idioma y dirección declarados
        <select className="block w-full" value={localeKey} onChange={event => setLocaleKey(event.target.value)}>
          {localeChoices.map(locale => <option key={`${locale.language}:${locale.direction}`} value={`${locale.language}:${locale.direction}`}>
            {locale.language} · {locale.direction}
          </option>)}
        </select>
      </label>}
      {element.kind === "IMAGE" && <>
        <label className="block">Imagen autorizada<select className="block w-full" value={assetId} onChange={event => setAssetId(event.target.value)}>
          <option value="">Selecciona un recurso vigente</option>{imageChoices.map(id => <option key={id} value={id}>{id}</option>)}
        </select></label>
        <label className="block">Ajuste<select className="block w-full" value={fit} onChange={event => setFit(event.target.value as "CONTAIN" | "COVER")}>
          {element.allowedFits.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
      </>}
      {element.kind === "THEME" && <label className="block">Tema<select className="block w-full" value={choiceId} onChange={event => setChoiceId(event.target.value)}>
        <option value="">Selecciona un tema declarado</option>{element.allowedChoiceIds.map(id => <option key={id} value={id}>{id}</option>)}
      </select></label>}
      {element.kind === "ATTRIBUTE" && <label className="block">Atributo declarado ({element.attributeName})
        {element.allowedValues ? <select className="block w-full" value={attributeValue} onChange={event => setAttributeValue(event.target.value)}>
          {!element.allowedValues.includes(attributeValue) && <option value="">Selecciona un valor declarado</option>}
          {element.allowedValues.map(value => <option key={value} value={value}>{value || "(vacío)"}</option>)}
        </select> : <input className="block w-full" type="text" value={attributeValue}
          maxLength={Math.min(HTML_EDITING_LIMITS.textCharacters, element.maxCharacters * 2)} onChange={event => setAttributeValue(event.target.value)} />}
        <span className="block">{Array.from(attributeValue).length}/{element.maxCharacters}</span>
      </label>}
      {element.kind === "VISIBILITY" && <label className="block">
        <input type="checkbox" checked={visible} onChange={event => setVisible(event.target.checked)} /> Mostrar elemento
        <span className="block">Ocultarlo no elimina contenido, recursos ni historial.</span>
      </label>}
      <div className="flex gap-2">
        <button type="button" data-composition-autosave-reset="true" onClick={() => onChange({ operation: "RESET", elementId: element.elementId, property: element.kind })}>Restaurar original</button>
      </div>
    </fieldset>
  </CompositionAutosaveBoundary>;
}
