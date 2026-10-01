import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CompositionStudioLibrary } from "@/domains/materials/components/composition-editor/CompositionStudioLibrary";
import type { CompositionStudioAsset } from "@/domains/materials/components/composition-editor/composition-studio.types";
import type { CompositionEditorDocument } from "../composition-document.types";
import { CompositionCommandHistory } from "../composition-command-history";
import { classifyCompositionPreviewOperations } from "../composition-preview-operation-policy";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import type { CompositionEditorPatchOperation } from "../editor-patch.types";

const ORIGINAL_ID = "11111111-1111-4111-8111-111111111111";
const REPLACEMENT_ID = "22222222-2222-4222-8222-222222222222";
const SHORT_ID = "33333333-3333-4333-8333-333333333333";
const AUDIO_ID = "44444444-4444-4444-8444-444444444444";

const assets: CompositionStudioAsset[] = [
  { id: ORIGINAL_ID, label: "Video original", mimeType: "video/mp4", durationSeconds: 8, hasAudio: false, isEditable: true, valid: true, previewUrl: null, sizeLabel: "8 s", sourceLabel: "Producción" },
  { id: REPLACEMENT_ID, label: "Video nuevo", mimeType: "video/mp4", durationSeconds: 8, hasAudio: false, isEditable: true, valid: true, previewUrl: null, sizeLabel: "8 s", sourceLabel: "Producción" },
  { id: SHORT_ID, label: "Video corto", mimeType: "video/mp4", durationSeconds: 3, hasAudio: false, isEditable: true, valid: true, previewUrl: null, sizeLabel: "3 s", sourceLabel: "Producción" },
  { id: AUDIO_ID, label: "Audio nuevo", mimeType: "audio/mpeg", durationSeconds: 8, isEditable: true, valid: true, previewUrl: null, sizeLabel: "8 s", sourceLabel: "Producción" },
];

const initialDocument: CompositionEditorDocument = {
  audioMix: { ducking: { attackSeconds: 0.05, duckedVolumeRatio: 0.25, enabled: false, releaseSeconds: 0.3, targetRole: "MUSIC", triggerRoles: ["VOICE"] } },
  canvas: { durationSeconds: 12, fps: 30, height: 1080, width: 1920 },
  clips: [{
    durationSeconds: 4,
    hfId: "asset-original",
    hidden: false,
    id: "asset-original",
    kind: "VIDEO",
    label: "Clip de prueba",
    layout: { height: 720, opacity: 0.8, rotation: 5, width: 1280, x: 120, y: 80, zIndex: 2 },
    mediaFit: "COVER",
    source: { productionAssetId: ORIGINAL_ID, type: "PRODUCTION_ASSET" },
    sourceDurationSeconds: 8,
    sourceOffsetSeconds: 1,
    startSeconds: 2,
    timingSource: "USER_EDITED",
    trackId: "visual",
  }],
  deckStyles: null,
  format: "courseforge-composition-v2",
  motion: { animations: [], schemaVersion: 2 },
  tracks: [{ id: "visual", kind: "VISUAL", label: "Visual", locked: false, order: 50, semanticRole: "VISUAL", volume: 1 }],
  variables: { accent: "#38bdf8", subtitle: "Smoke", title: "Reemplazo de medios" },
};

function Fixture() {
  const [document, setDocument] = useState(initialDocument);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [lastStrategy, setLastStrategy] = useState("none");
  const [lastSelectedHfId, setLastSelectedHfId] = useState("none");
  const [error, setError] = useState("");
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const history = useRef(new CompositionCommandHistory());
  const selectedClip = document.clips[0]!;
  const sourceId = selectedClip.source.type === "PRODUCTION_ASSET" ? selectedClip.source.productionAssetId : "none";

  function replaceAsset(asset: CompositionStudioAsset) {
    const operation: CompositionEditorPatchOperation = {
      clipId: selectedClip.id,
      mimeType: asset.mimeType,
      productionAssetId: asset.id,
      sourceDurationSeconds: asset.durationSeconds,
      type: "clip.replace-source",
    };
    try {
      const next = applyCompositionEditorPatches(document, [operation]);
      const strategy = classifyCompositionPreviewOperations([operation]);
      history.current.record({ afterDocument: next, beforeDocument: document, source: "USER", summary: "Reemplazó un medio." });
      setDocument(next);
      setLastStrategy(strategy);
      if (strategy === "FULL_RELOAD") setPreviewRevision((revision) => revision + 1);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Falló el reemplazo.");
    }
  }

  function restore(direction: "undo" | "redo") {
    const entry = direction === "undo" ? history.current.peekUndo() : history.current.peekRedo();
    if (!entry) return;
    setDocument(direction === "undo" ? entry.beforeDocument : entry.afterDocument);
    if (direction === "undo") history.current.commitUndo(entry.id);
    else history.current.commitRedo(entry.id);
    setPreviewRevision((revision) => revision + 1);
  }

  return <main>
    <output id="source-id">{sourceId}</output>
    <output id="timing-layout">{JSON.stringify({ durationSeconds: selectedClip.durationSeconds, layout: selectedClip.layout, sourceOffsetSeconds: selectedClip.sourceOffsetSeconds, startSeconds: selectedClip.startSeconds, trackId: selectedClip.trackId })}</output>
    <output id="preview-revision">{previewRevision}</output>
    <output id="preview-strategy">{lastStrategy}</output>
    <output id="last-selected-hf-id">{lastSelectedHfId}</output>
    <output id="replacement-error">{error}</output>
    <button id="undo-replacement" type="button" disabled={!history.current.snapshot().canUndo} onClick={() => restore("undo")}>Deshacer</button>
    <button id="redo-replacement" type="button" disabled={!history.current.snapshot().canRedo} onClick={() => restore("redo")}>Rehacer</button>
    <button id="simulate-missing-source" type="button" onClick={() => setSourceUnavailable(true)}>Simular fuente ausente</button>
    <CompositionStudioLibrary
      assets={assets}
      captionTranscriptWordCount={0}
      delivery={null}
      insertionMode="APPEND"
      introAssetId={null}
      lessons={[]}
      libraryOpen
      narrative={null}
      narrativeCount={0}
      onAddAsset={() => undefined}
      onAddCaptionLayer={() => undefined}
      onAddSoundEffect={() => undefined}
      onAddTextLayer={() => undefined}
      onClearIntro={() => undefined}
      onGenerateTranscriptCaptions={() => undefined}
      onInsertionModeChange={() => undefined}
      onReplaceAsset={replaceAsset}
      onSelectAsset={setLastSelectedHfId}
      onSelectLesson={() => undefined}
      onSetIntro={() => undefined}
      replacementTarget={selectedClip}
      replacementTargetUnavailable={sourceUnavailable}
      selectedHfId={selectedClip.hfId}
      selectedLessonId={null}
      timelineAssetHfIds={new Map([[sourceId, selectedClip.hfId]])}
    />
  </main>;
}

const root = document.getElementById("root");
if (!root) throw new Error("No se encontró el root del smoke de reemplazo de medios.");
createRoot(root).render(<Fixture />);
