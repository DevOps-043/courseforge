"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2 } from "lucide-react";
import { EngineDialog } from "@/components/ui/EngineDialog";
import { HTML_SLIDE_IMPORT_LIMITS, HTML_SLIDE_SOURCE_SIZE_LABEL, type ImportedSlideDesign, type ImportedSlideField } from "../imported-slide-design.contract";
import { ImportedSlidePreview } from "./ImportedSlidePreview";
import styles from "./ImportSlideTemplateDialog.module.css";

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
  const [isOpen, setIsOpen] = useState(false);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [design, setDesign] = useState<ImportedSlideDesign | null>(null);
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function open() {
    setIsOpen(true);
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
      setError(`Selecciona un archivo .html de hasta ${HTML_SLIDE_SOURCE_SIZE_LABEL}.`); return;
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
    <button type="button" onClick={() => void open()} className={styles.trigger}>
      <Upload size={16} /> {conversationId ? "Revisar diseño" : "Importar HTML"}
    </button>
    <EngineDialog isOpen={isOpen} onClose={() => setIsOpen(false)} closeDisabled={busy}
      size={analysis ? "workspace" : "wide"} eyebrow="Plantillas de diapositivas" icon={<Upload />}
      title="Importar plantilla de diapositivas HTML"
      description="Conserva la estructura de tu diseño y define qué campos recibirá el contenido del agente."
      bodyClassName={styles.body}
      footer={<>
        <button type="button" disabled={busy} onClick={() => setIsOpen(false)} className={styles.secondary}>{saved ? "Cerrar" : "Cancelar"}</button>
        {analysis && <button type="button" onClick={() => void save()} disabled={!reviewed || !title.trim() || busy || saved} className={styles.primary}>
          {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}Guardar en plantillas
        </button>}
      </>}>
      <p className={styles.intro}>Archivos HTML de hasta {HTML_SLIDE_SOURCE_SIZE_LABEL}, con CSS incluido. Formato inicial: secciones con clase «slide», canvas 1920 × 1080, texto y SVG estático. Los scripts, imágenes y recursos externos se retiran; revisa el resultado antes de guardar.</p>
      <label className={styles.field}>Archivo HTML
        <input type="file" accept=".html,.htm,text/html" disabled={busy} onChange={event => void analyzeFile(event.target.files?.[0])} className={styles.fileInput} />
      </label>
      {busy && <p role="status" className={styles.status}><Loader2 className="animate-spin" size={16} /> Procesando la plantilla…</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {saved && <p role="status" className={styles.success}>Plantilla guardada. Ya puedes seleccionarla al generar diapositivas desde la biblioteca.</p>}
      {analysis && design && layout && <div className={styles.analysis}>
        <div className={styles.notice}>
          <p>{design.layouts.length} diseños detectados. Scripts retirados: {analysis.report.removedScripts}. Recursos retirados: {analysis.report.removedResources}.</p>
          {analysis.report.warnings.map(warning => <p key={warning}>{warning}</p>)}
        </div>
        <label className={styles.field}>Nombre de la plantilla
          <input value={title} maxLength={120} disabled={busy || saved} onChange={event => { setTitle(event.target.value); setReviewed(false); }} className={styles.control} />
        </label>
        <div className={styles.workspace}>
          <div className={styles.previewColumn}>
            <label className={styles.field}>Diseño que deseas revisar
              <select value={selected} onChange={event => setSelected(Number(event.target.value))} className={styles.control}>
                {design.layouts.map((item, index) => <option key={item.id} value={index}>{index + 1}. {item.label}</option>)}
              </select>
            </label>
            <ImportedSlidePreview html={analysis.previews[selected]} title={`Preview de ${layout.label}`} />
            <label className={styles.field}>Uso del diseño
              <select value={layout.purpose} disabled={busy || saved} onChange={event => { const purpose = event.target.value as typeof layout.purpose;
                setReviewed(false); setDesign({ ...design, layouts: design.layouts.map((item, index) => index === selected ? { ...item, purpose } : item) });
              }} className={styles.control}>
                <option value="any">Cualquier diapositiva compatible</option><option value="cover">Portada</option><option value="content">Contenido</option><option value="summary">Cierre</option>
              </select>
            </label>
          </div>
          <div className={styles.fields}><h3>Campos reutilizables</h3><p className={styles.muted}>Un título por diseño. «Contenido» se llena en orden; «Decoración» conserva su texto original. Si el contenido excede la capacidad, la generación lo indicará.</p>
            <div className={styles.fieldList}>
              {layout.fields.map(field => <div key={field.id} className={styles.fieldCard}>
                <p className={styles.sample}>{field.sample}</p>
                <div className={styles.fieldControls}>
                  <label className={styles.field}>Rol<select aria-label={`Rol de ${field.id}`} value={field.role} disabled={busy || saved} onChange={event => updateField(field.id, { role: event.target.value as ImportedSlideField["role"] })} className={styles.control}>
                    <option value="title">Título</option><option value="subtitle">Subtítulo</option><option value="body">Contenido</option><option value="decoration">Decoración</option>
                  </select></label>
                  <label className={styles.field}>Máx. caracteres<input aria-label={`Capacidad de ${field.id}`} type="number" min={1} max={900} value={field.maxCharacters} disabled={busy || saved || field.role === "decoration"} onChange={event => updateField(field.id, { maxCharacters: Number(event.target.value) })} className={styles.control} /></label>
                </div>
              </div>)}
            </div>
          </div>
        </div>
        <label className={styles.review}><input type="checkbox" checked={reviewed} disabled={busy || saved} onChange={event => setReviewed(event.target.checked)} />He revisado todos los diseños, sus campos y los recursos retirados; confirmo que puedo utilizar este material.</label>
      </div>}
    </EngineDialog>
  </>;
}
