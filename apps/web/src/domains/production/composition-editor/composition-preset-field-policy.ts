import type { CompositionClip, CompositionEditorDocument } from "./composition-document.types";

type PresetFieldPolicy = "CAPTURED" | "TARGET_CONTENT" | "TARGET_SOURCE" | "TARGET_STRUCTURE";

// Agregar un campo al documento exige decidir explícitamente cómo lo trata un preset.
export const COMPOSITION_PRESET_CLIP_FIELD_POLICY = {
  volumeEnvelope: "TARGET_SOURCE", colorGrading: "CAPTURED", sceneId: "TARGET_STRUCTURE",
  crop: "CAPTURED", mask: "CAPTURED", durationSeconds: "CAPTURED",
  fadeInSeconds: "CAPTURED", fadeOutSeconds: "CAPTURED", hidden: "CAPTURED",
  hfId: "TARGET_STRUCTURE", id: "TARGET_STRUCTURE", kind: "TARGET_STRUCTURE",
  label: "TARGET_CONTENT", layout: "CAPTURED", mediaFit: "CAPTURED",
  source: "TARGET_CONTENT", sourceDurationSeconds: "TARGET_SOURCE",
  sourceOffsetSeconds: "TARGET_SOURCE", playbackRate: "TARGET_SOURCE",
  freezeTailSeconds: "TARGET_SOURCE", startSeconds: "CAPTURED",
  timingSource: "TARGET_STRUCTURE", trackId: "TARGET_STRUCTURE", volume: "CAPTURED",
} as const satisfies Record<keyof CompositionClip, PresetFieldPolicy>;

export const COMPOSITION_PRESET_DOCUMENT_FIELD_POLICY = {
  extraLayerDepths: "CAPTURED", sourceInsertionMode: "TARGET_STRUCTURE",
  excludedSources: "TARGET_STRUCTURE", narrativeScenes: "TARGET_STRUCTURE",
  audioMix: "CAPTURED", canvas: "TARGET_STRUCTURE", clips: "CAPTURED",
  deckStyles: "TARGET_CONTENT", format: "TARGET_STRUCTURE", groups: "TARGET_STRUCTURE",
  groupingVersion: "TARGET_STRUCTURE", htmlEditing: "TARGET_CONTENT", motion: "CAPTURED",
  transitions: "TARGET_STRUCTURE", tracks: "CAPTURED", variables: "TARGET_CONTENT",
} as const satisfies Record<keyof CompositionEditorDocument, PresetFieldPolicy>;
