"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Music2, RotateCcw, Save, Scissors, Trash2 } from "lucide-react";
import type { CompositionClip, CompositionTrack, CompositionVisualCrop } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";
import type { CompositionAnimation } from "@/domains/production/composition-editor/composition-motion.types";
import { COMPOSITION_MOTION_ENABLED } from "@/domains/production/composition-editor/composition-motion.config";
import type { CompositionColorGrading } from "@/domains/production/composition-editor/composition-color-grading.types";
import { COMPOSITION_COLOR_GRADING_ENABLED } from "@/domains/production/composition-editor/composition-color-grading.config";
import type { CompositionColorGradingRuntimeStatus } from "@/domains/production/composition-editor/composition-preview-protocol";
import { formatCompositionTimecode, parseCompositionTimecode } from "@/domains/production/composition-editor/composition-timecode";
import {
  compositionClipHasConfigurableAudio,
  resolveCompositionClipDefaultVolume,
} from "@/domains/production/composition-editor/composition-clip-audio.service";
import {
  hasCompositionCrop,
  normalizeCompositionCropInsets,
  resolveCompositionCropInsets,
  type CompositionCropInsets,
} from "@/domains/production/composition-editor/composition-visual-crop.service";
import { CompositionMotionControls } from "./CompositionMotionControls";
import { CompositionColorCorrectionControls } from "./CompositionColorCorrectionControls";
import { LayerDepthControls } from "./LayerDepthControls";
import { VolumeSlider } from "./VolumeSlider";
import { CompositionTextControls } from "./CompositionTextControls";
import { AudioProcessingControls } from "./AudioProcessingControls";
import styles from "./CompositionStudio.module.css";

type PatchHandler = (
  operations: CompositionEditorPatchOperation[],
  summary: string,
) => Promise<boolean>;

interface CompositionInspectorProps {
  animations: CompositionAnimation[];
  clip: CompositionClip | null;
  componentId: string;
  cropModeEnabled: boolean;
  colorGradingStatus: CompositionColorGradingRuntimeStatus | null;
  onAnimationSelect: (animationId: string | null) => void;
  onDetachAudio: (clip: CompositionClip) => Promise<void>;
  onPatch: PatchHandler;
  onPreviewCrop: (hfId: string, crop: CompositionVisualCrop) => void;
  onPreviewColorGrading: (hfId: string, colorGrading: CompositionColorGrading | null) => void;
  onRemove: (clip: CompositionClip) => Promise<void>;
  saving: boolean;
  selectedAnimationId: string | null;
  separatingAudio: boolean;
  separatingAudioProgress: number;
  sourcePreviewUrl: string | null;
  track: CompositionTrack | null;
}

