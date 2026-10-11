import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clapperboard, History, Loader2, Send, Trash2, X } from "lucide-react";
import { EngineSelect } from "@/components/ui/EngineSelect";
import { renderStageLabel } from "@/domains/production/hyperframes/hyperframes-render-diagnostics";
import {
  findHyperframesRenderProfile,
  getHyperframesRenderProfile,
  HYPERFRAMES_RENDER_PROFILES,
  sameHyperframesRenderSettings,
  type HyperframesRenderProfileId,
  type HyperframesRenderSettings,
} from "@/domains/production/hyperframes/hyperframes-render-profiles";
import {
  estimateHyperframesRenderBudget,
  formatRenderBudgetBytes,
} from "@/domains/production/hyperframes/hyperframes-render-budget.service";
import styles from "./CompositionStudio.module.css";

export type CompositionSnapshotEntry = {
  createdAt: string;
  documentHash: string;
  documentVersion: number;
  id: string;
  isActive: boolean;
  isCurrentDocument: boolean;
  projectArchiveSizeBytes: number;
  renderProfile: HyperframesRenderSettings | null;
  renderProfileId: HyperframesRenderProfileId | null;
  revisionNumber: number;
};

export type ActiveCompositionAssembly = {
  projectArchiveSizeBytes: number;
  renderProfile: HyperframesRenderSettings | null;
  revisionId: string;
  status: "READY_FOR_PREVIEW" | "READY_FOR_RENDER";
};

interface CompositionDeliveryPanelProps {
  canvas?: { width: number; height: number };
  assembly: ActiveCompositionAssembly | null;
  busy: boolean;
  compact?: boolean;
  diagnostics: ReactNode;
  durationSeconds: number;
  error: string | null;
  history: CompositionSnapshotEntry[] | null;
  historyOpen: boolean;
  importStatus: string;
  notice: string | null;
  onApprove: () => void;
  onDeleteAndRender: () => void;
  onHistoryToggle: () => void;
  onPrepare: () => void;
  onProfileChange: (profileId: HyperframesRenderProfileId) => void;
  onRender: () => void;
  onRestore: (snapshot: CompositionSnapshotEntry) => void;
  priorCompletedVideo: boolean;
  providerStatus: string | null;
  renderStatus: "idle" | "validating" | "sending" | "rendering" | "completed" | "failed" | "cancelled";
  selectedRenderProfileId: HyperframesRenderProfileId;
}

