import type { CSSProperties, PointerEventHandler, RefObject } from "react";
import { Loader2, Pause, Play, RefreshCw } from "lucide-react";
import type { CompositionSceneSummary } from "@/domains/production/composition-editor/composition-scene.service";
import { formatCompositionTimecode } from "@/domains/production/composition-editor/composition-timecode";
import { compositionTransportEnabled } from "@/domains/production/composition-editor/composition-transport-policy";
import { compositionShortcutKeys } from "@/domains/production/composition-editor/composition-shortcuts";
import styles from "./CompositionStudio.module.css";

interface CompositionPreviewViewportProps {
  activeSceneId?: string;
  agentProposalActive: boolean;
  duration: number;
  fps: number;
  frameRef: RefObject<HTMLIFrameElement | null>;
  onBeginScrub: PointerEventHandler<HTMLInputElement>;
  onPreviewLoad: () => void;
  onPlaySelectedAnimation: () => void;
  onRefreshDocument: () => void;
  onRefreshMedia: () => void;
  onSceneSelect: (scene: CompositionSceneSummary) => void;
  onSeek: (seconds: number) => void;
  onTogglePlayback: () => void;
  pendingMediaCount: number;
  playbackError: string | null;
  presetPreviewActive: boolean;
  previewDirty: boolean;
  previewMediaState: "BUFFERING" | "PLAYING" | "PREPARING" | "READY";
  previewReady: boolean;
  previewUrl: string;
  saving: boolean;
  scenes: CompositionSceneSummary[];
  seconds: number;
  selectedAnimationId: string | null;
  transportActive: boolean;
}

export function CompositionPreviewViewport({ activeSceneId, agentProposalActive, duration, fps, frameRef, onPreviewLoad, onBeginScrub, onPlaySelectedAnimation, onRefreshDocument, onRefreshMedia, onSceneSelect, onSeek, onTogglePlayback, pendingMediaCount, playbackError, presetPreviewActive, previewDirty, previewMediaState, previewReady, previewUrl, saving, scenes, seconds, selectedAnimationId, transportActive }: CompositionPreviewViewportProps) {
  return <>
    {scenes.length > 0 && (
      <nav aria-label="Microeditor por escenas" className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-white/10 bg-black/10 px-3 py-2">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">Escenas</span>
        {scenes.map((scene) => (
          <button
            key={scene.id}
            type="button"
            aria-current={activeSceneId === scene.id ? "step" : undefined}
            onClick={() => onSceneSelect(scene)}
            className={`shrink-0 rounded-md border px-2.5 py-1 text-[10px] font-semibold transition ${activeSceneId === scene.id ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200" : "border-white/10 text-slate-400 hover:border-white/20 hover:text-white"}`}
            title={`${scene.roles.join(" + ")} · ${formatCompositionTimecode(scene.durationSeconds)}`}
          >
            {scene.label}
          </button>
        ))}
      </nav>
    )}
    <div className={`${styles.previewViewport} courseforge-composition-preview-viewport`}>
      <div className={styles.previewFrame}>
        <iframe onLoad={onPreviewLoad} ref={frameRef} title="Preview completo de composición" src={previewUrl} sandbox="allow-scripts" allow="autoplay" className="absolute inset-0 h-full w-full" />
        {previewMediaState === "PREPARING" && <div className={styles.mediaPreparing}><div className={styles.mediaStatus}><Loader2 className="animate-spin" size={15} /> Preparando medios{pendingMediaCount > 0 ? ` (${pendingMediaCount})` : ""}…</div></div>}
        {previewMediaState === "BUFFERING" && <div className={styles.mediaBuffering}><span className={styles.mediaStatus}><Loader2 className="animate-spin" size={13} /> Cargando medio{pendingMediaCount > 1 ? ` (${pendingMediaCount})` : ""}…</span></div>}
      </div>
    </div>
    {playbackError && <div role="alert" className="flex items-center justify-between gap-3 border-t border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100"><span>{playbackError}</span><button type="button" onClick={onRefreshMedia} className="shrink-0 rounded border border-amber-400/50 px-2 py-1 font-semibold hover:bg-amber-100 dark:border-amber-200/50 dark:hover:bg-amber-200/10">Recargar medios</button></div>}
    <div className={styles.transport}>
      {selectedAnimationId && <button type="button" disabled={saving || !previewReady} onClick={onPlaySelectedAnimation} className={styles.toolButton}>Ver animación</button>}
      <button type="button" disabled={!compositionTransportEnabled({ saving, previewReady, previewMediaState })} onClick={onTogglePlayback} aria-label={transportActive ? "Pausar" : "Reproducir"} aria-keyshortcuts="Space" title={`${transportActive ? "Pausar" : previewDirty ? "Actualizar el preview y reproducir" : "Reproducir"} (${compositionShortcutKeys("toggle-playback")})`} className={styles.transportPrimary}>{transportActive ? <Pause size={14} /> : <Play size={14} />}</button>
      <button type="button" disabled={saving || !previewReady || agentProposalActive || presetPreviewActive} onClick={onRefreshDocument} title="Actualizar el preview con los cambios guardados" aria-label="Actualizar preview" className={`${styles.transportSecondary} ${previewDirty ? styles.transportSecondaryDirty : ""}`}><RefreshCw size={13} /></button>
      <input aria-label="Posición del preview" disabled={saving || !previewReady} type="range" min="0" max={duration} step={1 / fps} value={Math.min(seconds, duration)} onPointerDown={onBeginScrub} onChange={(event) => onSeek(Number(event.target.value))} className={styles.transportProgress} style={{ "--transport-progress": `${duration > 0 ? Math.min(100, (seconds / duration) * 100) : 0}%` } as CSSProperties} />
      <span className={styles.transportTime}>{formatCompositionTimecode(seconds)} / {formatCompositionTimecode(duration)}</span>
    </div>
  </>;
}
