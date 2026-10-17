import { COMPOSITION_DOCUMENT_FORMAT, DEFAULT_COMPOSITION_DUCKING_SETTINGS, compositionEditorDocumentSchema, type CompositionEditorDocument } from "../../composition-document.types";

export function createNarrativeDocumentFixture(): CompositionEditorDocument {
  return compositionEditorDocumentSchema.parse({
    format: COMPOSITION_DOCUMENT_FORMAT,
    deckStyles: null,
    audioMix: { ducking: { ...DEFAULT_COMPOSITION_DUCKING_SETTINGS, triggerRoles: [...DEFAULT_COMPOSITION_DUCKING_SETTINGS.triggerRoles] } },
    motion: { animations: [], schemaVersion: 2 },
    variables: { accent: "#123456", title: "Curso", subtitle: "" },
    canvas: { durationSeconds: 30, fps: 30, height: 1080, width: 1920 },
    clips: [{ id: "voice-1", hfId: "hf-voice-1", sceneId: "scene-1", trackId: "voice",
      kind: "AUDIO", label: "Voz", hidden: false, startSeconds: 10, durationSeconds: 2,
      sourceOffsetSeconds: 1, sourceDurationSeconds: 10, timingSource: "USER_EDITED",
      source: { type: "PRODUCTION_ASSET", productionAssetId: "11111111-1111-4111-8111-111111111111" },
      layout: { x: 0, y: 0, width: 1920, height: 1080, opacity: 1, rotation: 0, zIndex: 0 } }],
    tracks: [{ id: "voice", kind: "AUDIO", label: "Voz", locked: false, hidden: false, order: 0, semanticRole: "VOICE" }],
    narrativeScenes: [{ id: "scene-1", label: "Escena", order: 1, needsReview: false,
      scriptHash: "a".repeat(64), scriptText: "Guion diferente",
      wordTimestamps: [{ word: "antes", start: 0, end: 0.5 }, { word: "café", start: 0.8, end: 1.5 },
        { word: "listo", start: 1.5, end: 2.5 }, { word: "final", start: 2.5, end: 3.5 }] }],
  });
}