export function CompositionDeliveryPanel({ canvas, diagnostics, importStatus, assembly, busy, compact = false, durationSeconds, error, notice, history, historyOpen, onApprove, onDeleteAndRender, onHistoryToggle, onPrepare, onProfileChange, onRender, onRestore, priorCompletedVideo, providerStatus, renderStatus, selectedRenderProfileId }: CompositionDeliveryPanelProps) {
  const selectedProfile = getHyperframesRenderProfile(selectedRenderProfileId);
  const renderBudget = estimateHyperframesRenderBudget({ durationSeconds, renderProfile: selectedProfile });
  const profileMatchesAssembly = !assembly || sameHyperframesRenderSettings(assembly.renderProfile, selectedProfile);
  const normalizedProviderStatus = providerStatus?.toUpperCase() || null;
  const label = renderStatus === "validating" ? "Validando snapshot…"
    : renderStatus === "cancelled" ? "Proceso cancelado. Puedes iniciar otro intento."
    : renderStatus === "sending" ? "Registrando el render…"
    : renderStatus === "rendering" ? renderStageLabel(normalizedProviderStatus || "PENDING", importStatus)
    : renderStatus === "completed" ? "Video completado e importado en SofLIA - Engine." : "";
  const summary = renderStatus === "completed"
    ? "El video final ya está disponible."
    : assembly
      ? assembly.status === "READY_FOR_RENDER"
        ? priorCompletedVideo
          ? "Snapshot aprobado. Puedes renderizar esta revisión; el video anterior continúa disponible para publicación."
          : "Snapshot aprobado. Puedes enviar el render."
        : "Snapshot listo. Revísalo y apruébalo para renderizar."
      : "Congela la versión guardada antes de enviar un render.";
  const activeRender = renderStatus === "sending" || renderStatus === "rendering";
  const deliveryState = renderStatus === "completed" ? "complete" : activeRender ? "working" : assembly?.status === "READY_FOR_RENDER" ? "ready" : "draft";
  const deliveryLabel = deliveryState === "complete" ? "Listo para publicar" : deliveryState === "working" ? "Renderizando" : deliveryState === "ready" ? "Listo para render" : "Preparando salida";

  return <section className={`${styles.deliveryPanel} ${compact ? styles.deliveryPanelCompact : ""}`}>
    <header className={styles.deliveryHeader}>
      <span className={styles.deliveryIcon} data-state={deliveryState}>{deliveryState === "complete" ? <CheckCircle2 size={17} /> : <Clapperboard size={17} />}</span>
      <div className={styles.deliveryTitle}><span>Entrega final</span><strong>{deliveryState === "complete" ? "Video listo para publicar" : "Salida de video"}</strong><p>{summary}</p></div>
      <span className={styles.deliveryStatus} data-state={deliveryState}><span aria-hidden="true" />{deliveryLabel}</span>
    </header>

    <div className={styles.deliveryBody}>
      <div className={styles.outputMetrics} aria-label="Datos de la salida">
        <span><small>Archivo</small><strong>{assembly ? formatAssemblyBytes(assembly.projectArchiveSizeBytes) : "—"}</strong></span>
        <span><small>Resolución</small><strong>{canvas ? `${canvas.width} × ${canvas.height}` : "1080p"}</strong></span>
        <span><small>Cuadros</small><strong>{assembly?.renderProfile?.fps || selectedProfile.fps} FPS</strong></span>
        <span><small>Calidad</small><strong>{renderQualityLabel(assembly?.renderProfile?.quality || selectedProfile.quality)}</strong></span>
        <span><small>Salida estimada</small><strong>{formatRenderBudgetBytes(renderBudget.estimatedOutputBytes)}</strong></span>
      </div>

      <label className={styles.outputProfile}>
        <span className={styles.renderProfileLabel}>Formato de salida</span>
        <EngineSelect aria-label="Perfil de render" disabled={busy || activeRender} value={selectedRenderProfileId} onValueChange={(value) => onProfileChange(value as HyperframesRenderProfileId)} options={HYPERFRAMES_RENDER_PROFILES.map((profile) => ({ value: profile.id, label: `${profile.label} · 1080p · 25 FPS`, description: profile.description }))} />
      </label>

      <div className={styles.deliveryActions}>
        <button type="button" disabled={busy || activeRender || renderBudget.requiresSegmentation} onClick={() => void onPrepare()} className={styles.deliveryActionSecondary}><Clapperboard size={14} /> {busy && renderStatus === "validating" ? "Preparando…" : assembly ? "Nueva versión" : "Crear snapshot"}</button>
        <button type="button" disabled={busy || history === null} onClick={onHistoryToggle} className={styles.deliveryActionGhost}><History size={14} /> Versiones {history ? history.length : ""}</button>
        {assembly?.status === "READY_FOR_PREVIEW" && <button type="button" disabled={busy || !profileMatchesAssembly} onClick={() => void onApprove()} className={styles.deliveryActionPrimary}><CheckCircle2 size={14} /> Aprobar salida</button>}
        {assembly?.status === "READY_FOR_RENDER" && <button type="button" disabled={busy || activeRender || renderStatus === "completed" || !profileMatchesAssembly || renderBudget.requiresSegmentation} onClick={() => void onRender()} className={`${styles.deliveryActionPrimary} ${renderStatus === "completed" ? styles.deliveryActionComplete : ""}`}>{renderStatus === "completed" ? <CheckCircle2 size={14} /> : <Send size={14} />} {activeRender ? "Render en curso" : renderStatus === "completed" ? "Render completado" : renderStatus === "failed" ? "Reintentar render" : "Renderizar video"}</button>}
        {assembly?.status === "READY_FOR_RENDER" && priorCompletedVideo && <button type="button" disabled={busy || activeRender} onClick={() => void onDeleteAndRender()} className={styles.deliveryActionDanger}><Trash2 size={14} /> Reemplazar</button>}
      </div>
    </div>

    {diagnostics}
    {(notice || !profileMatchesAssembly || label || priorCompletedVideo || error || renderBudget.recommendedSegmentCount > 1) && <div className={styles.deliveryMessages}>
      {notice && <p role="status" data-tone="success"><CheckCircle2 size={12} />{notice}</p>}
      {!profileMatchesAssembly && <p role="status" data-tone="warning"><AlertTriangle size={12} />El formato cambió. Crea una nueva versión antes de aprobar o renderizar.</p>}
      {label && <p role="status">{activeRender && <Loader2 className="animate-spin" size={12} />}{label}</p>}
      {priorCompletedVideo && <p role="status" data-tone="warning"><AlertTriangle size={12} />El video anterior seguirá disponible hasta que termine esta revisión.</p>}
      {renderBudget.recommendedSegmentCount > 1 && <p role={renderBudget.requiresSegmentation ? "alert" : "status"} data-tone={renderBudget.requiresSegmentation ? "danger" : "warning"}><AlertTriangle size={12} />{renderBudget.requiresSegmentation ? `La salida estimada supera 2 GiB. Divide la composición en al menos ${renderBudget.recommendedSegmentCount} segmentos antes de renderizar.` : `Para una recuperación más segura, recomendamos ${renderBudget.recommendedSegmentCount} segmentos de hasta ${Math.floor(renderBudget.recommendedSegmentSeconds / 60)} min.`}</p>}
      {error && <p role="alert" data-tone="danger"><AlertTriangle size={12} />{error}</p>}
    </div>}

    {historyOpen && <>
      <button type="button" className={styles.snapshotBackdrop} aria-label="Cerrar versiones" onClick={onHistoryToggle} />
      <aside className={styles.snapshotHistory} role="dialog" aria-modal="true" aria-labelledby="snapshot-history-title">
        <div className={styles.snapshotHistoryHeader}><div><strong id="snapshot-history-title">Versiones de salida</strong><span>{history?.length || 0} snapshots disponibles</span></div><button type="button" aria-label="Cerrar versiones" onClick={onHistoryToggle}><X size={15} /></button></div>
        <p className={styles.snapshotEmpty}>Restaurar reemplaza el timeline editable y la salida activa con el contenido de esa versión.</p>
        {history && history.length > 0 ? <div className={styles.snapshotList}>{history.map((snapshot) => {
          const fullyRestored = snapshot.isActive && snapshot.isCurrentDocument;
          const actionLabel = fullyRestored ? "En uso" : snapshot.isActive ? "Restaurar timeline" : snapshot.isCurrentDocument ? "Activar salida" : "Restaurar";
          return <div key={snapshot.id} className={styles.snapshotRow}><span><strong>Versión {snapshot.revisionNumber}{snapshot.isActive ? " · salida activa" : ""}{snapshot.isCurrentDocument ? " · en timeline" : ""}</strong><small>Documento v{snapshot.documentVersion} · {findHyperframesRenderProfile(snapshot.renderProfile)?.label || "Perfil anterior"} · {new Date(snapshot.createdAt).toLocaleString()}</small></span><button type="button" disabled={busy || fullyRestored} onClick={() => void onRestore(snapshot)} className={styles.deliveryActionGhost}>{actionLabel}</button></div>;
        })}</div> : <p className={styles.snapshotEmpty}>Todavía no hay versiones guardadas.</p>}
      </aside>
    </>}
  </section>;
}

function formatAssemblyBytes(value: number) {
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function renderQualityLabel(quality: HyperframesRenderSettings["quality"]) {
  return quality === "high" ? "alta" : quality === "draft" ? "borrador" : "estándar";
}
