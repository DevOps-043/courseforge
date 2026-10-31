import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CompositionTimeline } from "@/domains/materials/components/composition-editor/CompositionTimeline";
import { CompositionSelectionPanel } from "@/domains/materials/components/composition-editor/CompositionSelectionPanel";
import type { CompositionEditorDocument } from "../composition-document.types";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { resolveCompositionGroupSelection } from "../composition-group-hierarchy";

const initial = (window as unknown as { nestedGroupsQaDocument: CompositionEditorDocument }).nestedGroupsQaDocument;
const noop = () => undefined;

function Fixture() {
  const [document, setDocument] = useState(initial);
  const [selectedClipIds, setSelectedClipIds] = useState(new Set<string>());
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [selectedHfId, setSelectedHfId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  return <main>
    <button id="enable" onClick={() => setEnabled(true)}>Habilitar capacidad de prueba</button>
    <output id="state">{JSON.stringify({ selected: [...selectedClipIds].sort(), selectedGroupId, editingGroupId, groups: document.groups })}</output>
    <CompositionTimeline document={document} assetLabels={{}} waveforms={{}} currentTime={0} editingGroupId={editingGroupId}
      onClearSelection={() => setSelectedHfId(null)} onDurationChange={noop} onAnimationSelect={noop} onAnimationTimingChange={noop}
      onEditingGroupChange={setEditingGroupId} onInspectSelection={noop} onMove={noop} onMoveGroup={noop} onRoll={noop} onSeek={noop}
      onSelect={setSelectedHfId} onSlide={noop} onSelectedClipIdsChange={setSelectedClipIds} onSelectedGroupChange={setSelectedGroupId}
      onTrackUpdate={noop} onTransitionSelect={noop} onTrim={noop} saving={false} selectedAnimationId={null} selectedClipIds={selectedClipIds}
      selectedGroupId={selectedGroupId} selectedHfId={selectedHfId} selectedTransitionId={null} />
    <CompositionSelectionPanel document={document} canPaste={false} canCreateNestedGroups={enabled} editingGroupId={editingGroupId}
      frameStep={1} keyboardEditMode="SLIDE" onAlign={noop} onClear={noop} onCopy={noop} onCreateGroup={() => {
        const selection = resolveCompositionGroupSelection(document, selectedClipIds, editingGroupId);
        if (selection) setDocument(applyCompositionEditorPatches(document, [{ ...selection, type: "group.create", groupId: "group-parent", label: "Principal" }]));
      }} onDelete={noop} onDistribute={noop} onDuplicate={noop} onEnterGroup={() => setEditingGroupId(selectedGroupId)} onExitGroup={() => setEditingGroupId(null)}
      onFrameStepChange={noop} onInspectClip={setSelectedHfId} onKeyboardEditModeChange={noop} onPaste={noop} onRippleDelete={noop} onRoll={noop} onSlide={noop}
      onUngroup={() => { if (selectedGroupId) { setDocument(applyCompositionEditorPatches(document, [{ type: "group.ungroup", groupId: selectedGroupId }])); setSelectedGroupId(null); } }}
      saving={false} selectedClipIds={selectedClipIds} selectedGroupId={selectedGroupId} />
  </main>;
}
createRoot(window.document.getElementById("root")!).render(<Fixture />);
