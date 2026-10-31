import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CompositionTimeline } from "../../../materials/components/composition-editor/CompositionTimeline";
import { TransitionControls } from "../../../materials/components/composition-editor/TransitionControls";
import type { CompositionEditorDocument } from "../composition-document.types";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import type { CompositionEditorPatchOperation } from "../editor-patch.types";
import type { AudioWaveformPreview } from "../../audio-processing/audio-processing.types";

const noop = () => {};
function Fixture() {
  const [document, setDocument] = useState((window as unknown as { audioEditingDocument: CompositionEditorDocument }).audioEditingDocument);
  const [seconds, setSeconds] = useState(1);
  const [selected, setSelected] = useState<string | null>(document.clips[0]!.hfId);
  const [transitionId, setTransitionId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState(new Set([document.clips[0]!.id]));
  const [error, setError] = useState("");
  const waveform: AudioWaveformPreview = { durationSeconds: 10, sampleRateHz: 100, bucketSizeSamples: 1,
    min: Array.from({ length: 1000 }, (_, index) => -Math.abs(Math.sin(index / 17)) * 0.8),
    max: Array.from({ length: 1000 }, (_, index) => Math.abs(Math.sin(index / 17)) * 0.8) };
  const waveforms = Object.fromEntries(document.clips.flatMap(clip => clip.source.type === "PRODUCTION_ASSET" ? [[clip.source.productionAssetId, waveform]] : []));
  const patch = (operations: CompositionEditorPatchOperation[]) => {
    try { setDocument(applyCompositionEditorPatches(document, operations)); setError(""); } catch (failure) { setError(String(failure)); }
  };
  return <>
    <h1>Edición visual de audio</h1>
    <CompositionTimeline document={document} currentTime={seconds} componentId={null} assetLabels={{}} waveforms={waveforms}
      editingGroupId={null} saving={false} selectedAnimationId={null} selectedClipIds={selectedIds} selectedGroupId={null}
      selectedHfId={selected} selectedTransitionId={transitionId} onAnimationSelect={noop} onAnimationTimingChange={noop}
      onClearSelection={() => setSelected(null)} onDurationChange={noop} onEditingGroupChange={noop} onInspectSelection={noop}
      onMove={noop} onMoveGroup={noop} onRoll={noop} onSeek={setSeconds} onSelect={setSelected} onSelectedClipIdsChange={setSelectedIds}
      onSelectedGroupChange={noop} onSlide={noop} onTrackUpdate={noop} onTransitionSelect={setTransitionId} onTrim={noop}
      onSplitAudio={() => {
        const clip = document.clips.find(candidate => candidate.hfId === selected);
        if (clip) patch([{ type: "clip.split", clipId: clip.id, atSeconds: seconds, newClipId: "split-right", newHfId: "split-right" }]);
      }} />
    <TransitionControls document={document} saving={false} selectedTransitionId={transitionId} onSelect={setTransitionId}
      onAdd={transition => patch([{ type: "transition.add", transition }])}
      onUpdate={(id, settings) => patch([{ type: "transition.update", transitionId: id, settings }])}
      onRemove={id => patch([{ type: "transition.remove", transitionId: id }])} />
    <output id="state">{JSON.stringify({ document, seconds, error })}</output>
  </>;
}
createRoot(window.document.getElementById("root")!).render(<Fixture />);