export function CompositionInspector({ animations, clip, colorGradingStatus, componentId, cropModeEnabled, onAnimationSelect, onDetachAudio, onPatch, onPreviewColorGrading, onPreviewCrop, onRemove, saving, selectedAnimationId, separatingAudio, separatingAudioProgress, sourcePreviewUrl, track }: CompositionInspectorProps) {
  const [startSeconds, setStartSeconds] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [rotation, setRotation] = useState("");
  const [opacity, setOpacity] = useState("");
  const [volume, setVolume] = useState(1);
  const [fadeInSeconds, setFadeInSeconds] = useState(0);
  const [fadeOutSeconds, setFadeOutSeconds] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  useEffect(() => { setStartSeconds(clip ? formatCompositionTimecode(clip.startSeconds) : ""); setDurationSeconds(clip ? formatCompositionTimecode(clip.durationSeconds) : ""); setX(clip ? String(clip.layout.x) : ""); setY(clip ? String(clip.layout.y) : ""); }, [clip?.id, clip?.startSeconds, clip?.durationSeconds, clip?.layout.x, clip?.layout.y]);
  useEffect(() => { setWidth(clip ? String(clip.layout.width) : ""); setHeight(clip ? String(clip.layout.height) : ""); setRotation(clip ? String(clip.layout.rotation) : ""); setOpacity(clip ? String(clip.layout.opacity) : ""); }, [clip?.id, clip?.layout.height, clip?.layout.opacity, clip?.layout.rotation, clip?.layout.width]);
  useEffect(() => {
    if (!clip) {
      setVolume(1);
      return;
    }
    setVolume(clip.volume ?? resolveCompositionClipDefaultVolume(clip, track ?? undefined));
    setFadeInSeconds(clip.fadeInSeconds || 0);
    setFadeOutSeconds(clip.fadeOutSeconds || 0);
  }, [clip?.id, clip?.kind, clip?.volume, clip?.fadeInSeconds, clip?.fadeOutSeconds, track?.id, track?.semanticRole, track?.volume]);
  if (!clip) return <p className={styles.emptyInspector}>Selecciona un clip en la timeline o directamente en el monitor para editar su posición, visibilidad o duración.</p>;
  const numberOrNull = (value: string) => { const result = Number(value); return Number.isFinite(result) ? result : null; };
  const isMusicClip = clip.kind === "AUDIO" && track?.semanticRole === "MUSIC";
  if (isMusicClip && track) {
    const saveMusicChanges = async () => {
      const duration = parseCompositionTimecode(durationSeconds);
      if (duration === null || duration < 0.05 || volume < 0 || volume > 1 || fadeInSeconds < 0 || fadeOutSeconds < 0 || fadeInSeconds + fadeOutSeconds > duration) {
        setValidationError("Revisa duración, volumen y fades. La suma de los fades no puede exceder el clip.");
        return;
      }
      setValidationError(null);
      await onPatch([
        { clipId: clip.id, durationSeconds: duration, type: "clip.duration" },
        { clipId: clip.id, type: "clip.volume", volume },
        { clipId: clip.id, fadeInSeconds, fadeOutSeconds, type: "clip.audio-fades" },
      ], `Ajustó la duración y el volumen de ${clip.label}.`);
    };
    return <div className="space-y-3"><div className="flex items-start gap-2"><span className="rounded-md bg-violet-100 p-1.5 text-violet-700 dark:bg-violet-400/10 dark:text-violet-200"><Music2 size={16} /></span><div><p className="text-sm font-semibold text-slate-900 dark:text-white">{clip.label}</p><p className="mt-0.5 text-[11px] text-slate-500 dark:text-gray-400">Música · ajustes de audio</p></div></div><TimecodeField label="Duración (mm:ss)" value={durationSeconds} onChange={setDurationSeconds} /><VolumeSlider accentClassName="accent-violet-500" ariaLabel="Volumen de la música" disabled={saving} label="Volumen" onChange={setVolume} value={volume} /><AudioFadeControls disabled={saving} fadeInSeconds={fadeInSeconds} fadeOutSeconds={fadeOutSeconds} onFadeInChange={setFadeInSeconds} onFadeOutChange={setFadeOutSeconds} /><p className="text-[10px] leading-4 text-slate-500 dark:text-gray-400">Estos ajustes modifican la duración real del clip y el volumen base de la música. El ducking se configura por separado.</p>{validationError && <p role="alert" className="rounded-md bg-red-50 px-2 py-1.5 text-[10px] text-red-700 dark:bg-red-500/10 dark:text-red-200">{validationError}</p>}<button type="button" disabled={saving} onClick={() => void saveMusicChanges()} className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"><Save size={13} /> Guardar audio</button></div>;
  }
  const hasConfigurableClipAudio = compositionClipHasConfigurableAudio(clip, track ?? undefined);
  const canDetachAudio = clip.kind === "VIDEO" && hasConfigurableClipAudio;
  const voiceSourceAssetId = clip.kind === "AUDIO"
    && track?.semanticRole === "VOICE"
    && clip.source.type === "PRODUCTION_ASSET"
    ? clip.source.productionAssetId
    : null;
  if (clip.kind === "AUDIO") {
    const audioDisabled = saving || separatingAudio || Boolean(track?.locked);
    const saveAudioChanges = async () => {
      const start = parseCompositionTimecode(startSeconds);
      const duration = parseCompositionTimecode(durationSeconds);
      if (start === null || duration === null || duration < 0.05
        || !Number.isFinite(volume) || volume < 0 || volume > 1
        || !Number.isFinite(fadeInSeconds) || fadeInSeconds < 0
        || !Number.isFinite(fadeOutSeconds) || fadeOutSeconds < 0
        || fadeInSeconds + fadeOutSeconds > duration) {
        setValidationError("Revisa inicio, duración, volumen y fades. La suma de los fades no puede exceder el clip.");
        return;
      }
      setValidationError(null);
      await onPatch([
        { clipId: clip.id, durationSeconds: duration, type: "clip.duration" },
        { clipId: clip.id, startSeconds: start, type: "clip.move" },
        { clipId: clip.id, type: "clip.volume", volume },
        { clipId: clip.id, fadeInSeconds, fadeOutSeconds, type: "clip.audio-fades" },
      ], `Ajustó el audio de ${clip.label}.`);
    };
    const resetAudioAsset = async () => {
      if (!window.confirm(`¿Reiniciar ${clip.label}? Se restaurarán su tiempo y volumen originales y se quitarán los fragmentos derivados.`)) return;
      await onPatch([{ clipId: clip.id, type: "clip.reset-asset" }], `Reinició el audio de ${clip.label}.`);
    };
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{clip.label}</p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gray-400">Audio · pista {clip.trackId}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            <button type="button" disabled={audioDisabled} onClick={() => void onPatch([{ clipId: clip.id, hidden: !clip.hidden, type: "clip.visibility" }], `${clip.hidden ? "Activó" : "Silenció"} ${clip.label}.`)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50 dark:border-white/15 dark:text-gray-200">
              {clip.hidden ? <Eye size={13} /> : <EyeOff size={13} />}{clip.hidden ? "Activar" : "Silenciar"}
            </button>
            <button type="button" disabled={audioDisabled} onClick={() => void onRemove(clip)} className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50 dark:border-red-400/40 dark:text-red-200">
              <Trash2 size={13} /> Quitar
            </button>
          </div>
        </div>
        <p className="rounded-md bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500 dark:bg-white/5 dark:text-gray-400">Quitar solo retira este clip de la línea de tiempo; el archivo original permanece disponible.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <TimecodeField label="Inicio (mm:ss)" value={startSeconds} onChange={setStartSeconds} />
          <TimecodeField label="Duración (mm:ss)" value={durationSeconds} onChange={setDurationSeconds} />
        </div>
        <p className="text-[10px] text-slate-500 dark:text-gray-400">Formato: 01:05 = 1 minuto y 5 segundos; 00:01.050 incluye milisegundos.</p>
        <section className="border-t border-slate-200 pt-3 dark:border-white/10">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Audio del clip</p>
          <VolumeSlider accentClassName="accent-cyan-500" ariaLabel={`Volumen de ${clip.label}`} disabled={audioDisabled} label="Volumen individual" onChange={setVolume} value={volume} />
          <AudioFadeControls disabled={audioDisabled} fadeInSeconds={fadeInSeconds} fadeOutSeconds={fadeOutSeconds} onFadeInChange={setFadeInSeconds} onFadeOutChange={setFadeOutSeconds} />
          <p className="mt-2 text-[10px] leading-4 text-slate-500 dark:text-gray-400">Los fades son no destructivos y se aplican en preview y render. El volumen de la pista continúa funcionando como control maestro.</p>
        </section>
        {voiceSourceAssetId !== null && <AudioProcessingControls componentId={componentId} disabled={audioDisabled} sourceAssetId={voiceSourceAssetId} sourcePreviewUrl={sourcePreviewUrl} />}
        {validationError && <p role="alert" className="rounded-md bg-red-50 px-2 py-1.5 text-[10px] text-red-700 dark:bg-red-500/10 dark:text-red-200">{validationError}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={audioDisabled} onClick={() => void saveAudioChanges()} className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50 dark:bg-cyan-400 dark:text-slate-950"><Save size={13} /> Guardar audio</button>
          <button type="button" disabled={audioDisabled || clip.source.type !== "PRODUCTION_ASSET"} onClick={() => void resetAudioAsset()} className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2.5 py-1.5 text-xs font-bold text-amber-800 disabled:opacity-50 dark:border-amber-400/40 dark:text-amber-200"><RotateCcw size={13} /> Reiniciar audio</button>
          {saving && <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400"><Loader2 className="animate-spin" size={13} /> Actualizando preview…</span>}
        </div>
      </div>
    );
  }
  const saveAllChanges = async () => {
    const start = parseCompositionTimecode(startSeconds);
    const duration = parseCompositionTimecode(durationSeconds);
    const layout = {
      height: numberOrNull(height),
      opacity: numberOrNull(opacity),
      rotation: numberOrNull(rotation),
      width: numberOrNull(width),
      x: numberOrNull(x),
      y: numberOrNull(y),
    };
    if (start === null || duration === null || duration < 0.05 || Object.values(layout).some((value) => value === null) || (hasConfigurableClipAudio && (volume < 0 || volume > 1 || fadeInSeconds < 0 || fadeOutSeconds < 0 || fadeInSeconds + fadeOutSeconds > duration))) {
      setValidationError("Revisa tiempo, posición y transformación. Todos los valores deben ser válidos y la duración debe ser mayor a cero.");
      return;
    }
    setValidationError(null);
    const operations: CompositionEditorPatchOperation[] = [
      { clipId: clip.id, durationSeconds: duration, type: "clip.duration" },
      { clipId: clip.id, startSeconds: start, type: "clip.move" },
      { clipId: clip.id, layout: layout as { height: number; opacity: number; rotation: number; width: number; x: number; y: number }, type: "clip.layout" },
    ];
    if (hasConfigurableClipAudio) {
      operations.push({ clipId: clip.id, type: "clip.volume", volume });
      operations.push({ clipId: clip.id, fadeInSeconds, fadeOutSeconds, type: "clip.audio-fades" });
    }
    await onPatch(operations, `Guardó tiempo, posición, transformación${hasConfigurableClipAudio ? " y volumen" : ""} de ${clip.label}.`);
  };
  const resetAsset = async () => {
    const confirmed = window.confirm(`¿Reiniciar ${clip.label}? Se restaurarán su tamaño, tiempo y encuadre originales; también se quitarán sus animaciones y fragmentos derivados.`);
    if (!confirmed) return;
    await onPatch([{ clipId: clip.id, type: "clip.reset-asset" }], `Reinició ${clip.label} a su estado base.`);
  };
  const supportsVisualCrop = clip.kind === "VIDEO" || clip.kind === "IMAGE" || clip.kind === "DECK_SLIDE";
  if (clip.kind === "TEXT" || clip.kind === "CAPTION") {
    return <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-slate-900 dark:text-white">{clip.label}</p><p className="mt-0.5 text-[11px] text-slate-500 dark:text-gray-400">{clip.kind} · pista {clip.trackId}</p></div><div className="flex gap-1"><button type="button" disabled={saving} onClick={() => void onPatch([{ clipId: clip.id, hidden: !clip.hidden, type: "clip.visibility" }], `${clip.hidden ? "Mostró" : "Ocultó"} ${clip.label}.`)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold"><Eye size={13} />{clip.hidden ? "Mostrar" : "Ocultar"}</button><button type="button" disabled={saving} onClick={() => void onRemove(clip)} className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs font-semibold text-red-700"><Trash2 size={13} /> Quitar</button></div></div>
      <CompositionTextControls clip={clip} disabled={saving || Boolean(track?.locked)} onPatch={onPatch} />
      <LayerDepthControls clip={clip} disabled={saving || Boolean(track?.locked)} onPatch={onPatch} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"><TimecodeField label="Inicio (mm:ss)" value={startSeconds} onChange={setStartSeconds} /><TimecodeField label="Duración (mm:ss)" value={durationSeconds} onChange={setDurationSeconds} /><InspectorField label="Posición X" value={x} onChange={setX} /><InspectorField label="Posición Y" value={y} onChange={setY} /><InspectorField label="Ancho" value={width} onChange={setWidth} min={1} /><InspectorField label="Alto" value={height} onChange={setHeight} min={1} /><InspectorField label="Rotación" value={rotation} onChange={setRotation} min={-360} /><InspectorField label="Opacidad de capa" value={opacity} onChange={setOpacity} min={0} /></div>
      {COMPOSITION_MOTION_ENABLED && <CompositionMotionControls animations={animations} clip={clip} disabled={saving || Boolean(track?.locked)} selectedAnimationId={selectedAnimationId} onSelectAnimation={onAnimationSelect} onPatch={onPatch} />}
      {validationError && <p role="alert" className="rounded-md bg-red-50 px-2 py-1.5 text-[10px] text-red-700">{validationError}</p>}
      <button type="button" disabled={saving || Boolean(track?.locked)} onClick={() => void saveAllChanges()} className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"><Save size={13} /> Guardar layout</button>
    </div>;
  }
  return <div className="space-y-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-slate-900 dark:text-white">{clip.label}</p><p className="mt-0.5 text-[11px] text-slate-500 dark:text-gray-400">{clip.kind} · pista {clip.trackId}</p></div><div className="flex flex-wrap gap-1"><button type="button" disabled={saving || separatingAudio} onClick={() => void onPatch([{ clipId: clip.id, hidden: !clip.hidden, type: "clip.visibility" }], `${clip.hidden ? "Mostró" : "Ocultó"} ${clip.label}.`)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50 dark:border-white/15 dark:text-gray-200">{clip.hidden ? <Eye size={13} /> : <EyeOff size={13} />}{clip.hidden ? "Mostrar" : "Ocultar"}</button><button type="button" disabled={saving || separatingAudio} onClick={() => void onRemove(clip)} className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-400/40 dark:text-red-200 dark:hover:bg-red-400/10"><Trash2 size={13} /> Quitar</button></div></div><p className="rounded-md bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500 dark:bg-white/5 dark:text-gray-400">Quitar solo retira este clip de la línea de tiempo; los assets y el deck original permanecen disponibles.</p>{clip.kind !== "AUDIO" && <LayerDepthControls clip={clip} disabled={saving || separatingAudio} onPatch={onPatch} />}<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"><TimecodeField label="Inicio (mm:ss)" value={startSeconds} onChange={setStartSeconds} /><TimecodeField label="Duración (mm:ss)" value={durationSeconds} onChange={setDurationSeconds} /><InspectorField label="Posición X" value={x} onChange={setX} /><InspectorField label="Posición Y" value={y} onChange={setY} /></div><p className="text-[10px] text-slate-500 dark:text-gray-400">Formato: 01:05 = 1 minuto y 5 segundos; 00:01.050 incluye milisegundos.</p>{hasConfigurableClipAudio && <section className="border-t border-slate-200 pt-3 dark:border-white/10"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Audio del clip</p><VolumeSlider accentClassName="accent-cyan-500" ariaLabel={`Volumen de ${clip.label}`} disabled={saving || separatingAudio} label="Volumen individual" onChange={setVolume} value={volume} /><AudioFadeControls disabled={saving || separatingAudio} fadeInSeconds={fadeInSeconds} fadeOutSeconds={fadeOutSeconds} onFadeInChange={setFadeInSeconds} onFadeOutChange={setFadeOutSeconds} /><p className="mt-2 text-[10px] leading-4 text-slate-500 dark:text-gray-400">Los fades son no destructivos y se aplican en preview y render. El volumen de la pista continúa funcionando como control maestro.</p>{canDetachAudio && <button type="button" disabled={saving || separatingAudio} onClick={() => void onDetachAudio(clip)} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-cyan-300 bg-cyan-50 px-2.5 py-1.5 text-xs font-bold text-cyan-800 disabled:opacity-50 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-200">{separatingAudio ? <Loader2 className="animate-spin" size={13} /> : <Scissors size={13} />}{separatingAudio ? `Analizando y separando… ${Math.round(separatingAudioProgress * 100)}%` : "Separar audio del video"}</button>}<p className="mt-2 text-[10px] leading-4 text-slate-500 dark:text-gray-400">Al separar, el audio pasa a Voz / narración y el video original queda silenciado. Ambos se editan de forma independiente.</p></section>}{voiceSourceAssetId !== null && <AudioProcessingControls componentId={componentId} disabled={saving || separatingAudio || Boolean(track?.locked)} sourceAssetId={voiceSourceAssetId} sourcePreviewUrl={sourcePreviewUrl} />}<div className="border-t border-slate-200 pt-3 dark:border-white/10"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Transformación</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"><InspectorField label="Ancho" value={width} onChange={setWidth} min={1} /><InspectorField label="Alto" value={height} onChange={setHeight} min={1} /><InspectorField label="Rotación" value={rotation} onChange={setRotation} min={-360} /><InspectorField label="Opacidad" value={opacity} onChange={setOpacity} min={0} /></div><p className="mt-2 text-[10px] text-slate-500">Arrastra en el preview para mover; usa el tirador para redimensionar. Mantén Alt para liberar proporciones.</p></div>{(clip.kind === "VIDEO" || clip.kind === "IMAGE") && <MediaFitControls clip={clip} disabled={saving || separatingAudio} onPatch={onPatch} track={track} />}{COMPOSITION_COLOR_GRADING_ENABLED && (clip.kind === "VIDEO" || clip.kind === "IMAGE") && <CompositionColorCorrectionControls clip={clip} disabled={saving || separatingAudio || Boolean(track?.locked)} onPatch={onPatch} onPreview={onPreviewColorGrading} runtimeStatus={colorGradingStatus} />}{supportsVisualCrop && <VisualCropControls clip={clip} cropModeEnabled={cropModeEnabled} disabled={saving || separatingAudio} onPatch={onPatch} onPreviewCrop={onPreviewCrop} />}{COMPOSITION_MOTION_ENABLED && clip.kind !== "AUDIO" && <CompositionMotionControls animations={animations} clip={clip} disabled={saving || separatingAudio} selectedAnimationId={selectedAnimationId} onSelectAnimation={onAnimationSelect} onPatch={onPatch} />}{validationError && <p role="alert" className="rounded-md bg-red-50 px-2 py-1.5 text-[10px] text-red-700 dark:bg-red-500/10 dark:text-red-200">{validationError}</p>}<div className="flex flex-wrap gap-2"><button type="button" disabled={saving || separatingAudio} onClick={() => void saveAllChanges()} className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50 dark:bg-cyan-400 dark:text-slate-950"><Save size={13} /> Guardar cambios</button><button type="button" disabled={saving || separatingAudio || clip.source.type !== "PRODUCTION_ASSET"} onClick={() => void resetAsset()} className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2.5 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-400/40 dark:text-amber-200 dark:hover:bg-amber-400/10" title="Restaurar tiempo, tamaño, encuadre y animaciones del asset"><RotateCcw size={13} /> Reiniciar asset</button>{saving && <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400"><Loader2 className="animate-spin" size={13} /> Actualizando preview…</span>}</div></div>;
}

