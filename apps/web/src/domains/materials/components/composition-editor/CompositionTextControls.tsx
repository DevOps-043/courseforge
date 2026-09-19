"use client";

import { useEffect, useState } from "react";
import { FileUp, Plus, Save, Subtitles, Trash2, Type } from "lucide-react";
import type { CompositionClip } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";
import type {
  CompositionCaptionCue,
  CompositionTextLayerStyle,
} from "@/domains/production/composition-editor/composition-text-layer.types";
import { readCompositionApiResponse } from "@/domains/production/composition-editor/composition-editor-api.client";
import {
  MAX_CAPTION_IMPORT_BYTES,
  parseCompositionCaptionImport,
} from "@/domains/production/composition-editor/composition-caption-import.service";
import {
  applyCompositionCaptionPreset,
  listCompositionCaptionPresets,
  type CompositionCaptionPresetId,
} from "@/domains/production/composition-editor/composition-caption-preset.service";

type PatchHandler = (
  operations: CompositionEditorPatchOperation[],
  summary: string,
) => Promise<boolean>;

const DETERMINISTIC_FONT_FAMILIES = ["Inter", "Montserrat", "Roboto", "Arial", "Georgia"] as const;

type OrganizationFontOption = {
  family: string;
  id: string;
  renderEligible: boolean;
};

