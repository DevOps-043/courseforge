"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, Loader2 } from "lucide-react";
import { HTML_SLIDE_IMPORT_LIMITS, type ImportedSlideDesign, type ImportedSlideField } from "../imported-slide-design.contract";
import { ImportedSlidePreview } from "./ImportedSlidePreview";

interface ImportAnalysis {
  design: ImportedSlideDesign;
  previews: string[];
  report: { removedScripts: number; removedResources: number; warnings: string[] };
}

async function importRequest(payload: unknown) {
  const response = await fetch("/api/admin/slides/templates/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "No se pudo completar la importación.");
  return result;
}

export function ImportSlideTemplateDialog({ onSaved, conversationId }: { onSaved?: () => void; conversationId?: string }) {
  const router = useRouter();
  const dialogTitleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [design, setDesign] = useState<ImportedSlideDesign | null>(null);
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function open() {
    dialog.current?.showModal();
    if (!conversationId) return;
    setBusy(true); setError(""); setSaved(false); setReviewed(false);
    try {
      const result = await importRequest({ action: "load", conversationId });
      setAnalysis(result); setDesign(result.design); setTitle(result.title); setSelected(0);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo cargar la plantilla."); }
    finally { setBusy(false); }
  }

  async function analyzeFile(file: File | undefined) {
    if (!file) return;
    setError(""); setAnalysis(null); setDesign(null); setReviewed(false); setSaved(false);
    if (!/\.html?$/i.test(file.name) || file.size > HTML_SLIDE_IMPORT_LIMITS.sourceBytes) {
      setError("Selecciona un archivo .html de hasta 500 KB."); return;
    }
    setBusy(true);
    try {
      const result: ImportAnalysis = await importRequest({ action: "analyze", html: await file.text() });
      setAnalysis(result); setDesign(result.design); setSelected(0);
      setTitle(file.name.replace(/\.html?$/i, "").slice(0, 120));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo analizar el HTML."); }
    finally { setBusy(false); }
  }

  function updateField(id: string, patch: Partial<ImportedSlideField>) {
    setReviewed(false);
    setDesign(current => current && ({ ...current, layouts: current.layouts.map((layout, index) => index === selected
      ? { ...layout, fields: layout.fields.map(field => field.id === id ? { ...field, ...patch } : field) } : layout) }));
  }

  async function save() {
    if (!design || !reviewed || !title.trim()) return;
    setBusy(true); setError("");
    try {
      await importRequest({ action: "save", title, design, reviewed });
      setSaved(true); onSaved?.(); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo guardar la plantilla."); }
    finally { setBusy(false); }
  }

  const layout = design?.layouts[selected];
  return <>
    <button type="button" onClick={() => void open()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-800 dark:bg-gray-900 dark:text-white">
      <Upload size={16} /> {conversationId ? "Revisar diseño" : "Importar HTML"}
    </button>
    <dialog ref={dialog} aria-labelledby={dialogTitleId} onCancel={event => { if (busy) event.preventDefault(); }}
      className="m-auto max-h-[92vh] w-[min(1200px,95vw)] overflow-auto rounded-xl bg-white p-5 text-gray-950 shadow-xl backdrop:bg-black/60 dark:bg-gray-950 dark:text-white">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div><h2 id={dialogTitleId} className="text-xl font-bold">Importar plantilla de diapositivas HTML</h2>
          <p className="mt-1 text-sm text-gray-500">Conserva la estructura de tu diseño y define qué campos recibirá el contenido del agente.</p></div>
        <button type="button" aria-label="Cerrar importación" disabled={busy} onClick={() => dialog.current?.close()}><X /></button>
      </div>
      <p className="mb-4 text-sm">Formato inicial: secciones con clase «slide», canvas 1920 × 1080, texto y SVG estático. Los scripts, imágenes y recursos externos se retiran; revisa el resultado antes de guardar.</p>
      <label className="block text-sm font-semibold">Archivo HTML
        <input type="file" accept=".html,.htm,text/html" disabled={busy} onChange={event => void analyzeFile(event.target.files?.[0])} className="mt-2 block w-full rounded border p-2" />
      </label>
      {busy && <p role="status" className="my-3 flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={16} /> Procesando la plantilla…</p>}
      {error && <p role="alert" className="my-3 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {saved && <p role="status" className="my-3 rounded bg-emerald-50 p-3 text-sm text-emerald-800">Plantilla guardada. Ya puedes seleccionarla al generar diapositivas desde la biblioteca.</p>}
      {analysis && design && layout && <div className="mt-4 space-y-4">
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p>{design.layouts.length} diseños detectados. Scripts retirados: {analysis.report.removedScripts}. Recursos retirados: {analysis.report.removedResources}.</p>
          {analysis.report.warnings.map(warning => <p key={warning} className="mt-1">{warning}</p>)}
        </div>
        <label className="block text-sm font-semibold">Nombre de la plantilla
          <input value={title} maxLength={120} disabled={busy || saved} onChange={event => { setTitle(event.target.value); setReviewed(false); }} className="mt-1 block w-full rounded border bg-transparent p-2" />
        </label>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-sm font-semibold">Diseño que deseas revisar
              <select value={selected} onChange={event => setSelected(Number(event.target.value))} className="mt-1 block w-full rounded border bg-white p-2 text-gray-950">
                {design.layouts.map((item, index) => <option key={item.id} value={index}>{index + 1}. {item.label}</option>)}
              </select>
            </label>
            <ImportedSlidePreview html={analysis.previews[selected]} title={`Preview de ${layout.label}`} />
            <label className="block text-sm font-semibold">Uso del diseño
              <select value={layout.purpose} disabled={busy || saved} onChange={event => { const purpose = event.target.value as typeof layout.purpose;
                setReviewed(false); setDesign({ ...design, layouts: design.layouts.map((item, index) => index === selected ? { ...item, purpose } : item) });
              }} className="mt-1 block w-full rounded border bg-white p-2 text-gray-950">
                <option value="any">Cualquier diapositiva compatible</option><option value="cover">Portada</option><option value="content">Contenido</option><option value="summary">Cierre</option>
              </select>
            </label>
          </div>
          <div><h3 className="mb-2 font-semibold">Campos reutilizables</h3><p className="mb-3 text-xs text-gray-500">Un título por diseño. «Contenido» se llena en orden; «Decoración» conserva su texto original. Si el contenido excede la capacidad, la generación lo indicará.</p>
            <div className="max-h-96 space-y-2 overflow-auto">
              {layout.fields.map(field => <div key={field.id} className="rounded border border-gray-200 p-2">
                <p className="mb-2 break-words text-sm">{field.sample}</p>
                <div className="flex gap-2">
                  <label className="flex-1 text-xs">Rol<select aria-label={`Rol de ${field.id}`} value={field.role} disabled={busy || saved} onChange={event => updateField(field.id, { role: event.target.value as ImportedSlideField["role"] })} className="mt-1 block w-full rounded border bg-white p-1.5 text-gray-950">
                    <option value="title">Título</option><option value="subtitle">Subtítulo</option><option value="body">Contenido</option><option value="decoration">Decoración</option>
                  </select></label>
                  <label className="w-28 text-xs">Máx. caracteres<input aria-label={`Capacidad de ${field.id}`} type="number" min={1} max={900} value={field.maxCharacters} disabled={busy || saved || field.role === "decoration"} onChange={event => updateField(field.id, { maxCharacters: Number(event.target.value) })} className="mt-1 block w-full rounded border bg-transparent p-1.5" /></label>
                </div>
              </div>)}
            </div>
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy || saved} onChange={event => setReviewed(event.target.checked)} className="mt-1" />He revisado todos los diseños, sus campos y los recursos retirados; confirmo que puedo utilizar este material.</label>
        <button type="button" onClick={() => void save()} disabled={!reviewed || !title.trim() || busy || saved} className="rounded-lg bg-[var(--engine-primary)] px-4 py-2 font-bold text-white disabled:opacity-40">Guardar en plantillas</button>
      </div>}
    </dialog>
  </>;
}
