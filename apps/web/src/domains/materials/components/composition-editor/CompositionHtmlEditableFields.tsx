"use client";

import { useEffect, useRef, useState } from "react";
import { HTML_EDITING_LIMITS } from "@/domains/production/composition-editor/html-editing/html-editing.contract";
import type { HtmlEditingInspectorView } from "@/domains/production/composition-editor/html-editing/html-editing-inspector.contract";
import { stageHtmlEditingFieldOverride, type HtmlEditingFieldOverride } from "@/domains/production/composition-editor/composition-html-editing-field-command.client";

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
  return <div className="space-y-3" aria-label="Edición de campos HTML">
    <p>Prepara hasta {HTML_EDITING_LIMITS.commandOverrides} campos y guarda el lote en una sola revisión. Preparar no publica cambios.</p>
    <div className="flex gap-2">
      <button type="button" disabled={locked || !drafts.length} onClick={() => void commit()}>Guardar lote ({drafts.length})</button>
      <button type="button" disabled={locked || !drafts.length} onClick={() => updateDraft([])}>Descartar lote local</button>
    </div>
    {error && <p role="alert">{error}</p>}
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
  const original = view.defaults.find(item => item.elementId === element.elementId);
  const override = view.state.overrides.find(item => item.elementId === element.elementId);
  const [text, setText] = useState(override?.operation === "SET_TEXT" ? override.value : original?.kind === "TEXT" ? original.value : "");
  const [assetId, setAssetId] = useState(override?.operation === "SET_IMAGE" ? override.assetId : original?.kind === "IMAGE" ? original.assetId ?? "" : "");
  const [fit, setFit] = useState<"CONTAIN" | "COVER">(override?.operation === "SET_IMAGE" ? override.fit : original?.kind === "IMAGE" && original.fit ? original.fit : element.kind === "IMAGE" ? element.allowedFits[0]! : "CONTAIN");
  const [choiceId, setChoiceId] = useState(override?.operation === "SET_THEME" ? override.choiceId : original?.kind === "THEME" ? original.choiceId ?? "" : "");
  const imageChoices = element.kind === "IMAGE" ? element.allowedAssetIds.filter(id => view.grantedAssetIds.includes(id)) : [];
  const textCharacters = Array.from(text).length;
  const valid = element.kind === "TEXT" ? textCharacters <= element.maxCharacters && text.length <= HTML_EDITING_LIMITS.textCharacters
    : element.kind === "IMAGE" ? imageChoices.includes(assetId) && element.allowedFits.includes(fit)
      : element.allowedChoiceIds.includes(choiceId);
  function submit() {
    if (busy || !valid) return;
    const common = { elementId: element.elementId };
    onChange(element.kind === "TEXT" ? { ...common, operation: "SET_TEXT", value: text }
      : element.kind === "IMAGE" ? { ...common, operation: "SET_IMAGE", assetId, fit }
        : { ...common, operation: "SET_THEME", tokenId: element.tokenId, choiceId });
  }
  return <form className="space-y-1 rounded border p-2" onSubmit={event => { event.preventDefault(); submit(); }}>
    <fieldset disabled={busy} className="space-y-1">
      <legend>{element.label}</legend>
      {element.kind === "TEXT" && <label className="block">Texto
        {element.multiline ? <textarea className="block w-full" value={text} maxLength={Math.min(HTML_EDITING_LIMITS.textCharacters, element.maxCharacters * 2)} onChange={event => setText(event.target.value)} />
          : <input className="block w-full" type="text" value={text} maxLength={Math.min(HTML_EDITING_LIMITS.textCharacters, element.maxCharacters * 2)} onChange={event => setText(event.target.value)} />}
        <span>{textCharacters}/{element.maxCharacters}</span>
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
      <div className="flex gap-2">
        <button type="submit" disabled={!valid}>Preparar cambio</button>
        <button type="button" onClick={() => onChange({ operation: "RESET", elementId: element.elementId, property: element.kind })}>Preparar original</button>
      </div>
    </fieldset>
  </form>;
}