export function CompositionTextControls({
  clip,
  disabled,
  onPatch,
}: {
  clip: CompositionClip;
  disabled: boolean;
  onPatch: PatchHandler;
}) {
  const source = clip.source.type === "NATIVE_TEXT" || clip.source.type === "NATIVE_CAPTIONS"
    ? clip.source
    : null;
  const [text, setText] = useState("");
  const [cues, setCues] = useState<CompositionCaptionCue[]>([]);
  const [captionOrigin, setCaptionOrigin] = useState<"MANUAL" | "SRT" | "TRANSCRIPT" | "VTT">("MANUAL");
  const [captionPreset, setCaptionPreset] = useState<CompositionCaptionPresetId | "">("");
  const [captionImportSummary, setCaptionImportSummary] = useState<string | null>(null);
  const [isImportingCaptions, setIsImportingCaptions] = useState(false);
  const [style, setStyle] = useState<CompositionTextLayerStyle | null>(null);
  const [fontAssetId, setFontAssetId] = useState<string | null>(null);
  const [organizationFonts, setOrganizationFonts] = useState<OrganizationFontOption[]>([]);
  const [fontError, setFontError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source) return;
    // The inspector is a local draft form and must reset when another persisted clip source is selected.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStyle(source.style);
    setFontAssetId(source.style.fontAssetId || null);
    setText(source.type === "NATIVE_TEXT" ? source.text : "");
    setCues(source.type === "NATIVE_CAPTIONS" ? source.cues : []);
    setCaptionOrigin(source.type === "NATIVE_CAPTIONS" ? source.origin : "MANUAL");
    setCaptionPreset("");
    setCaptionImportSummary(null);
    setError(null);
  }, [clip.id, source]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/admin/fonts", { cache: "no-store" });
        const result = await readCompositionApiResponse<{ fonts?: OrganizationFontOption[]; error?: string }>(response, "No se pudieron cargar las fuentes de la organización.");
        if (!response.ok) throw new Error(result.error || "No se pudieron cargar las fuentes de la organización.");
        if (!cancelled) {
          setOrganizationFonts((result.fonts || []).filter((font) => font.renderEligible));
          setFontError(null);
        }
      } catch (caught) {
        if (!cancelled) setFontError(caught instanceof Error ? caught.message : "No se pudieron cargar las fuentes.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!source || !style) return null;

  const updateStyle = <Key extends keyof CompositionTextLayerStyle>(
    key: Key,
    value: CompositionTextLayerStyle[Key],
  ) => setStyle((current) => current ? { ...current, [key]: value } : current);

  const appendCaptionCue = () => {
    const ordered = [...cues].sort((left, right) => left.startSeconds - right.startSeconds);
    const startSeconds = ordered.at(-1)?.endSeconds || 0;
    if (startSeconds >= clip.durationSeconds) {
      setError("No queda tiempo libre al final de la capa para agregar otro caption.");
      return;
    }
    setCues([...ordered, {
      endSeconds: Math.min(clip.durationSeconds, startSeconds + 2),
      id: `cue-${crypto.randomUUID()}`,
      startSeconds,
      text: "Nuevo caption",
    }]);
    setError(null);
  };

  const importCaptions = async (file: File) => {
    if (file.size <= 0 || file.size > MAX_CAPTION_IMPORT_BYTES) {
      setError("El archivo de captions debe pesar entre 1 byte y 1 MiB.");
      return;
    }
    setIsImportingCaptions(true);
    try {
      const imported = parseCompositionCaptionImport({
        content: await file.text(),
        fileName: file.name,
        maxDurationSeconds: clip.durationSeconds,
      });
      setCues(imported.cues);
      setCaptionOrigin(imported.format);
      setCaptionImportSummary(`${imported.cues.length} captions importados desde ${file.name}.`);
      setError(null);
    } catch (caught) {
      setCaptionImportSummary(null);
      setError(caught instanceof Error ? caught.message : "No se pudo importar el archivo de captions.");
    } finally {
      setIsImportingCaptions(false);
    }
  };

  const save = async () => {
    const operations: CompositionEditorPatchOperation[] = [{
      clipId: clip.id,
      style: { ...style, fontAssetId },
      type: "clip.text-style",
    }];
    if (source.type === "NATIVE_TEXT") {
      if (!text.trim()) {
        setError("El texto no puede quedar vacío.");
        return;
      }
      operations.push({ clipId: clip.id, text, type: "clip.text-content" });
    } else {
      const ordered = [...cues].sort((left, right) => left.startSeconds - right.startSeconds);
      const invalid = ordered.some((cue, index) => (
        !cue.text.trim()
        || cue.startSeconds < 0
        || cue.endSeconds <= cue.startSeconds
        || cue.endSeconds > clip.durationSeconds
        || (index > 0 && cue.startSeconds < ordered[index - 1]!.endSeconds)
      ));
      if (invalid) {
        setError("Revisa texto y tiempos: los captions no deben solaparse ni exceder la capa.");
        return;
      }
      operations.push({ clipId: clip.id, cues: ordered, origin: captionOrigin, type: "clip.caption-cues" });
    }
    setError(null);
    await onPatch(operations, `Actualizó contenido y estilo de ${clip.label}.`);
  };

  return <section className="border-t border-slate-200 pt-3 dark:border-white/10">
    <div className="mb-2 flex items-center gap-2">
      {source.type === "NATIVE_TEXT" ? <Type size={14} /> : <Subtitles size={14} />}
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {source.type === "NATIVE_TEXT" ? "Contenido de texto" : "Captions"}
      </p>
    </div>
    {source.type === "NATIVE_TEXT"
      ? <textarea value={text} maxLength={4_000} disabled={disabled} onChange={(event) => setText(event.target.value)} className="min-h-24 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white" />
      : <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-slate-300 p-2 dark:border-white/15">
          <div><p className="text-[10px] font-semibold text-slate-600 dark:text-gray-300">Importar subtítulos</p><p className="text-[9px] text-slate-400">SRT o WebVTT · máximo 1 MiB · reemplaza los cues al guardar</p></div>
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-violet-400 hover:text-violet-700 dark:border-white/15 dark:text-gray-300"><FileUp size={12} /> {isImportingCaptions ? "Importando…" : "Seleccionar archivo"}<input type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" disabled={disabled || isImportingCaptions} className="sr-only" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importCaptions(file); event.currentTarget.value = ""; }} /></label>
        </div>
        {captionImportSummary && <p role="status" className="rounded-md bg-emerald-50 px-2 py-1.5 text-[10px] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">{captionImportSummary}</p>}
        <label className="block text-[10px] font-medium text-slate-600 dark:text-gray-300">Preset visual<select value={captionPreset} disabled={disabled} onChange={(event) => {
          const value = event.target.value as CompositionCaptionPresetId | "";
          setCaptionPreset(value);
          if (value) setStyle((current) => current ? applyCompositionCaptionPreset(current, value) : current);
        }} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-white/15 dark:bg-slate-950">
          <option value="">Aplicar un preset…</option>
          {listCompositionCaptionPresets().map((preset) => <option key={preset.id} value={preset.id}>{preset.label} · {preset.description}</option>)}
        </select></label>
        {cues.map((cue, index) => <div key={cue.id} className="rounded-md border border-slate-200 p-2 dark:border-white/10">
          <textarea value={cue.text} disabled={disabled} onChange={(event) => setCues((current) => current.map((item) => item.id === cue.id ? { ...item, text: event.target.value } : item))} className="min-h-14 w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs dark:border-white/10 dark:bg-slate-950" />
          <div className="mt-2 grid grid-cols-2 gap-2"><NumberField label="Inicio (s)" value={cue.startSeconds} disabled={disabled} onChange={(value) => setCues((current) => current.map((item) => item.id === cue.id ? { ...item, startSeconds: value } : item))} /><NumberField label="Fin (s)" value={cue.endSeconds} disabled={disabled} onChange={(value) => setCues((current) => current.map((item) => item.id === cue.id ? { ...item, endSeconds: value } : item))} /></div>
          <div className="mt-1 flex items-center justify-between"><p className="text-[9px] text-slate-400">Caption {index + 1}</p><button type="button" aria-label={`Eliminar caption ${index + 1}`} disabled={disabled || cues.length === 1} onClick={() => setCues((current) => current.filter((item) => item.id !== cue.id))} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-500/10"><Trash2 size={12} /></button></div>
        </div>)}
        <button type="button" disabled={disabled} onClick={appendCaptionCue} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-violet-400 hover:text-violet-700 disabled:opacity-50 dark:border-white/15 dark:text-gray-300"><Plus size={12} /> Agregar caption</button>
      </div>}
    <div className="mt-3 grid grid-cols-2 gap-2">
      <label className="text-[10px] font-medium text-slate-600 dark:text-gray-300">Fuente<select value={fontAssetId ? `asset:${fontAssetId}` : `builtin:${style.fontFamily}`} disabled={disabled} onChange={(event) => {
        const value = event.target.value;
        if (value.startsWith("asset:")) {
          const id = value.slice("asset:".length);
          const font = organizationFonts.find((candidate) => candidate.id === id);
          if (font) { setFontAssetId(font.id); updateStyle("fontFamily", font.family); }
          return;
        }
        setFontAssetId(null);
        updateStyle("fontFamily", value.slice("builtin:".length));
      }} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-white/15 dark:bg-slate-950"><optgroup label="Incluidas">{DETERMINISTIC_FONT_FAMILIES.map((family) => <option key={family} value={`builtin:${family}`}>{family}</option>)}</optgroup>{organizationFonts.length > 0 && <optgroup label="Organización">{organizationFonts.map((font) => <option key={font.id} value={`asset:${font.id}`}>{font.family}</option>)}</optgroup>}</select></label>
      <NumberField label="Tamaño" value={style.fontSize} min={8} max={400} disabled={disabled} onChange={(value) => updateStyle("fontSize", value)} />
      <NumberField label="Peso" value={style.fontWeight} min={100} max={900} step={100} disabled={disabled} onChange={(value) => updateStyle("fontWeight", value)} />
      <label className="text-[10px] font-medium text-slate-600 dark:text-gray-300">Alineación<select value={style.horizontalAlign} disabled={disabled} onChange={(event) => updateStyle("horizontalAlign", event.target.value as CompositionTextLayerStyle["horizontalAlign"])} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-white/15 dark:bg-slate-950"><option value="LEFT">Izquierda</option><option value="CENTER">Centro</option><option value="RIGHT">Derecha</option></select></label>
      <ColorField label="Texto" value={style.color} disabled={disabled} onChange={(value) => updateStyle("color", value)} />
      <ColorField label="Fondo" value={style.backgroundColor} disabled={disabled} onChange={(value) => updateStyle("backgroundColor", value)} />
      <NumberField label="Opacidad texto" value={style.textOpacity} min={0} max={1} step={0.05} disabled={disabled} onChange={(value) => updateStyle("textOpacity", value)} />
      <NumberField label="Opacidad fondo" value={style.backgroundOpacity} min={0} max={1} step={0.05} disabled={disabled} onChange={(value) => updateStyle("backgroundOpacity", value)} />
      <NumberField label="Stroke" value={style.strokeWidth} min={0} max={20} step={0.5} disabled={disabled} onChange={(value) => updateStyle("strokeWidth", value)} />
      <NumberField label="Sombra" value={style.shadowBlur} min={0} max={100} step={1} disabled={disabled} onChange={(value) => updateStyle("shadowBlur", value)} />
    </div>
    <p className="mt-2 text-[10px] leading-4 text-slate-500">La opacidad de la capa, del texto y del fondo son independientes. El preset de captions inicia con fondo transparente.</p>
    {fontError && <p className="mt-2 text-[10px] leading-4 text-amber-700 dark:text-amber-300">{fontError} Puedes continuar con las fuentes incluidas.</p>}
    {error && <p role="alert" className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-[10px] text-red-700 dark:bg-red-500/10 dark:text-red-200">{error}</p>}
    <button type="button" disabled={disabled} onClick={() => void save()} className="mt-2 inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"><Save size={13} /> Guardar texto</button>
  </section>;
}

function NumberField({ disabled, label, max, min, onChange, step = 0.05, value }: { disabled: boolean; label: string; max?: number; min?: number; onChange: (value: number) => void; step?: number; value: number }) {
  return <label className="text-[10px] font-medium text-slate-600 dark:text-gray-300">{label}<input type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-white/15 dark:bg-slate-950" /></label>;
}

function ColorField({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="text-[10px] font-medium text-slate-600 dark:text-gray-300">{label}<input type="color" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-white p-1 dark:border-white/15 dark:bg-slate-950" /></label>;
}
