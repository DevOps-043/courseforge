"use client";

import { useState } from "react";
import { Check, Loader2, RotateCcw, Save, Sparkles, WandSparkles, X } from "lucide-react";
import type { CompositionPresetCatalogEntry } from "@/domains/production/composition-editor/composition-preset.types";

export type CompositionPresetPreviewState = {
  applicationId: string;
  baseDocumentHash: string;
  expiresAt: string;
  preset: { id: string; name: string; version: number };
  proposedDocumentHash: string;
  summary: {
    affectedClipCount: number;
    affectedTrackCount: number;
    generatedAnimationCount: number;
    presetName: string;
    warnings: Array<{ code: string; message: string; ruleId: string }>;
  };
};

export type AppliedCompositionPreset = {
  applicationId: string;
  name: string;
};

export function CompositionPresetPanel({
  activePreview,
  busy,
  entries,
  lastApplied,
  loading,
  onApply,
  onClose,
  onCreate,
  onDismiss,
  onPreview,
  onReload,
  onUndo,
  open,
}: {
  activePreview: CompositionPresetPreviewState | null;
  busy: boolean;
  entries: CompositionPresetCatalogEntry[];
  lastApplied: AppliedCompositionPreset | null;
  loading: boolean;
  onApply: () => Promise<void>;
  onClose: () => void;
  onCreate: (input: { description: string; instruction?: string; mode: "INSTRUCTIONS" | "MANUAL"; name: string }) => Promise<void>;
  onDismiss: () => Promise<void>;
  onPreview: (presetId: string) => Promise<void>;
  onReload: () => Promise<void>;
  onUndo: () => Promise<void>;
  open: boolean;
}) {
  const [mode, setMode] = useState<"INSTRUCTIONS" | "MANUAL">("MANUAL");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instruction, setInstruction] = useState("");
  const [creating, setCreating] = useState(false);
  if (!open) return null;

  const create = async () => {
    if (name.trim().length < 3 || (mode === "INSTRUCTIONS" && instruction.trim().length < 3)) return;
    setCreating(true);
    try {
      await onCreate({
        description: description.trim(),
        ...(mode === "INSTRUCTIONS" ? { instruction: instruction.trim() } : {}),
        mode,
        name: name.trim(),
      });
      setName("");
      setDescription("");
      setInstruction("");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-slate-950/55 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !activePreview) onClose(); }}>
      <aside className="flex h-full w-full max-w-md flex-col border-l border-white/10 bg-white shadow-2xl dark:bg-slate-950" role="dialog" aria-modal="true" aria-labelledby="composition-presets-title">
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-white/10">
          <div>
            <h2 id="composition-presets-title" className="flex items-center gap-2 text-base font-bold text-slate-950 dark:text-white"><WandSparkles size={17} /> Presets de edición</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Aplica patrones reutilizables sin sustituir tus assets.</p>
          </div>
          <button type="button" disabled={Boolean(activePreview)} onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-white/10" aria-label="Cerrar presets"><X size={16} /></button>
        </header>

        {activePreview ? (
          <div className="flex flex-1 flex-col p-5">
            <div className="rounded-xl border border-cyan-300 bg-cyan-50 p-4 dark:border-cyan-400/30 dark:bg-cyan-400/10">
              <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">Preview no guardado</p>
              <h3 className="mt-1 text-lg font-bold text-slate-950 dark:text-white">{activePreview.preset.name}</h3>
              <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">Ajustará {activePreview.summary.affectedClipCount} clips, {activePreview.summary.affectedTrackCount} pistas y generará {activePreview.summary.generatedAnimationCount} animaciones.</p>
              {activePreview.summary.warnings.length > 0 && <ul className="mt-3 space-y-1 text-[11px] text-amber-800 dark:text-amber-200">{activePreview.summary.warnings.map((warning) => <li key={`${warning.ruleId}-${warning.code}`}>• {warning.message}</li>)}</ul>}
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">La timeline actual permanece intacta hasta que confirmes. Al aplicar se crea una nueva versión completa y auditable.</p>
            <div className="mt-auto grid grid-cols-2 gap-2 pt-6">
              <button type="button" disabled={busy} onClick={() => void onDismiss()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50 dark:border-white/15 dark:text-slate-200">Descartar</button>
              <button type="button" disabled={busy} onClick={() => void onApply()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50 dark:bg-cyan-400 dark:text-slate-950">{busy ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />} Aplicar preset</button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5">
            {lastApplied && <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 dark:border-emerald-400/30 dark:bg-emerald-400/10"><span className="min-w-0 text-xs text-emerald-900 dark:text-emerald-100"><strong className="block truncate">{lastApplied.name}</strong>Aplicado en la versión actual.</span><button type="button" disabled={busy} onClick={() => void onUndo()} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-400/50 px-2 py-1 text-[11px] font-bold text-emerald-800 disabled:opacity-50 dark:text-emerald-100"><RotateCcw size={12} /> Deshacer</button></div>}

            <section>
              <div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Catálogo</h3><button type="button" disabled={loading} onClick={() => void onReload()} className="text-[11px] font-semibold text-cyan-700 dark:text-cyan-300">Actualizar</button></div>
              {loading ? <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="animate-spin" size={15} /> Cargando presets…</div> : <div className="space-y-2">{entries.map((entry) => <article key={entry.id} className="rounded-xl border border-slate-200 p-3 dark:border-white/10"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="truncate text-sm font-bold text-slate-900 dark:text-white">{entry.name}</h4><p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{entry.description || "Preset personalizado"}</p><span className="mt-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500 dark:bg-white/10 dark:text-slate-300">{entry.sourceKind === "SYSTEM" ? "Sistema" : entry.sourceKind === "MANUAL" ? "Edición manual" : "Creado con IA"} · v{entry.version}</span></div><button type="button" disabled={busy} onClick={() => void onPreview(entry.id)} className="shrink-0 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950">Preview</button></div></article>)}</div>}
            </section>

            <section className="mt-6 border-t border-slate-200 pt-5 dark:border-white/10">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Crear preset</h3>
              <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-white/10 dark:bg-white/5" role="group" aria-label="Modo de creación del preset">
                <button
                  type="button"
                  aria-pressed={mode === "MANUAL"}
                  onClick={() => setMode("MANUAL")}
                  className={`rounded-md px-2 py-2 text-xs font-bold transition-colors ${mode === "MANUAL" ? "bg-cyan-600 text-white shadow-sm shadow-cyan-950/30 dark:bg-cyan-400 dark:text-slate-950" : "text-slate-500 hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"}`}
                >
                  Desde edición
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "INSTRUCTIONS"}
                  onClick={() => setMode("INSTRUCTIONS")}
                  className={`rounded-md px-2 py-2 text-xs font-bold transition-colors ${mode === "INSTRUCTIONS" ? "bg-violet-600 text-white shadow-sm shadow-violet-950/30 dark:bg-violet-400 dark:text-slate-950" : "text-slate-500 hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"}`}
                >
                  Con SofLIA
                </button>
              </div>
              <label className="mt-3 block text-[11px] font-bold text-slate-600 dark:text-slate-300">Nombre<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm font-normal outline-none focus:border-cyan-500 dark:border-white/15" placeholder="Ej. Academia dinámica" /></label>
              <label className="mt-3 block text-[11px] font-bold text-slate-600 dark:text-slate-300">Descripción<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm font-normal outline-none focus:border-cyan-500 dark:border-white/15" placeholder="Cuándo conviene usarlo" /></label>
              {mode === "INSTRUCTIONS" && <label className="mt-3 block text-[11px] font-bold text-slate-600 dark:text-slate-300">Instrucción<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={1500} rows={4} className="mt-1 w-full resize-none rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm font-normal outline-none focus:border-cyan-500 dark:border-white/15" placeholder="Presentador abajo a la derecha, diapositivas completas y entradas suaves…" /></label>}
              <p className="mt-2 text-[10px] leading-4 text-slate-500">{mode === "MANUAL" ? "Detectaremos secuencia, composición, audio y animaciones parametrizables de la versión guardada." : "SofLIA propondrá una composición segura y el sistema extraerá el patrón; la aplicación final seguirá siendo determinista."}</p>
              <button type="button" disabled={creating || busy || name.trim().length < 3 || (mode === "INSTRUCTIONS" && instruction.trim().length < 3)} onClick={() => void create()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{creating ? <Loader2 className="animate-spin" size={14} /> : mode === "INSTRUCTIONS" ? <Sparkles size={14} /> : <Save size={14} />} Crear preset</button>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
