import { useId, useRef, useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { CompositionPreviewToolbar } from "@/domains/materials/components/composition-editor/CompositionPreviewToolbar";
import { useCompositionStudioControls } from "@/domains/materials/components/composition-editor/useCompositionStudioControls";
import styles from "@/domains/materials/components/composition-editor/CompositionStudio.module.css";
import { CompositionReferenceGuidesPanel } from "@/domains/materials/components/composition-editor/CompositionReferenceGuidesPanel";
import { useCompositionReferenceGuides } from "@/domains/materials/components/composition-editor/useCompositionReferenceGuides";
import { CompositionDeliveryPanel } from "@/domains/materials/components/composition-editor/CompositionDeliveryPanel";

function Fixture() {
  const controls = useCompositionStudioControls();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deliveryHistoryOpen, setDeliveryHistoryOpen] = useState(false);
  const [referenceGuidesOpen, setReferenceGuidesOpen] = useState(false);
  const referenceGuidesPanelId = useId();
  const { state: referenceGuides, setState: setReferenceGuides, storageError } = useCompositionReferenceGuides("toolbar-qa");
  const previewRef = useRef<HTMLElement>(null);
  const noop = () => {};
  const props: ComponentProps<typeof CompositionPreviewToolbar> = {
    monitorExpanded: controls.monitorExpanded, onToggleMonitorExpanded: controls.toggleMonitorExpanded,
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
    onToggleReferenceGuides: () => setReferenceGuidesOpen(open => !open), referenceGuidesOpen, referenceGuidesPanelId,
    onOpenPresets: noop, onReload: noop, onRedo: noop, onRestoreHistory: noop,
    onSplit: noop, onToggleDirectEditing: noop, onToggleComparison: noop,
    onToggleGrid: noop, onToggleSafeAreas: noop, onToggleSnap: noop,
    onToggleTrim: noop, onToggleVisualCrop: noop, onUndo: noop, onZoom: noop,
  };
  return <div className={styles.studio} style={{ height: "100vh" }}>
    <div className={`${styles.editorGrid} ${inspectorOpen ? styles.editorGridWithInspector : ""}`}>
      <aside className={styles.library}>
        <div className={styles.libraryBody}>
          <CompositionDeliveryPanel
            assembly={null} busy={false} compact diagnostics={null} durationSeconds={10} error={null}
            history={Array.from({ length: 30 }, (_, index) => ({
              id: String(index), documentHash: "a".repeat(64), documentVersion: index + 1, revisionNumber: index + 1,
              createdAt: "2026-01-01T00:00:00Z", isActive: false, isCurrentDocument: false,
              projectArchiveSizeBytes: 1024, renderProfile: null, renderProfileId: null,
            }))}
            historyOpen={deliveryHistoryOpen} importStatus="NONE" notice={null}
            onApprove={noop} onDeleteAndRender={noop} onHistoryToggle={() => setDeliveryHistoryOpen((open) => !open)}
            onPrepare={noop} onProfileChange={noop} onRender={noop} onRestore={noop}
            priorCompletedVideo={false} providerStatus={null} renderStatus="idle" selectedRenderProfileId="balanced"
          />
        </div>
      </aside>
      <section ref={previewRef} data-preview className={styles.previewPanel}>
        <CompositionPreviewToolbar {...props} />
        {referenceGuidesOpen && <CompositionReferenceGuidesPanel panelId={referenceGuidesPanelId} state={referenceGuides} canvas={props.canvas}
          onChange={setReferenceGuides} onClose={() => setReferenceGuidesOpen(false)} storageError={storageError} />}
        <div style={{ flex: 1, background: "#123" }}>Video</div>
      </section>
      {inspectorOpen && <aside className={styles.inspector}>Inspector</aside>}
    </div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
