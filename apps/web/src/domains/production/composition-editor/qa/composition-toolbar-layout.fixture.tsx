import { useRef, useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { CompositionPreviewToolbar } from "@/domains/materials/components/composition-editor/CompositionPreviewToolbar";
import { useCompositionStudioControls } from "@/domains/materials/components/composition-editor/useCompositionStudioControls";
import styles from "@/domains/materials/components/composition-editor/CompositionStudio.module.css";

function Fixture() {
  const controls = useCompositionStudioControls();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const previewRef = useRef<HTMLElement>(null);
  const noop = () => {};
  const props: ComponentProps<typeof CompositionPreviewToolbar> = {
    canvas: { width: 1920, height: 1080 }, currentVersion: 2, duration: 249,
    agentProposalActive: false, comparisonActive: false, directEditingEnabled: true,
    gridVisible: false, history: historyOpen ? [] : null, inspectorOpen, libraryOpen: true,
    previewFullscreen: false, previewStatusLabel: null, previewZoom: 1,
    removalRangeStartSeconds: null, safeAreasVisible: false, saveError: null,
    saving: false, snapEnabled: true, trimToolEnabled: false, visualCropEnabled: false,
    canRedo: true, canUndo: true, redoLabel: null, undoLabel: null,
    toolMenuOpen: controls.toolMenuOpen, toolMenuRef: controls.toolMenuRef,
    onToggleToolMenu: () => controls.setToolMenuOpen((open) => !open),
    onInspectorToggle: () => setInspectorOpen((open) => !open),
    onHistoryOpen: () => setHistoryOpen(true), onCloseHistory: () => setHistoryOpen(false),
    onToggleFullscreen: () => { void previewRef.current?.requestFullscreen(); },
    onCanvasFormatChange: noop, onContinueToPublication: noop, onOpenLibrary: noop,
    onIntervalAction: noop, onOpenAssistant: noop, onOpenCommandPalette: noop,
    onOpenPresets: noop, onReload: noop, onRedo: noop, onRestoreHistory: noop,
    onSplit: noop, onToggleDirectEditing: noop, onToggleComparison: noop,
    onToggleGrid: noop, onToggleSafeAreas: noop, onToggleSnap: noop,
    onToggleTrim: noop, onToggleVisualCrop: noop, onUndo: noop, onZoom: noop,
  };
  return <div className={styles.studio} style={{ height: "100vh" }}>
    <div className={`${styles.editorGrid} ${inspectorOpen ? styles.editorGridWithInspector : ""}`}>
      <aside className={styles.library}>Biblioteca</aside>
      <section ref={previewRef} data-preview className={styles.previewPanel}>
        <CompositionPreviewToolbar {...props} />
        <div style={{ flex: 1, background: "#123" }}>Video</div>
      </section>
      {inspectorOpen && <aside className={styles.inspector}>Inspector</aside>}
    </div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