function MediaFitControls({ clip, disabled, onPatch, track }: { clip: CompositionClip; disabled: boolean; onPatch: PatchHandler; track: CompositionTrack | null }) {
  const currentFit = clip.mediaFit || ((track?.semanticRole === "AVATAR" || track?.id === "avatar") ? "CONTAIN" : "COVER");
  const changeFit = (mediaFit: "CONTAIN" | "COVER") => {
    const operations: CompositionEditorPatchOperation[] = [{ clipId: clip.id, mediaFit, type: "clip.media-fit" }];
    if (mediaFit === "CONTAIN" && clip.crop) operations.push({ clipId: clip.id, crop: null, type: "clip.crop" });
    const summary = mediaFit === "CONTAIN" ? `Mostró completo ${clip.label}.` : `Ajustó ${clip.label} para llenar su caja.`;
    return onPatch(operations, summary);
  };
  return <section className="border-t border-slate-200 pt-3 dark:border-white/10"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Ajuste del medio</p><div className="grid grid-cols-2 gap-2"><button type="button" disabled={disabled || currentFit === "CONTAIN"} onClick={() => void changeFit("CONTAIN")} className="rounded-md border border-slate-300 px-2 py-1.5 text-[10px] font-bold text-slate-700 disabled:bg-cyan-50 disabled:text-cyan-700 dark:border-white/15 dark:text-gray-200 dark:disabled:bg-cyan-400/10 dark:disabled:text-cyan-200">Mostrar completo</button><button type="button" disabled={disabled || currentFit === "COVER"} onClick={() => void changeFit("COVER")} className="rounded-md border border-slate-300 px-2 py-1.5 text-[10px] font-bold text-slate-700 disabled:bg-cyan-50 disabled:text-cyan-700 dark:border-white/15 dark:text-gray-200 dark:disabled:bg-cyan-400/10 dark:disabled:text-cyan-200">Llenar caja</button></div><p className="mt-2 text-[10px] leading-4 text-slate-500 dark:text-gray-400">“Mostrar completo” elimina el recorte explícito y conserva toda la fuente. “Llenar caja” puede ocultar bordes si la proporción es distinta.</p></section>;
}

