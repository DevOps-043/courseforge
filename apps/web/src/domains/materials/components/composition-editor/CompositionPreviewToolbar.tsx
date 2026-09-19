import type { ReactNode, RefObject } from "react";
import { ArrowRight, ChevronDown, Clapperboard, Crop, Grid3X3, History, Keyboard, Magnet, Maximize2, Minimize2, Minus, MousePointer2, PanelRight, Plus, RefreshCw, Scan, Scissors, SlidersHorizontal, Sparkles, Trash2, X } from "lucide-react";
import type { CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import { formatCompositionTimecode } from "@/domains/production/composition-editor/composition-timecode";
import styles from "./CompositionStudio.module.css";

export type CompositionDocumentHistoryEntry = {
  createdAt: string;
  document: CompositionEditorDocument;
  documentHash: string;
  version: number;
};

interface CompositionPreviewToolbarProps {
  agentProposalActive: boolean;
  currentVersion: number;
  directEditingEnabled: boolean;
  duration: number;
  gridVisible: boolean;
  history: CompositionDocumentHistoryEntry[] | null;
  inspectorOpen: boolean;
  onCloseHistory: () => void;
  onContinueToPublication?: () => void;
  onHistoryOpen: () => void;
  onInspectorToggle: () => void;
  onIntervalAction: () => void;
  onOpenAssistant: () => void;
  onOpenShortcuts: () => void;
  onOpenPresets: () => void;
  onReload: () => void;
  onRestoreHistory: (entry: CompositionDocumentHistoryEntry) => void;
  onSplit: () => void;
  onToggleDirectEditing: () => void;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  onToggleToolMenu: () => void;
  onToggleTrim: () => void;
  onToggleVisualCrop: () => void;
  onToggleFullscreen: () => void;
  onZoom: (delta: number) => void;
  previewFullscreen: boolean;
  previewStatusLabel: string | null;
  previewZoom: number;
  removalRangeStartSeconds: number | null;
  saveError: string | null;
  saving: boolean;
  snapEnabled: boolean;
  toolMenuOpen: boolean;
  toolMenuRef: RefObject<HTMLDivElement | null>;
  trimToolEnabled: boolean;
  visualCropEnabled: boolean;
}

export function CompositionPreviewToolbar({ agentProposalActive, currentVersion, directEditingEnabled, duration, gridVisible, history, inspectorOpen, onCloseHistory, onContinueToPublication, onHistoryOpen, onInspectorToggle, onIntervalAction, onOpenAssistant, onOpenShortcuts, onOpenPresets, onReload, onRestoreHistory, onSplit, onToggleDirectEditing, onToggleFullscreen, onToggleGrid, onToggleSnap, onToggleToolMenu, onToggleTrim, onToggleVisualCrop, onZoom, previewFullscreen, previewStatusLabel, previewZoom, removalRangeStartSeconds, saveError, saving, snapEnabled, toolMenuOpen, toolMenuRef, trimToolEnabled, visualCropEnabled }: CompositionPreviewToolbarProps) {
  return <div className={styles.previewToolbar}>
    <div className={styles.previewIdentity}>
      <span className={styles.previewIdentityIcon}><Clapperboard size={14} aria-hidden="true" /></span>
      <span className={styles.previewTitle}>Ensamble <small>v{currentVersion} · {formatSeconds(duration)}</small>{previewStatusLabel ? <span className={styles.pendingBadge}>{previewStatusLabel}</span> : null}</span>
    </div>
    <div className={styles.previewTools}>
      <div className={styles.toolbarGroup} aria-label="Edición principal">
        <PreviewToolButton active={directEditingEnabled} label="Editar" title="Activar selección, arrastre y tiradores" onClick={onToggleDirectEditing}><MousePointer2 size={13} /></PreviewToolButton>
        <PreviewToolButton active={snapEnabled} label="Snap" title="Alinear clips, recortes y animaciones con el cursor y con otros límites temporales" onClick={onToggleSnap}><Magnet size={13} /></PreviewToolButton>
        <PreviewToolButton active={false} label="Dividir" title="Dividir el clip seleccionado en el cursor" onClick={onSplit}><Scissors size={13} /></PreviewToolButton>
      </div>
      <div ref={toolMenuRef} className={styles.toolMenuWrap}>
        <button type="button" aria-expanded={toolMenuOpen} aria-haspopup="menu" onClick={onToggleToolMenu} className={`${styles.toolButton} ${gridVisible || visualCropEnabled || trimToolEnabled || removalRangeStartSeconds !== null ? styles.toolButtonActive : ""}`} title="Abrir herramientas adicionales"><SlidersHorizontal size={13} /><span>Herramientas</span><ChevronDown className={toolMenuOpen ? styles.toolMenuChevronOpen : ""} size={12} /></button>
        {toolMenuOpen && <div className={styles.toolMenu} role="menu" aria-label="Herramientas adicionales">
          <button type="button" role="menuitemcheckbox" aria-checked={gridVisible} onClick={onToggleGrid} className={styles.toolMenuItem}><Grid3X3 size={14} /><span><strong>Rejilla</strong><small>Guías visuales del canvas</small></span><i data-active={gridVisible} /></button>
          <button type="button" role="menuitemcheckbox" aria-checked={visualCropEnabled} onClick={onToggleVisualCrop} className={styles.toolMenuItem}><Scan size={14} /><span><strong>Recorte visual</strong><small>Ajustar bordes del medio</small></span><i data-active={visualCropEnabled} /></button>
          <button type="button" role="menuitemcheckbox" aria-checked={trimToolEnabled} onClick={onToggleTrim} className={styles.toolMenuItem}><Crop size={14} /><span><strong>Recorte temporal</strong><small>Modificar inicio y duración</small></span><i data-active={trimToolEnabled} /></button>
          <button type="button" role="menuitem" onClick={onIntervalAction} className={styles.toolMenuItem}><Trash2 size={14} /><span><strong>{removalRangeStartSeconds === null ? "Marcar intervalo" : "Eliminar intervalo"}</strong><small>{removalRangeStartSeconds === null ? "Define el inicio de un corte" : `Desde ${formatCompositionTimecode(removalRangeStartSeconds)} al cursor`}</small></span><i data-active={removalRangeStartSeconds !== null} /></button>
        </div>}
      </div>
      <div className={styles.toolbarGroup} aria-label="Vista del monitor">
        <button type="button" disabled={previewZoom <= 0.75} onClick={() => onZoom(-0.1)} title="Alejar preview" aria-label="Alejar preview" className={styles.toolIconButton}><Minus size={13} /></button>
        <span className={styles.toolValue}>{Math.round(previewZoom * 100)}%</span>
        <button type="button" disabled={previewZoom >= 1.75} onClick={() => onZoom(0.1)} title="Acercar preview" aria-label="Acercar preview" className={styles.toolIconButton}><Plus size={13} /></button>
        <button type="button" onClick={onToggleFullscreen} title={previewFullscreen ? "Salir de pantalla completa" : "Abrir preview en pantalla completa"} aria-label={previewFullscreen ? "Salir de pantalla completa" : "Abrir preview en pantalla completa"} className={styles.toolIconButton}>{previewFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
      </div>
    </div>
    <div className={styles.previewUtilities}>
      <button type="button" onClick={onOpenShortcuts} className={styles.toolIconButton} title="Atajos de teclado (?)" aria-label="Abrir atajos de teclado" aria-keyshortcuts="?"><Keyboard size={15} /></button>
      <span role="status" data-state={saving ? "saving" : saveError ? "error" : "saved"} className={styles.saveStatus}>{saving ? "Guardando…" : saveError ? "Error" : "Guardado"}</span>
      <div className={styles.toolbarGroup} aria-label="Documento e inspector">
        <button type="button" onClick={onInspectorToggle} className={`${styles.toolIconButton} ${inspectorOpen ? styles.toolIconButtonActive : ""}`} title={inspectorOpen ? "Cerrar inspector" : "Abrir inspector"} aria-label={inspectorOpen ? "Cerrar inspector" : "Abrir inspector"}><PanelRight size={14} /></button>
        <div className={styles.historyWrap}>
          <button type="button" disabled={saving} onClick={onHistoryOpen} className={styles.toolIconButton} title="Historial de edición" aria-label="Abrir historial de edición"><History size={14} /></button>
          {history && <div className={styles.historyMenu} role="dialog" aria-label="Historial de edición"><div className={styles.historyMenuHeader}><span>Historial de edición</span><button type="button" aria-label="Cerrar historial" onClick={onCloseHistory}><X size={12} /></button></div>{history.map((entry, entryIndex) => <button key={`${entry.documentHash}-${entry.version}-${entryIndex}`} type="button" disabled={saving || entry.version === currentVersion} onClick={() => onRestoreHistory(entry)} className={styles.historyItem}><span><strong>Versión {entry.version}{entry.version === currentVersion ? " · actual" : ""}</strong><small>{new Date(entry.createdAt).toLocaleString()}</small></span>{entry.version !== currentVersion && <em>Restaurar</em>}</button>)}</div>}
        </div>
        <button type="button" onClick={onReload} className={styles.toolIconButton} title="Recargar composición" aria-label="Recargar composición"><RefreshCw size={14} /></button>
      </div>
      <div className={styles.toolbarActionGroup}>
        <button type="button" disabled={agentProposalActive} onClick={onOpenPresets} className={styles.toolButton} title="Aplicar o crear un preset dinámico"><Clapperboard size={13} /><span>Presets</span></button>
        <button type="button" onClick={onOpenAssistant} className={`${styles.toolButton} ${styles.assistantTool}`} title="Ajustar la composición con SofLIA"><Sparkles size={13} /><span>SofLIA</span></button>
        {onContinueToPublication && <button type="button" onClick={onContinueToPublication} className={`${styles.toolButton} ${styles.publishTool}`} title="Continuar a publicación"><span>Publicar</span><ArrowRight size={13} /></button>}
      </div>
    </div>
  </div>;
}

function PreviewToolButton({ active, children, label, onClick, title }: { active: boolean; children: ReactNode; label: string; onClick: () => void; title: string }) {
  return <button type="button" aria-pressed={active} onClick={onClick} title={title} className={`${styles.toolButton} ${active ? styles.toolButtonActive : ""}`}>{children}<span>{label}</span></button>;
}

function formatSeconds(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
