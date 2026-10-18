"use client";

import { useState } from "react";
import { CAPTION_EFFECT_COLORS, DEFAULT_CAPTION_EFFECTS, type CompositionCaptionEffects, type CompositionCaptionEffectSettings } from "@/domains/production/composition-editor/composition-caption-effects.types";
import { applyCaptionAnimationPreset, identifyCaptionAnimationPreset, listCaptionAnimationPresets, type CaptionAnimationPresetId } from "@/domains/production/composition-editor/composition-caption-animation-presets";
import { resolveCaptionEffects, resolveCaptionWordRanges } from "@/domains/production/composition-editor/composition-caption-effects.service";
import type { CompositionCaptionCue } from "@/domains/production/composition-editor/composition-text-layer.types";
import { CompositionCaptionEmphasisControls } from "./CompositionCaptionEmphasisControls";

type Props = {
  effects: CompositionCaptionEffects | undefined;
  cues: CompositionCaptionCue[];
  disabled: boolean;
  onEffectsChange: (effects: CompositionCaptionEffects | undefined) => void;
  onCuesChange: (cues: CompositionCaptionCue[]) => void;
};
const fieldClass = "mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-white/15 dark:bg-slate-950";

export function CompositionCaptionEffectsControls({ effects, cues, disabled, onEffectsChange, onCuesChange }: Props) {
  const [selectedCueId, setSelectedCueId] = useState("");
  const cue = cues.find((candidate) => candidate.id === selectedCueId) || cues[0];
  const updateCue = (updated: CompositionCaptionCue) => onCuesChange(cues.map((candidate) => candidate.id === updated.id ? updated : candidate));
  const timed = Boolean(cue && resolveCaptionWordRanges(cue).length);
  const selectedPreset = identifyCaptionAnimationPreset(effects);
  const presets = listCaptionAnimationPresets();
  return <section className="space-y-3 rounded-md border border-violet-200 p-2 dark:border-violet-500/30" aria-label="Efectos de captions">
    <p className="text-xs font-semibold">Animación y resaltado</p>
    <label className="block text-xs">Preset de animación de captions<select className={fieldClass} disabled={disabled} value={selectedPreset || ""} onChange={(event) => {
      const presetId = event.target.value as CaptionAnimationPresetId;
      if (presets.some(preset => preset.id === presetId)) onEffectsChange(applyCaptionAnimationPreset(presetId));
    }}><option value="" disabled>Personalizado / original</option>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
    {selectedPreset && <p className="text-[10px] text-slate-500">{presets.find(preset => preset.id === selectedPreset)?.description}</p>}
    <p className="text-[10px] text-slate-500">El preset se aplica a la capa y conserva los ajustes de frases personalizadas. No modifica el texto ni sus tiempos.</p>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={effects !== undefined} disabled={disabled} onChange={(event) => onEffectsChange(event.target.checked ? { ...DEFAULT_CAPTION_EFFECTS } : undefined)} /> Configurar efectos de toda la capa</label>
    {effects && <CaptionEffectFields settings={effects} disabled={disabled} onChange={(patch) => onEffectsChange({ ...effects, ...patch })} />}
    <p className="text-[10px] text-slate-500">Cada frase repite su entrada y salida. Sin configuración se conserva el karaoke original. Los cambios válidos se guardan automáticamente.</p>
    {cue && <>
      <label className="block text-xs">Frase a personalizar<select className={fieldClass} value={cue.id} disabled={disabled} onChange={(event) => setSelectedCueId(event.target.value)}>{cues.map((candidate, index) => <option key={candidate.id} value={candidate.id}>{index + 1}. {candidate.text.slice(0, 70)}</option>)}</select></label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={cue.effects !== undefined} disabled={disabled} onChange={(event) => {
        const updated = { ...cue };
        if (event.target.checked) updated.effects = {};
        else delete updated.effects;
        updateCue(updated);
      }} /> Personalizar esta frase</label>
      {cue.effects && <CaptionEffectFields settings={resolveCaptionEffects(cue, effects)} disabled={disabled} onChange={(patch) => updateCue({ ...cue, effects: { ...cue.effects, ...patch } })} />}
      {!timed && <p role="status" className="text-[10px] text-amber-700 dark:text-amber-300">Esta frase no tiene palabras sincronizadas válidas. La animación de frase y el énfasis estático sí funcionan; el karaoke y el pulso necesitan timestamps de voz.</p>}
      <CompositionCaptionEmphasisControls cue={cue} disabled={disabled} onChange={updateCue} />
    </>}
  </section>;
}

function CaptionEffectFields({ settings, disabled, onChange }: {
  settings: CompositionCaptionEffectSettings;
  disabled: boolean;
  onChange: (patch: Partial<CompositionCaptionEffectSettings>) => void;
}) {
  return <fieldset disabled={disabled} className="grid grid-cols-2 gap-2 text-[10px] disabled:opacity-50">
    <label>Entrada<select className={fieldClass} value={settings.entry} onChange={(event) => onChange({ entry: event.target.value as CompositionCaptionEffectSettings["entry"] })}><option value="NONE">Ninguna</option><option value="FADE">Fade</option><option value="SLIDE_UP">Subir suavemente</option><option value="POP">Pop</option></select></label>
    <label>Salida<select className={fieldClass} value={settings.exit} onChange={(event) => onChange({ exit: event.target.value as CompositionCaptionEffectSettings["exit"] })}><option value="NONE">Ninguna</option><option value="FADE">Fade</option></select></label>
    <label>Duración (s)<input className={fieldClass} type="number" min={0.05} max={2} step={0.05} value={settings.durationSeconds} onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) onChange({ durationSeconds: event.target.valueAsNumber }); }} /></label>
    <label>Intensidad<input className={fieldClass} type="number" min={0.25} max={2} step={0.25} value={settings.intensity} onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) onChange({ intensity: event.target.valueAsNumber }); }} /></label>
    <label>Palabra activa<select className={fieldClass} value={settings.karaoke} onChange={(event) => {
      const karaoke = event.target.value as CompositionCaptionEffectSettings["karaoke"];
      onChange(karaoke === "BACKGROUND" ? { karaoke, activeColor: CAPTION_EFFECT_COLORS.highlightText,
        activeBackgroundColor: settings.activeBackgroundColor || CAPTION_EFFECT_COLORS.highlightBackground } : { karaoke });
    }}><option value="LEGACY">Karaoke original</option><option value="NONE">Desactivado</option><option value="OPACITY">Opacidad</option><option value="COLOR">Color</option><option value="BACKGROUND">Fondo resaltado</option></select></label>
    <label>Color del texto activo<input disabled={settings.karaoke !== "COLOR" && settings.karaoke !== "BACKGROUND"} className={fieldClass} type="color" value={settings.activeColor} onChange={(event) => onChange({ activeColor: event.target.value })} /></label>
    {settings.karaoke === "BACKGROUND" && <label>Fondo de palabra activa<input className={fieldClass} type="color" value={settings.activeBackgroundColor || CAPTION_EFFECT_COLORS.highlightBackground} onChange={(event) => onChange({ activeBackgroundColor: event.target.value })} /></label>}
    <label>Opacidad inactiva<input disabled={settings.karaoke === "LEGACY" || settings.karaoke === "NONE"} className={fieldClass} type="number" min={0} max={1} step={0.05} value={settings.inactiveOpacity} onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) onChange({ inactiveOpacity: event.target.valueAsNumber }); }} /></label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={settings.pulse} onChange={(event) => onChange({ pulse: event.target.checked })} /> Pulso de palabra activa</label>
  </fieldset>;
}