function VisualCropControls({ clip, cropModeEnabled, disabled, onPatch, onPreviewCrop }: { clip: CompositionClip; cropModeEnabled: boolean; disabled: boolean; onPatch: PatchHandler; onPreviewCrop: (hfId: string, crop: CompositionVisualCrop) => void }) {
  const [crop, setCrop] = useState<CompositionCropInsets>(() => resolveCompositionCropInsets(clip.crop, clip.layout));
  useEffect(() => {
    setCrop(resolveCompositionCropInsets(clip.crop, clip.layout));
  }, [clip.id, clip.crop, clip.layout.height, clip.layout.width]);
  const preview = (next: CompositionCropInsets) => {
    const normalized = normalizeCompositionCropInsets(next, clip.layout);
    setCrop(normalized);
    onPreviewCrop(clip.hfId, normalized);
  };
  const save = (next = crop) => onPatch([{ clipId: clip.id, crop: hasCompositionCrop(next) ? next : null, type: "clip.crop" }], `Ajustó el recorte visual de ${clip.label}.`);
  const clear = () => {
    const empty = { bottom: 0, left: 0, right: 0, top: 0 };
    preview(empty);
    return save(empty);
  };
  const fields: Array<{ key: keyof CompositionCropInsets; label: string; maximum: number }> = [
    { key: "top", label: "Superior", maximum: clip.layout.height - crop.bottom - 1 },
    { key: "right", label: "Derecho", maximum: clip.layout.width - crop.left - 1 },
    { key: "bottom", label: "Inferior", maximum: clip.layout.height - crop.top - 1 },
    { key: "left", label: "Izquierdo", maximum: clip.layout.width - crop.right - 1 },
  ];
  return <section className={`border-t pt-3 ${cropModeEnabled ? "border-amber-300" : "border-slate-200 dark:border-white/10"}`}><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Recorte visual</p>{cropModeEnabled && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-800">Recorte activo</span>}</div><p className="mt-1 text-[10px] leading-4 text-slate-500">Cada borde oculta píxeles únicamente desde su dirección. No escala el contenido ni modifica ancho, alto, X o Y.</p><div className="mt-2 grid grid-cols-2 gap-2">{fields.map((field) => <label key={field.key} className="text-[10px] font-medium text-slate-600 dark:text-gray-300"><span className="flex justify-between gap-2"><span>{field.label}</span><span className="font-mono">{Math.round(crop[field.key])} px</span></span><input type="range" min="0" max={Math.max(0, field.maximum)} step="1" value={crop[field.key]} disabled={disabled} onChange={(event) => preview({ ...crop, [field.key]: Number(event.target.value) })} className="mt-1 w-full accent-amber-500" /></label>)}</div><div className="mt-2 flex flex-wrap gap-1.5"><button type="button" disabled={disabled} onClick={() => void save()} className="rounded-md bg-amber-500 px-2 py-1 text-[10px] font-bold text-slate-950 disabled:opacity-50">Guardar recorte</button><button type="button" disabled={disabled} onClick={() => void clear()} className="rounded-md border border-slate-300 px-2 py-1 text-[10px] font-bold text-slate-600 disabled:opacity-50 dark:border-white/15 dark:text-gray-300">Quitar recorte</button></div></section>;
}

function TimecodeField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) { return <label className="text-xs font-medium text-slate-600 dark:text-gray-300"><span>{label}</span><input type="text" inputMode="decimal" placeholder="00:00" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white" /></label>; }

function InspectorField({ label, min, onChange, value }: { label: string; min?: number; onChange: (value: string) => void; value: string }) { return <label className="text-xs font-medium text-slate-600 dark:text-gray-300"><span>{label}</span><input type="number" step="0.05" min={min} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white" /></label>; }

function AudioFadeControls({ disabled, fadeInSeconds, fadeOutSeconds, onFadeInChange, onFadeOutChange }: { disabled: boolean; fadeInSeconds: number; fadeOutSeconds: number; onFadeInChange: (value: number) => void; onFadeOutChange: (value: number) => void }) {
  return <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[10px] font-medium text-slate-600 dark:text-gray-300"><span>Fade de entrada (s)</span><input aria-label="Fade de entrada en segundos" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white" disabled={disabled} min="0" max="30" step="0.05" type="number" value={fadeInSeconds} onChange={(event) => onFadeInChange(Number(event.target.value))} /></label><label className="text-[10px] font-medium text-slate-600 dark:text-gray-300"><span>Fade de salida (s)</span><input aria-label="Fade de salida en segundos" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white" disabled={disabled} min="0" max="30" step="0.05" type="number" value={fadeOutSeconds} onChange={(event) => onFadeOutChange(Number(event.target.value))} /></label></div>;
}
