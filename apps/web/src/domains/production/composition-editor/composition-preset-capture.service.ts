import type { CompositionEditorDocument } from "./composition-document.types";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";
import { applyCompositionEditorPatches } from "./editor-patch.service";
import { extractCompositionPresetDefinition } from "./composition-preset-extraction.service";

/** Manual y agente extraen el mismo contrato desde una copia validada. */
export async function captureCompositionPreset(params: {
  document: CompositionEditorDocument;
  propose?: () => Promise<CompositionEditorPatchOperation[]>;
}) {
  const source = params.propose
    ? applyCompositionEditorPatches(params.document, await params.propose(), "AGENT")
    : params.document;
  return extractCompositionPresetDefinition(source);
}
