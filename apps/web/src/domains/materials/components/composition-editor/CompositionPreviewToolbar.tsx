import { useRef, type ReactNode, type RefObject } from "react";
import { useCompositionPanelFocus } from "./useCompositionPanelFocus";
import { ArrowRight, ChevronDown, Clapperboard, Columns2, Command, Crop, Grid3X3, History, Magnet, Maximize2, Minimize2, Minus, MousePointer2, PanelLeftOpen, PanelRight, Plus, Redo2, RefreshCw, Scan, Scissors, SlidersHorizontal, Sparkles, SquareDashed, Trash2, Undo2, X } from "lucide-react";
import type { CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import { formatCompositionUiTimecode } from "@/domains/production/composition-editor/composition-ui-presentation";
import styles from "./CompositionStudio.module.css";

export type CompositionDocumentHistoryEntry = {
  createdAt: string;
  document: CompositionEditorDocument;
  documentHash: string;
  version: number;
};

interface CompositionPreviewToolbarProps {
  canvas: { width: number; height: number };
  onCanvasFormatChange: (format: "16:9" | "9:16" | "1:1") => void;
  agentProposalActive: boolean;
  currentVersion: number;
  comparisonActive: boolean;
  directEditingEnabled: boolean;
  duration: number;
  gridVisible: boolean;
  history: CompositionDocumentHistoryEntry[] | null;
  libraryOpen: boolean;
  inspectorOpen: boolean;
  onCloseHistory: () => void;
  onContinueToPublication?: () => void;
  onHistoryOpen: () => void;
  onOpenLibrary: () => void;
  onInspectorToggle: () => void;
  onIntervalAction: () => void;
  onOpenAssistant: () => void;
  onOpenCommandPalette: () => void;
  onOpenPresets: () => void;
  onReload: () => void;
  onRedo: () => void;
  onRestoreHistory: (entry: CompositionDocumentHistoryEntry) => void;
  onSplit: () => void;
  onToggleDirectEditing: () => void;
  onToggleComparison: () => void;
  onToggleGrid: () => void;
  onToggleSafeAreas: () => void;
  onToggleSnap: () => void;
  onToggleToolMenu: () => void;
  onToggleTrim: () => void;
  onToggleVisualCrop: () => void;
  onToggleFullscreen: () => void;
  onUndo: () => void;
  onZoom: (delta: number) => void;
  previewFullscreen: boolean;
  previewStatusLabel: string | null;
  previewZoom: number;
  removalRangeStartSeconds: number | null;
  safeAreasVisible: boolean;
  saveError: string | null;
  saving: boolean;
  snapEnabled: boolean;
  toolMenuOpen: boolean;
  toolMenuRef: RefObject<HTMLDivElement | null>;
  trimToolEnabled: boolean;
  visualCropEnabled: boolean;
  canRedo: boolean;
  canUndo: boolean;
  redoLabel: string | null;
  undoLabel: string | null;
}

export function CompositionPreviewToolbar({ canvas, onCanvasFormatChange, agentProposalActive, canRedo, canUndo, comparisonActive, currentVersion, directEditingEnabled, duration, gridVisible, history, inspectorOpen, libraryOpen, onCloseHistory, onContinueToPublication, onHistoryOpen, onInspectorToggle, onIntervalAction, onOpenAssistant, onOpenCommandPalette, onOpenLibrary, onOpenPresets, onRedo, onReload, onRestoreHistory, onSplit, onToggleComparison, onToggleDirectEditing, onToggleFullscreen, onToggleGrid, onToggleSafeAreas, onToggleSnap, onToggleToolMenu, onToggleTrim, onToggleVisualCrop, onUndo, onZoom, previewFullscreen, previewStatusLabel, previewZoom, redoLabel, removalRangeStartSeconds, safeAreasVisible, saveError, saving, snapEnabled, toolMenuOpen, toolMenuRef, trimToolEnabled, undoLabel, visualCropEnabled }: CompositionPreviewToolbarProps) {
  const toolsPanelRef = useRef<HTMLDivElement>(null);
  const historyPanelRef = useRef<HTMLDivElement>(null);
  useCompositionPanelFocus({ open: toolMenuOpen, panelRef: toolsPanelRef, kind: "MENU", onClose: onToggleToolMenu });
  useCompositionPanelFocus({ open: Boolean(history), panelRef: historyPanelRef, kind: "POPOVER", onClose: onCloseHistory });
  return <div className={styles.previewToolbar}>
    <div className={styles.previewIdentity}>
      <span className={styles.previewIdentityIcon}><Clapperboard size={14} aria-hidden="true" /></span>
      <span className={styles.previewTitle}>Ensamble <small>v{currentVersion} · {formatSeconds(duration)}</small>{previewStatusLabel ? <span className={styles.pendingBadge}>{previewStatusLabel}</span> : null}</span>
    </div>
    <div className={styles.previewTools}>
      <select aria-label="Formato del lienzo" disabled={saving || agentProposalActive}
        title="Cambia el lienzo y conserva posiciones y animaciones. Ajusta el encuadre después."
        value={canvas.width === canvas.height ? "1:1" : canvas.width > canvas.height ? "16:9" : "9:16"}
        onChange={(event) => onCanvasFormatChange(event.target.value as "16:9" | "9:16" | "1:1")}
        className="rounded border bg-transparent px-2 py-1 text-xs">
        <option value="16:9">Horizontal · 16:9</option><option value="9:16">Vertical · 9:16</option><option value="1:1">Cuadrado · 1:1</option>
      </select>
      <div className={styles.toolbarGroup} aria-label="Edición principal">
        <button type="button" disabled={saving || !canUndo} onClick={onUndo} title={undoLabel ? `Deshacer: ${undoLabel} (Ctrl+Z)` : "Nada que deshacer"} aria-label="Deshacer último cambio" className={styles.toolIconButton}><Undo2 size={13} /></button>
        <button type="button" disabled={saving || !canRedo} onClick={onRedo} title={redoLabel ? `Rehacer: ${redoLabel} (Ctrl+Mayús+Z)` : "Nada que rehacer"} aria-label="Rehacer último cambio" className={styles.toolIconButton}><Redo2 size={13} /></button>
        <PreviewToolButton active={directEditingEnabled} label="Editar" title="Activar selección, arrastre y tiradores" onClick={onToggleDirectEditing}><MousePointer2 size={13} /></PreviewToolButton>
        <PreviewToolButton active={snapEnabled} label="Snap" title="Alinear bordes y centros con el canvas, la rejilla y otros elementos visibles" onClick={onToggleSnap}><Magnet size={13} /></PreviewToolButton>
        <PreviewToolButton active={false} label="Dividir" title="Dividir el clip seleccionado en el cursor" onClick={onSplit}><Scissors size={13} /></PreviewToolButton>
      </div>
      <div ref={toolMenuRef} className={styles.toolMenuWrap}>
        <button type="button" aria-expanded={toolMenuOpen} aria-haspopup="menu" onClick={onToggleToolMenu} className={`${styles.toolButton} ${comparisonActive || gridVisible || safeAreasVisible || visualCropEnabled || trimToolEnabled || removalRangeStartSeconds !== null ? styles.toolButtonActive : ""}`} title="Abrir herramientas adicionales"><SlidersHorizontal size={13} /><span>Herramientas</span><ChevronDown className={toolMenuOpen ? styles.toolMenuChevronOpen : ""} size={12} /></button>
        {toolMenuOpen && <div ref={toolsPanelRef} className={`${styles.toolMenu} ${styles.keyboardPanel}`} role="menu" aria-label="Herramientas adicionales">
          <button type="button" role="menuitemcheckbox" aria-checked={comparisonActive} onClick={onToggleComparison} className={styles.toolMenuItem}><Columns2 size={14} /><span><strong>Comparar antes / después</strong><small>Revisar color y composición</small></span><i data-active={comparisonActive} /></button>
          <button type="button" role="menuitemcheckbox" aria-checked={gridVisible} onClick={onToggleGrid} className={styles.toolMenuItem}><Grid3X3 size={14} /><span><strong>Rejilla</strong><small>Guías visuales del canvas</small></span><i data-active={gridVisible} /></button>
          <button type="button" role="menuitemcheckbox" aria-checked={safeAreasVisible} onClick={onToggleSafeAreas} className={styles.toolMenuItem}><SquareDashed size={14} /><span><strong>Áreas seguras</strong><small>Título 80% · acción 90%</small></span><i data-active={safeAreasVisible} /></button>
          <button type="button" role="menuitemcheckbox" aria-checked={visualCropEnabled} onClick={onToggleVisualCrop} className={styles.toolMenuItem}><Scan size={14} /><span><strong>Recorte visual</strong><small>Ajustar bordes del medio</small></span><i data-active={visualCropEnabled} /></button>
          <button type="button" role="menuitemcheckbox" aria-checked={trimToolEnabled} onClick={onToggleTrim} className={styles.toolMenuItem}><Crop size={14} /><span><strong>Recorte temporal</strong><small>Modificar inicio y duración</small></span><i data-active={trimToolEnabled} /></button>
          <button type="button" role="menuitem" onClick={onIntervalAction} className={styles.toolMenuItem}><Trash2 size={14} /><span><strong>{removalRangeStartSeconds === null ? "Marcar intervalo" : "Eliminar intervalo"}</strong><small>{removalRangeStartSeconds === null ? "Define el inicio de un corte" : `Desde ${formatCompositionUiTimecode(removalRangeStartSeconds)} al cursor`}</small></span><i data-active={removalRangeStartSeconds !== null} /></button>
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
        <span role="status" data-state={saving ? "saving" : saveError ? "error" : "saved"} className={styles.saveStatus}>{saving ? "Guardando…" : saveError ? "Error" : "Guardado"}</span>
      <div className={styles.toolbarGroup} aria-label="Documento e inspector">
        <button type="button" onClick={onOpenCommandPalette} className={styles.toolIconButton} title="Comandos del editor (Ctrl/Cmd+K)" aria-label="Abrir paleta de comandos"><Command size={14} /></button>
        {!libraryOpen && <button type="button" onClick={onOpenLibrary} className={styles.toolIconButton} title="Abrir biblioteca y cerrar vista de referencia" aria-label="Abrir biblioteca"><PanelLeftOpen size={14} /></button>}
        <button type="button" onClick={onInspectorToggle} className={`${styles.toolIconButton} ${inspectorOpen ? styles.toolIconButtonActive : ""}`} title={inspectorOpen ? "Cerrar inspector" : "Abrir inspector"} aria-label={inspectorOpen ? "Cerrar inspector" : "Abrir inspector"}><PanelRight size={14} /></button>
        <div className={styles.historyWrap}>
          <button type="button" disabled={saving} onClick={onHistoryOpen} className={styles.toolIconButton} title="Historial de edición" aria-label="Abrir historial de edición"><History size={14} /></button>
          {history && <div ref={historyPanelRef} className={`${styles.historyMenu} ${styles.keyboardPanel}`} role="dialog" aria-label="Historial de edición"><div className={styles.historyMenuHeader}><span>Historial de edición</span><button type="button" aria-label="Cerrar historial" onClick={onCloseHistory}><X size={12} /></button></div>{history.map((entry, entryIndex) => <button key={`${entry.documentHash}-${entry.version}-${entryIndex}`} type="button" disabled={saving || entry.version === currentVersion} onClick={() => onRestoreHistory(entry)} className={styles.historyItem}><span><strong>Versión {entry.version}{entry.version === currentVersion ? " · actual" : ""}</strong><small>{new Date(entry.createdAt).toLocaleString()}</small></span>{entry.version !== currentVersion && <em>Restaurar</em>}</button>)}</div>}
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
  return formatCompositionUiTimecode(Math.max(0, Math.floor(value)));
}
