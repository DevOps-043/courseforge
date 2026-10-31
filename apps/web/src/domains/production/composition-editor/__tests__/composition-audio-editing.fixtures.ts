import { createTransitionDocument, createTransition } from "./composition-transition-test-fixtures";
import { compositionEditorDocumentSchema } from "../composition-document.types";

export function createAudioEditingFixture() {
  const document = createTransitionDocument();
  document.tracks = [{ id: "voice", kind: "AUDIO", order: 0, locked: false, semanticRole: "VOICE", label: "Narración", volume: 1 }];
  for (const clip of document.clips) { clip.kind = "AUDIO"; clip.trackId = "voice"; }
  document.audioMix.ducking.enabled = false;
  return compositionEditorDocumentSchema.parse(document);
}
export { createTransition as createAudioTransition };
