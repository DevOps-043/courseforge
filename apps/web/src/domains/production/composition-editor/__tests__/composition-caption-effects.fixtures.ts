import { createTransitionDocument } from "./composition-transition-test-fixtures";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT, compositionEditorDocumentSchema } from "../composition-document.types";
import { DEFAULT_CAPTION_EFFECTS } from "../composition-caption-effects.types";

export function createCaptionEffectsFixture() {
  const document = createTransitionDocument();
  document.sourceInsertionMode = "MANUAL";
  document.clips = [];
  document.canvas.width = 640;
  document.canvas.height = 360;
  const { clip, track } = createCompositionNativeOverlay({ document, id: "captions", kind: "CAPTION", playheadSeconds: 1 });
  if (track) document.tracks.push(track);
  document.clips.push(clip);
  document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  clip.layout = { ...clip.layout, x: 30, y: 160, width: 580, height: 150 };
  if (clip.source.type !== "NATIVE_CAPTIONS") throw new Error("Expected caption");
  clip.source.style.fontFamily = "Arial";
  clip.source.style.fontSize = 32;
  clip.source.effects = { ...DEFAULT_CAPTION_EFFECTS, entry: "SLIDE_UP", exit: "FADE", karaoke: "COLOR", pulse: true };
  clip.source.cues = [
    { id: "first", text: "Hola, mundo 👋", startSeconds: 0, endSeconds: 2,
      emphasis: [{ start: 6, end: 11, color: "#00ff00", backgroundColor: "#000080" }],
      words: [{ id: "hola", text: "Hola", startSeconds: 0.2, endSeconds: 0.8 },
        { id: "mundo", text: "mundo", startSeconds: 0.8, endSeconds: 1.8 }] },
    { id: "second", text: "Después aprende", startSeconds: 2, endSeconds: 4, effects: { entry: "POP", karaoke: "NONE" },
      emphasis: [{ start: 0, end: 7, color: "#00ffff" }] },
  ];
  return compositionEditorDocumentSchema.parse(document);
}
