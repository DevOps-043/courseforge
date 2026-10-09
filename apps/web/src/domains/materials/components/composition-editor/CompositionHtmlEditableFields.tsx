"use client";

import { useEffect, useRef, useState } from "react";
import { HTML_EDITING_LIMITS, isHtmlEditingDeclaredAttributeValue } from "@/domains/production/composition-editor/html-editing/html-editing.contract";
import type { HtmlEditingInspectorView } from "@/domains/production/composition-editor/html-editing/html-editing-inspector.contract";
import { stageHtmlEditingFieldOverride, stageHtmlEditingTargetReset, type HtmlEditingFieldOverride } from "@/domains/production/composition-editor/composition-html-editing-field-command.client";
import { CompositionHtmlSlotsField } from "./CompositionHtmlSlotsField";
import { CompositionHtmlChartField } from "./CompositionHtmlChartField";
import { CompositionHtmlStyleRangeField } from "./CompositionHtmlStyleRangeField";

type Element = HtmlEditingInspectorView["manifest"]["elements"][number];
export function CompositionHtmlEditableFields({ view, busy, onCommit }: {
  view: HtmlEditingInspectorView; busy: boolean; onCommit: (overrides: unknown) => Promise<boolean>;
}) {
  const [drafts, setDrafts] = useState<HtmlEditingFieldOverride[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const draftRef = useRef<HtmlEditingFieldOverride[]>([]), submitRef = useRef(false), mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  function updateDraft(next: HtmlEditingFieldOverride[]) { draftRef.current = next; setDrafts(next); setError(null); }
  function stage(override: unknown) {
    if (busy || submitRef.current) return;
    try { updateDraft(stageHtmlEditingFieldOverride(view, draftRef.current, override)); }
    catch { setError("No se pudo preparar el campo. Revisa sus opciones, permisos y los límites del lote."); }
  }
  function stageTargetReset(targetId: string) {
    if (busy || submitRef.current) return;
    try { updateDraft(stageHtmlEditingTargetReset(view, draftRef.current, targetId)); }
    catch { setError("No se pudo preparar el original del elemento. Revisa permisos de recursos y el límite del lote; no se añadió un reset parcial."); }
  }
  async function commit() {
    if (busy || submitRef.current || !draftRef.current.length) return;
    submitRef.current = true; setSubmitting(true);
    try {
      if (await onCommit(structuredClone(draftRef.current)) && mountedRef.current) updateDraft([]);
    } catch {
      if (mountedRef.current) setError("No se pudo completar el guardado. Conserva el seguimiento y no repitas el envío automáticamente.");
    } finally { submitRef.current = false; if (mountedRef.current) setSubmitting(false); }
  }
  const locked = busy || submitting;
  const targetGroups = new Map<string, Element[]>();
  for (const element of view.manifest.elements) {
    const targetId = element.targetElementId ?? element.elementId;
    targetGroups.set(targetId, [...(targetGroups.get(targetId) ?? []), element]);
  }
  return <div className="space-y-3" aria-label="Edición de campos HTML">
    <p>Prepara hasta {HTML_EDITING_LIMITS.commandOverrides} campos y guarda el lote en una sola revisión. Preparar no publica cambios.</p>
    <div className="flex gap-2">
      <button type="button" disabled={locked || !drafts.length} onClick={() => void commit()}>Guardar lote ({drafts.length})</button>
      <button type="button" disabled={locked || !drafts.length} onClick={() => updateDraft([])}>Descartar lote local</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {[...targetGroups].some(([, fields]) => fields.length > 1) && <div aria-label="Restauración de elementos completos" className="space-y-2">
      <p>Preparar el original de un elemento reemplaza sus cambios locales por resets de todos sus campos. Se publica únicamente al guardar el lote.</p>
      {[...targetGroups].filter(([, fields]) => fields.length > 1).map(([targetId, fields]) => <div key={targetId}>
        <span>{targetId} · {fields.map(field => field.label).join(", ")}</span>
        <button type="button" disabled={locked} onClick={() => stageTargetReset(targetId)}>Preparar original del elemento ({fields.length} campos)</button>
      </div>)}
    </div>}
    {drafts.length > 0 && <ul aria-label="Cambios preparados">{drafts.map(override => <li key={override.elementId}>
      {view.manifest.elements.find(element => element.elementId === override.elementId)?.label} · {override.operation}
      <button type="button" disabled={locked} onClick={() => updateDraft(draftRef.current.filter(value => value.elementId !== override.elementId))}>Quitar del lote</button>
    </li>)}</ul>}
    {view.manifest.elements.map(element => <EditableField key={`${view.revisionSha256}:${element.elementId}`}
      element={element} view={view} busy={locked} onChange={stage} />)}
  </div>;
}

function EditableField({ element, view, busy, onChange }: {
  element: Element; view: HtmlEditingInspectorView; busy: boolean; onChange: (override: unknown) => void;
}) {
  if (element.kind === "SLOTS") return <CompositionHtmlSlotsField element={element} view={view} busy={busy} onChange={onChange} />;
  if (element.kind === "CHART") return <CompositionHtmlChartField element={element} view={view} busy={busy} onChange={onChange} />;
  if (element.kind === "RANGE_TOKEN") return <CompositionHtmlStyleRangeField element={element} view={view} busy={busy} onChange={onChange} />;
  return <EditableScalarField element={element} view={view} busy={busy} onChange={onChange} />;
}
function EditableScalarField({ element, view, busy, onChange }: {
  element: Exclude<Element, { kind: "SLOTS" | "CHART" | "RANGE_TOKEN" }>; view: HtmlEditingInspectorView; busy: boolean; onChange: (override: unknown) => void;
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
    onChange(element.kind === "TEXT" ? { ...common, operation: "SET_TEXT", value: text,
      ...(element.localePolicy ? { locale: selectedLocale } : {}) }
      : element.kind === "IMAGE" ? { ...common, operation: "SET_IMAGE", assetId, fit }
        : element.kind === "THEME" ? { ...common, operation: "SET_THEME", tokenId: element.tokenId, choiceId }
          : element.kind === "ATTRIBUTE" ? { ...common, operation: "SET_ATTRIBUTE", attributeName: element.attributeName, value: attributeValue }
            : { ...common, operation: "SET_VISIBILITY", visible });
  }
  return <form className="space-y-1 rounded border p-2" onSubmit={event => { event.preventDefault(); submit(); }}>
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
        <button type="submit" disabled={!valid}>Preparar cambio</button>
        <button type="button" onClick={() => onChange({ operation: "RESET", elementId: element.elementId, property: element.kind })}>Preparar original</button>
      </div>
    </fieldset>
  </form>;
}
