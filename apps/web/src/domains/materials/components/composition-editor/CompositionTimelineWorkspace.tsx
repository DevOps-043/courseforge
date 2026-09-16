import { AlertTriangle } from "lucide-react";
import type { CompositionClip, CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionAnimation } from "@/domains/production/composition-editor/composition-motion.types";
import { formatCompositionTimecode } from "@/domains/production/composition-editor/composition-timecode";
import { AudioMixControls, type CompositionDuckingUpdate } from "./AudioMixControls";
import { CompositionTimeline } from "./CompositionTimeline";
import type { CompositionTrackUpdateHandler } from "./composition-studio.types";
import styles from "./CompositionStudio.module.css";

export type AssemblyBrandingAvailability = {
  hasIntro: boolean;
  hasOutro: boolean;
  outros: Array<{ duration_milliseconds: number; id: string; name: string }>;
  selectedOutroAssetId: string | null;
};

interface CompositionTimelineWorkspaceProps {
  assetLabels: Record<string, string>;
  brandingAvailability: AssemblyBrandingAvailability | null;
  currentTime: number;
  document: CompositionEditorDocument;
  durationSourceLabel: string | null;
  estimatedClipCount: number;
  onAnimationSelect: (animationId: string, clipHfId: string) => void;
  onAnimationTimingChange: (animation: CompositionAnimation, timing: CompositionAnimation["timing"]) => void;
  onAudioMixUpdate: (settings: CompositionDuckingUpdate, summary: string) => void;
  onClearSelection: () => void;
  onDurationChange: (clip: CompositionClip, durationSeconds: number) => void;
  onMove: (clip: CompositionClip, startSeconds: number) => void;
  onOrganize: () => void;
  onOutroChange: (outroId: string | null) => void;
  onRecalculateDuration: () => void;
  onRecoverHistoricalAssets: () => void;
  onRefreshProductionAssets: () => void;
  onSeek: (seconds: number) => void;
  onSelect: (hfId: string) => void;
  onTrackUpdate: CompositionTrackUpdateHandler;
  onTrim: (clip: CompositionClip, startSeconds: number, durationSeconds: number, sourceOffsetSeconds: number) => void;
  recoveringHistoricalAssets: boolean;
  refreshingProductionAssets: boolean;
  saving: boolean;
  selectedAnimationId: string | null;
  selectedHfId: string | null;
  snapEnabled: boolean;
  trimToolEnabled: boolean;
}

export function CompositionTimelineWorkspace({ assetLabels, brandingAvailability, currentTime, document, durationSourceLabel, estimatedClipCount, onAnimationSelect, onAnimationTimingChange, onAudioMixUpdate, onClearSelection, onDurationChange, onMove, onOrganize, onOutroChange, onRecalculateDuration, onRecoverHistoricalAssets, onRefreshProductionAssets, onSeek, onSelect, onTrackUpdate, onTrim, recoveringHistoricalAssets, refreshingProductionAssets, saving, selectedAnimationId, selectedHfId, snapEnabled, trimToolEnabled }: CompositionTimelineWorkspaceProps) {
  const duration = document.canvas.durationSeconds;
  return <section className={styles.timelinePanel}>
    <div className={styles.timelineScroll}>
      <div className={`${styles.durationStrip} ${durationSourceLabel ? "" : styles.durationStripWarning}`}>
        <span>{durationSourceLabel ? `Duración total: ${formatCompositionTimecode(duration)} · ${durationSourceLabel}` : "Define el asset que controla la duración del contenido."}</span>
        <div className={styles.durationActions}>
          <button type="button" disabled={saving} onClick={onRecalculateDuration} className={styles.durationAction}>Recalcular duración</button>
          <button type="button" disabled={saving} onClick={onOrganize} className={styles.durationAction}>Organizar timeline</button>
          <button type="button" disabled={saving || refreshingProductionAssets || recoveringHistoricalAssets} onClick={onRefreshProductionAssets} className={styles.durationAction}>{refreshingProductionAssets ? "Actualizando…" : "Actualizar assets"}</button>
          <button type="button" disabled={saving || refreshingProductionAssets || recoveringHistoricalAssets} onClick={onRecoverHistoricalAssets} className={styles.durationAction}>{recoveringHistoricalAssets ? "Recuperando…" : "Recuperar históricos"}</button>
          {brandingAvailability && <select value={brandingAvailability.selectedOutroAssetId || ""} disabled={saving} onChange={(event) => onOutroChange(event.target.value || null)} className={styles.durationAction} aria-label="Outro de este video"><option value="">Sin outro</option>{brandingAvailability.outros.map((outro) => <option key={outro.id} value={outro.id}>{outro.name} · {(outro.duration_milliseconds / 1000).toFixed(1)} s</option>)}</select>}
        </div>
      </div>
      <AudioMixControls audioMix={document.audioMix} disabled={saving} onUpdate={onAudioMixUpdate} />
      <CompositionTimeline assetLabels={assetLabels} document={document} currentTime={currentTime} saving={saving} selectedAnimationId={selectedAnimationId} selectedHfId={selectedHfId} snapEnabled={snapEnabled} trimMode={trimToolEnabled} onAnimationSelect={onAnimationSelect} onAnimationTimingChange={onAnimationTimingChange} onClearSelection={onClearSelection} onDurationChange={onDurationChange} onMove={onMove} onSeek={onSeek} onSelect={onSelect} onTrackUpdate={onTrackUpdate} onTrim={onTrim} />
      {estimatedClipCount > 0 && <p className={styles.estimatedWarning}><AlertTriangle className="mt-0.5 shrink-0" size={14} /> {estimatedClipCount} segmentos tienen duración estimada. Arrastra su borde derecho para ajustarlos.</p>}
    </div>
  </section>;
}
