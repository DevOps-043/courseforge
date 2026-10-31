import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CompositionLayerManager } from "../../../materials/components/composition-editor/CompositionLayerManager";
import { LayerDepthControls } from "../../../materials/components/composition-editor/LayerDepthControls";
import type { CompositionEditorDocument } from "../composition-document.types";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import type { CompositionEditorPatchOperation } from "../editor-patch.types";

function Fixture() {
  const [document, setDocument] = useState((window as unknown as { layersQaDocument: CompositionEditorDocument }).layersQaDocument);
  const onPatch = async (operations: CompositionEditorPatchOperation[]) => {
    setDocument(current => applyCompositionEditorPatches(current, operations));
    return true;
  };
  return <>
    <CompositionLayerManager document={document} disabled={false} onPatch={onPatch} />
    {document.clips[0] && <LayerDepthControls clip={document.clips[0]} extraLayerDepths={document.extraLayerDepths} disabled={false} onPatch={onPatch} />}
    <button id="occupy" onClick={() => void onPatch([{ type: "clip.layout", clipId: document.clips[0].id, layout: { zIndex: 12 } }])}>Ocupar capa 12</button>
    <button id="lock" onClick={() => void onPatch([{ type: "track.update", trackId: document.clips[0].trackId, settings: { locked: true } }])}>Bloquear</button>
    <output id="state">{JSON.stringify(document)}</output>
  </>;
}

createRoot(window.document.getElementById("root")!).render(<Fixture />);
