import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CompositionTimeline } from "@/domains/materials/components/composition-editor/CompositionTimeline";
import { CompositionSelectionPanel } from "@/domains/materials/components/composition-editor/CompositionSelectionPanel";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "../composition-document.types";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { resolveCompositionGroupSelection, toggleCompositionGroupSelection } from "../composition-group-hierarchy";

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
    <button id="reload" onClick={() => setDocument(compositionEditorDocumentSchema.parse(JSON.parse(JSON.stringify(document))))}>Recargar documento de prueba</button>
    <output id="state">{JSON.stringify({ selected: [...selectedClipIds].sort(), selectedGroupId, editingGroupId, groups: document.groups, starts: document.clips.map(clip => clip.startSeconds) })}</output>
    <CompositionTimeline document={document} assetLabels={{}} waveforms={{}} currentTime={0} editingGroupId={editingGroupId}
      onClearSelection={() => setSelectedHfId(null)} onDurationChange={noop} onAnimationSelect={noop} onAnimationTimingChange={noop}
      onEditingGroupChange={setEditingGroupId} onInspectSelection={noop} onMove={noop} onMoveGroup={(groupId, startSeconds) => setDocument(applyCompositionEditorPatches(document, [{ type: "group.move", groupId, startSeconds }]))} onRoll={noop} onSeek={noop}
      onSelect={setSelectedHfId} onSlide={noop} onSelectedClipIdsChange={setSelectedClipIds} onSelectedGroupChange={setSelectedGroupId}
      onTrackUpdate={noop} onTransitionSelect={noop} onTrim={noop} saving={false} selectedAnimationId={null} selectedClipIds={selectedClipIds}
      selectedGroupId={selectedGroupId} selectedHfId={selectedHfId} selectedTransitionId={null} />
    <CompositionSelectionPanel document={document} canPaste={false} canCreateNestedGroups={enabled} canNestTimeline={enabled} editingGroupId={editingGroupId}
      onToggleGroupSelection={groupId => {
        const next = toggleCompositionGroupSelection(document, selectedClipIds, groupId, editingGroupId);
        setSelectedClipIds(next); setSelectedGroupId(null);
        setSelectedHfId(document.clips.find(clip => next.has(clip.id))?.hfId ?? null);
      }}
      onNestSelection={() => {
        const selection = resolveCompositionGroupSelection(document, selectedClipIds, editingGroupId, "NESTED");
        if (!selection) return;
        const [groupId] = selection.childGroupIds;
        setDocument(applyCompositionEditorPatches(document, groupId && !selection.clipIds.length && selection.childGroupIds.length === 1
          ? [{ type: "group.nest", groupId }]
          : [{ ...selection, type: "group.create", groupId: "nested-parent", label: "Secuencia", timelineMode: "NESTED" }]));
      }}
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
