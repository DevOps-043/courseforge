import { compositionClipSchema, compositionEditorDocumentSchema } from "../composition-document.types";
import { compositionDynamicPresetDefinitionSchema } from "../composition-preset.types";
import { COMPOSITION_PRESET_CLIP_FIELD_POLICY, COMPOSITION_PRESET_DOCUMENT_FIELD_POLICY } from "../composition-preset-field-policy";
import { captureCompositionPreset } from "../composition-preset-capture.service";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { DEFAULT_CAPTION_EFFECTS } from "../composition-caption-effects.types";
import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { applyCompositionPresetDefinition, CompositionPresetApplicationError } from "../composition-preset-application.service";
import { findBuiltInCompositionPreset } from "../composition-preset-builtins";
import { extractCompositionPresetDefinition } from "../composition-preset-extraction.service";
import { parseRecoverableCompositionPresetApplication } from "../composition-preset-store.service";

test("extracts a manual sequence and adapts five authored items to fifteen assets", () => {
  const authored = createDocument(5, 50);
  authored.clips.forEach((clip, index) => {
    clip.startSeconds = index * 10;
    clip.durationSeconds = 10;
    clip.layout.x = index * 20;
  });
  const { definition, diagnostics } = extractCompositionPresetDefinition(authored);
  const brollRule = definition.rules.find((rule) => rule.selector.semanticRole === "BROLL")!;

  assert.equal(diagnostics.length, 0);
  assert.equal(brollRule.timing.mode, "SEQUENCE");
  assert.equal(brollRule.variants.length, 5);

  const target = createDocument(15, 90);
  const originalAssetIds = target.clips.map(readAssetId);
  const applied = applyCompositionPresetDefinition({ definition, document: target });
  const clips = applied.document.clips.sort((left, right) => left.startSeconds - right.startSeconds);

  assert.equal(applied.affectedClipCount, 15);
  assert.equal(clips[0]?.startSeconds, 0);
  assert.equal(clips.at(-1)!.startSeconds + clips.at(-1)!.durationSeconds, 90);
  assert.deepEqual(clips.map(readAssetId).sort(), originalAssetIds.sort(), "preset application must not replace source assets");
  assert.equal(clips[0]?.layout.x, clips[5]?.layout.x, "layout variants should repeat for additional assets");
});

test("SEQUENCE y STACK ajustan el último frame a un canvas fraccionario", () => {
  const target = createDocument(2, 10);
  target.canvas.durationSeconds = 10.02;
  target.canvas.fps = 30;

  for (const mode of ["SEQUENCE", "STACK"] as const) {
    const authored = createDocument(2, 10);
    authored.clips.forEach((clip, index) => {
      clip.startSeconds = mode === "STACK" ? 0 : index * 5;
      clip.durationSeconds = mode === "STACK" ? 10 : 5;
    });
    const { definition } = extractCompositionPresetDefinition(authored);
    assert.equal(definition.rules[0]?.timing.mode, mode);

    const { document } = applyCompositionPresetDefinition({ definition, document: target });
    assert.equal(document.canvas.durationSeconds, 10.02);
    assert.deepEqual(
      document.clips.map((clip) => [clip.startSeconds, clip.durationSeconds]),
      mode === "STACK" ? [[0, 10], [0, 10]] : [[0, 5], [5, 5]],
    );
  }
});

test("STACK permite que varios clips compartan el único frame disponible", () => {
  const authored = createDocument(2, 10);
  authored.clips.forEach((clip) => {
    clip.startSeconds = 9.96;
    clip.durationSeconds = 0.04;
  });
  const { definition } = extractCompositionPresetDefinition(authored);
  assert.equal(definition.rules[0]?.timing.mode, "STACK");

  const target = createDocument(2, 10);
  target.canvas.fps = 30;
  const { document } = applyCompositionPresetDefinition({ definition, document: target });
  assert.deepEqual(
    document.clips.map((clip) => [clip.startSeconds, clip.durationSeconds]),
    [[299 / 30, 1 / 30], [299 / 30, 1 / 30]],
  );
});

test("keeps locked tracks unchanged and reports that no editable element was found", () => {
  const document = createDocument(2, 10);
  const track = document.tracks.find((candidate) => candidate.semanticRole === "BROLL")!;
  track.locked = true;
  const { definition } = extractCompositionPresetDefinition(document);

  assert.throws(
    () => applyCompositionPresetDefinition({ definition, document }),
    (error: unknown) => error instanceof CompositionPresetApplicationError && error.code === "COMPOSITION_PRESET_NO_EFFECT",
  );
});

test("built-in presets fail closed when a required role is unavailable", () => {
  const document = createDocument(2, 10);
  const preset = findBuiltInCompositionPreset("system-presenter-corner")!;

  assert.throws(
    () => applyCompositionPresetDefinition({ definition: preset.definition, document }),
    (error: unknown) => error instanceof CompositionPresetApplicationError
      && error.code === "COMPOSITION_PRESET_REQUIRED_SLOT_EMPTY",
  );
});

test("all system presets apply with valid layers and their intended role hierarchy", () => {
  for (const preset of [
    findBuiltInCompositionPreset("system-presenter-corner")!,
    findBuiltInCompositionPreset("system-presenter-focus")!,
    findBuiltInCompositionPreset("system-visual-story")!,
  ]) {
    const applied = applyCompositionPresetDefinition({ definition: preset.definition, document: createSystemPresetDocument() });
    assert.ok(applied.document.clips.every((clip) => clip.layout.zIndex >= 0 && clip.layout.zIndex <= 10), `${preset.name} debe respetar el rango de capas.`);
    assert.equal(applied.warnings.some((warning) => warning.code === "VISUAL_LAYER_OBSCURED"), false, `${preset.name} controla sus propios B-rolls.`);
  }

  const corner = applyCompositionPresetDefinition({ definition: findBuiltInCompositionPreset("system-presenter-corner")!.definition, document: createSystemPresetDocument() }).document;
  assert.ok(layerOf(corner, "avatar") > layerOf(corner, "broll"));
  assert.ok(layerOf(corner, "broll") > layerOf(corner, "deck"));

  const focus = applyCompositionPresetDefinition({ definition: findBuiltInCompositionPreset("system-presenter-focus")!.definition, document: createSystemPresetDocument() }).document;
  assert.ok(layerOf(focus, "deck") > layerOf(focus, "broll"));
  assert.ok(layerOf(focus, "broll") > layerOf(focus, "avatar"));

  const visualStory = applyCompositionPresetDefinition({ definition: findBuiltInCompositionPreset("system-visual-story")!.definition, document: createSystemPresetDocument() }).document;
  assert.ok(layerOf(visualStory, "broll") > layerOf(visualStory, "deck"));
  assert.ok(layerOf(visualStory, "visual") > layerOf(visualStory, "deck"));
  assert.ok(layerOf(visualStory, "visual") > layerOf(visualStory, "broll"));
});

test("preserves an audio timing when a preset would exceed its trimmed source", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{
      checksum: "7".repeat(64), durationSeconds: 5, fileSizeBytes: 1_024,
      label: "Narración recortada", mimeType: "audio/mpeg",
      productionAssetId: "00000000-0000-4000-8000-000000000777",
      publicUrl: null, storageBucket: "production-assets", storagePath: "voice/trimmed.mp3", timelineRole: "VOICE",
    }],
    plan: { accentColor: "#00D4B3", durationSeconds: 10, subtitle: "Prueba", title: "Audio válido" },
  });
  document.canvas.durationSeconds = 10;
  const audio = document.clips.find((clip) => clip.kind === "AUDIO")!;
  audio.sourceOffsetSeconds = 2;
  audio.durationSeconds = 3;
  const { definition } = extractCompositionPresetDefinition(document);
  const voiceRule = definition.rules.find((rule) => rule.selector.semanticRole === "VOICE")!;
  voiceRule.timing = { endRatio: 1, mode: "STACK", startRatio: 0 };

  const applied = applyCompositionPresetDefinition({ definition, document });
  const result = applied.document.clips.find((clip) => clip.id === audio.id)!;

  assert.equal(result.startSeconds, audio.startSeconds);
  assert.equal(result.durationSeconds, 3);
  assert.deepEqual(applied.warnings, [{
    code: "AUDIO_TIMING_PRESERVED",
    message: "Se conservó el timing de Narración recortada: el preset excedía la duración disponible de su audio.",
    ruleId: voiceRule.id,
  }]);
});

test("warns before an unchanged B-roll layer covers an avatar adjusted by a preset", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [
      {
        checksum: "8".repeat(64), durationSeconds: 10, fileSizeBytes: 1_024,
        label: "Avatar", mimeType: "video/mp4",
        productionAssetId: "00000000-0000-4000-8000-000000000888",
        publicUrl: null, storageBucket: "production-assets", storagePath: "avatars/presenter.mp4", timelineRole: "AVATAR",
      },
      {
        checksum: "9".repeat(64), durationSeconds: 10, fileSizeBytes: 1_024,
        label: "B-roll de fondo", mimeType: "video/mp4",
        productionAssetId: "00000000-0000-4000-8000-000000000999",
        publicUrl: null, storageBucket: "production-assets", storagePath: "broll/background.mp4", timelineRole: "BROLL",
      },
    ],
    plan: { accentColor: "#00D4B3", durationSeconds: 10, subtitle: "Prueba", title: "Capas" },
  });
  const avatar = document.clips.find((clip) => clip.trackId === "avatar")!;
  const broll = document.clips.find((clip) => clip.trackId === "broll")!;
  avatar.layout.zIndex = 2;
  broll.layout = { height: 1080, opacity: 1, rotation: 0, width: 1920, x: 0, y: 0, zIndex: 5 };
  const { definition } = extractCompositionPresetDefinition(document);
  definition.rules = definition.rules.filter((rule) => rule.selector.semanticRole === "AVATAR");

  const applied = applyCompositionPresetDefinition({ definition, document });

  assert.deepEqual(applied.warnings, [{
    code: "VISUAL_LAYER_OBSCURED",
    message: "El B-roll B-roll de fondo puede cubrir Avatar entre 00:00 y 00:10.",
    ruleId: definition.rules[0]!.id,
  }]);
});

test("extraction stores no asset ids, labels, URLs, HTML or course copy", () => {
  const document = createDocument(2, 10);
  const { definition } = extractCompositionPresetDefinition(document);
  const serialized = JSON.stringify(definition);

  assert.doesNotMatch(serialized, /Sensitive course title|Private subtitle|B-roll 1|00000000-0000-4000/i);
});

test("recovers undo only when the applied preset produced the current document", () => {
  const currentDocumentHash = "a".repeat(64);
  const row = {
    id: "00000000-0000-4000-8000-000000000123",
    proposed_document_hash: currentDocumentHash,
    status: "APPLIED",
    summary: { affectedClipCount: 4, presetName: "Academia dinámica" },
  };

  assert.deepEqual(parseRecoverableCompositionPresetApplication(row, currentDocumentHash), {
    applicationId: row.id,
    name: "Academia dinámica",
  });
  assert.equal(parseRecoverableCompositionPresetApplication(row, "b".repeat(64)), null);
});

test("fails closed when a recoverable preset application is malformed or no longer applied", () => {
  const currentDocumentHash = "c".repeat(64);
  const baseRow = {
    id: "00000000-0000-4000-8000-000000000456",
    proposed_document_hash: currentDocumentHash,
    status: "APPLIED",
    summary: { presetName: "Presentador discreto" },
  };

  assert.equal(parseRecoverableCompositionPresetApplication({ ...baseRow, status: "UNDONE" }, currentDocumentHash), null);
  assert.equal(parseRecoverableCompositionPresetApplication({ ...baseRow, summary: {} }, currentDocumentHash), null);
  assert.equal(parseRecoverableCompositionPresetApplication({ ...baseRow, id: "not-a-uuid" }, currentDocumentHash), null);
});

function createDocument(assetCount: number, durationSeconds: number) {
  return createInitialCompositionDocument({
    animatedDeck: null,
    assets: Array.from({ length: assetCount }, (_, index) => ({
      checksum: String((index % 9) + 1).repeat(64),
      durationSeconds: durationSeconds / assetCount,
      fileSizeBytes: 1_024,
      label: `B-roll ${index + 1}`,
      mimeType: "video/mp4",
      productionAssetId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: `broll/${index + 1}.mp4`,
      timelineRole: "BROLL" as const,
    })),
    plan: {
      accentColor: "#00D4B3",
      durationSeconds,
      subtitle: "Private subtitle",
      title: "Sensitive course title",
    },
  });
}

function readAssetId(clip: ReturnType<typeof createDocument>["clips"][number]) {
  if (clip.source.type !== "PRODUCTION_ASSET") throw new Error("Expected production asset.");
  return clip.source.productionAssetId;
}

function createSystemPresetDocument() {
  return createInitialCompositionDocument({
    animatedDeck: {
      css: ".slide { color: white; }",
      fonts: [],
      height: 1080,
      slides: [{ animationCount: 0, classes: "slide", html: "<section>Slide</section>", index: 0, label: "Slide" }],
      width: 1920,
    },
    assets: [
      { checksum: "2".repeat(64), durationSeconds: 10, fileSizeBytes: 1_024, label: "Presentador", mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000222", publicUrl: null, storageBucket: "production-assets", storagePath: "avatars/presenter.mp4", timelineRole: "AVATAR" },
      { checksum: "3".repeat(64), durationSeconds: 10, fileSizeBytes: 1_024, label: "Apoyo visual", mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000333", publicUrl: null, storageBucket: "production-assets", storagePath: "broll/support.mp4", timelineRole: "BROLL" },
      { checksum: "4".repeat(64), durationSeconds: 10, fileSizeBytes: 1_024, label: "Gráfico", mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000444", publicUrl: null, storageBucket: "production-assets", storagePath: "visual/chart.mp4", timelineRole: "VISUAL" },
    ],
    plan: { accentColor: "#00D4B3", durationSeconds: 10, subtitle: "Prueba", title: "Preset del sistema" },
  });
}

function layerOf(document: ReturnType<typeof createSystemPresetDocument>, trackId: string) {
  return document.clips.find((clip) => clip.trackId === trackId)?.layout.zIndex ?? -1;
}

test("V2 captura videos largos, capas adicionales, color, fades y mezcla completa", () => {
  const authored = createDocument(1, 180);
  const clip = authored.clips[0]!;
  authored.extraLayerDepths = [150];
  clip.layout.zIndex = 150;
  clip.colorGrading = { adjust: { contrast: 0.2, exposure: -0.4, saturation: 0.3 } };
  clip.fadeInSeconds = 9;
  clip.fadeOutSeconds = 18;
  clip.volume = 0.45;
  clip.mask = { shape: "ROUNDED_RECT", radiusPercent: 22 };
  clip.mediaFit = "CONTAIN";
  authored.audioMix.masterVolume = 0.6;
  authored.audioMix.ducking.triggerRoles = ["VOICE"];
  const { definition } = extractCompositionPresetDefinition(compositionEditorDocumentSchema.parse(authored));
  assert.equal(definition.schemaVersion, 2);
  assert.equal(definition.rules[0]!.variants[0]!.durationWeight, 180);
  const target = createDocument(1, 90);
  const originalSource = structuredClone(target.clips[0]!.source);
  const applied = applyCompositionPresetDefinition({ definition, document: target }).document;
  const restored = applied.clips[0]!;
  assert.deepEqual(restored.source, originalSource);
  assert.deepEqual(restored.colorGrading, clip.colorGrading);
  assert.deepEqual(restored.mask, clip.mask);
  assert.equal(restored.mediaFit, "CONTAIN");
  assert.equal(restored.layout.zIndex, 150);
  assert.deepEqual(applied.extraLayerDepths, [150]);
  assert.equal(restored.fadeInSeconds, 4.5);
  assert.equal(restored.fadeOutSeconds, 9);
  assert.equal(restored.volume, 0.45);
  assert.equal(applied.audioMix.masterVolume, 0.6);
  assert.deepEqual(applied.audioMix.ducking.triggerRoles, ["VOICE"]);
});

test("la captura neutra elimina color y fades previos sin arrastrar ajustes del destino", () => {
  const source = createDocument(1, 10);
  delete source.clips[0]!.volume;
  delete source.clips[0]!.mediaFit;
  const { definition } = extractCompositionPresetDefinition(source);
  const target = createDocument(1, 10);
  target.clips[0]!.colorGrading = { adjust: { contrast: 1, exposure: 1, saturation: 1 } };
  target.clips[0]!.fadeInSeconds = 1;
  target.clips[0]!.fadeOutSeconds = 1;
  target.clips[0]!.volume = 0.1;
  target.clips[0]!.mediaFit = "CONTAIN";
  target.audioMix.masterVolume = 0.2;
  const applied = applyCompositionPresetDefinition({ definition, document: target }).document;
  assert.equal(applied.clips[0]!.colorGrading, undefined);
  assert.equal(applied.clips[0]!.fadeInSeconds, 0);
  assert.equal(applied.clips[0]!.fadeOutSeconds, 0);
  assert.equal(applied.clips[0]!.volume, 1);
  assert.equal(applied.clips[0]!.mediaFit, "COVER");
  assert.equal(applied.audioMix.masterVolume, 1);
});

test("conserva más de 24 variantes sin truncarlas", () => {
  const source = createDocument(30, 150);
  source.clips.forEach((clip, index) => { clip.layout.x = index * 3; });
  const { definition } = extractCompositionPresetDefinition(source);
  assert.equal(definition.rules[0]!.variants.length, 30);
  const applied = applyCompositionPresetDefinition({ definition, document: createDocument(30, 150) }).document;
  assert.deepEqual(applied.clips.map(clip => clip.layout.x), source.clips.map(clip => clip.layout.x));
});

test("separa pistas del mismo rol y tipos distintos sin cruzar configuraciones", () => {
  const source = createDocument(3, 30);
  const broll = source.tracks.find(track => track.semanticRole === "BROLL")!;
  source.tracks.push({ ...broll, id: "second-broll", order: 20, volume: 0.2 });
  source.clips[1]!.trackId = "second-broll";
  source.clips[0]!.layout.x = 11;
  source.clips[1]!.layout.x = 77;
  source.clips[2]!.kind = "IMAGE";
  source.clips[2]!.layout.x = 33;
  const { definition } = extractCompositionPresetDefinition(source);
  assert.equal(definition.rules.length, 3);
  const target = structuredClone(source);
  target.clips.forEach(clip => { clip.layout.x = 0; });
  target.tracks.find(track => track.id === "second-broll")!.volume = 1;
  const applied = applyCompositionPresetDefinition({ definition, document: target }).document;
  assert.deepEqual(applied.clips.map(clip => clip.layout.x), [11, 77, 33]);
  assert.equal(applied.tracks.find(track => track.id === "second-broll")!.volume, 0.2);
});

test("restaura ventanas irregulares y conserva timing ante distinta cardinalidad con aviso", () => {
  const source = createDocument(2, 20);
  source.clips[0]!.startSeconds = 1;
  source.clips[0]!.durationSeconds = 3;
  source.clips[1]!.startSeconds = 4.04;
  source.clips[1]!.durationSeconds = 2;
  const { definition } = extractCompositionPresetDefinition(source);
  assert.equal(definition.rules[0]!.timing.mode, "PATTERN");
  const restored = applyCompositionPresetDefinition({ definition, document: createDocument(2, 20) }).document;
  assert.deepEqual(restored.clips.map(clip => [clip.startSeconds, clip.durationSeconds]), [[1, 3], [4.04, 2]]);
  const target = createDocument(3, 20);
  const applied = applyCompositionPresetDefinition({ definition, document: target });
  assert.deepEqual(applied.document.clips.map(clip => [clip.startSeconds, clip.durationSeconds]), target.clips.map(clip => [clip.startSeconds, clip.durationSeconds]));
  assert.equal(applied.warnings.some(warning => warning.code === "PATTERN_TIMING_PRESERVED"), true);
});

test("captura motion personalizado con ancla final, keyframes y desplazamiento proporcional", () => {
  const source = createDocument(1, 10);
  source.motion.animations = [{ id: "movimiento-privado", origin: "USER", propertyGroup: "POSITION",
    target: { clipId: source.clips[0]!.id, part: "CONTENT" },
    timing: { anchor: "CLIP_END", durationSeconds: 2, offsetSeconds: 1 },
    keyframes: [{ offset: 0, values: { x: 0, y: 0 } }, { offset: 1, ease: "power2.out", values: { x: 192, y: 108 } }],
  }];
  const { definition, diagnostics } = extractCompositionPresetDefinition(compositionEditorDocumentSchema.parse(source));
  assert.equal(diagnostics.length, 0);
  assert.doesNotMatch(JSON.stringify(definition), /movimiento-privado/);
  const target = createDocument(1, 20);
  target.canvas.width = 960;
  target.canvas.height = 540;
  const applied = applyCompositionPresetDefinition({ definition, document: target }).document;
  assert.equal(applied.motion.animations.length, 1);
  assert.deepEqual(applied.motion.animations[0]!.timing, { anchor: "CLIP_END", durationSeconds: 4, offsetSeconds: 2 });
  assert.deepEqual(applied.motion.animations[0]!.keyframes[1]!.values, { x: 96, y: 54 });
  assert.equal(applied.motion.animations[0]!.keyframes[1]!.ease, "power2.out");
});

test("manual y agente comparten captura completa sin modificar la edición fuente", async () => {
  const document = createDocument(1, 120);
  if (document.clips[0]!.source.type !== "PRODUCTION_ASSET") throw new Error("Medio requerido");
  document.clips[0]!.source.hasAudio = true;
  document.clips[0]!.colorGrading = { adjust: { contrast: 0.1, exposure: 0.2, saturation: 0.3 } };
  const before = structuredClone(document);
  const manual = await captureCompositionPreset({ document });
  const agent = await captureCompositionPreset({ document, propose: async () => [{ type: "clip.volume", clipId: document.clips[0]!.id, volume: 0.3 }] });
  assert.equal(manual.definition.schemaVersion, 2);
  assert.equal(agent.definition.schemaVersion, 2);
  assert.deepEqual(agent.definition.rules[0]!.variants[0]!.colorGrading, document.clips[0]!.colorGrading);
  assert.equal(agent.definition.rules[0]!.variants[0]!.volume, 0.3);
  assert.deepEqual(document, before);
});

test("captura estilo de texto y captions sin copiar palabras, cues ni referencias privadas", () => {
  const source = documentWithNativeLayers();
  const text = source.clips.find(clip => clip.kind === "TEXT")!;
  const captions = source.clips.find(clip => clip.kind === "CAPTION")!;
  if (text.source.type !== "NATIVE_TEXT" || captions.source.type !== "NATIVE_CAPTIONS") throw new Error("Capas nativas requeridas");
  text.source.text = "Texto privado del curso origen";
  text.source.style.fontSize = 100;
  text.source.style.fontAssetId = "11111111-1111-4111-8111-111111111111";
  captions.source.cues[0]!.text = "Frase privada origen";
  captions.source.effects = { ...DEFAULT_CAPTION_EFFECTS, karaoke: "COLOR" };
  const { definition, diagnostics } = extractCompositionPresetDefinition(source);
  assert.doesNotMatch(JSON.stringify(definition), /Texto privado|Frase privada|11111111/);
  assert.equal(diagnostics.some(diagnostic => diagnostic.code === "CONTENT_STYLING_PRESERVED"), true);
  const target = documentWithNativeLayers();
  const targetText = target.clips.find(clip => clip.kind === "TEXT")!;
  if (targetText.source.type !== "NATIVE_TEXT") throw new Error("Texto requerido");
  targetText.source.text = "Texto del destino";
  targetText.source.style.fontFamily = "Fuente Destino";
  const applied = applyCompositionPresetDefinition({ definition, document: target }).document;
  const restoredText = applied.clips.find(clip => clip.kind === "TEXT")!.source;
  const restoredCaptions = applied.clips.find(clip => clip.kind === "CAPTION")!.source;
  if (restoredText.type !== "NATIVE_TEXT" || restoredCaptions.type !== "NATIVE_CAPTIONS") throw new Error("Fuentes requeridas");
  assert.equal(restoredText.text, "Texto del destino");
  assert.equal(restoredText.style.fontSize, 100);
  assert.equal(restoredText.style.fontFamily, "Fuente Destino");
  assert.deepEqual(restoredCaptions.cues, captionsOf(target));
  assert.equal(restoredCaptions.effects?.karaoke, "COLOR");
});

test("conserva recortes y envolventes de la fuente destino y muestra sus límites al capturar", () => {
  const source = createDocument(1, 10);
  source.clips[0]!.sourceOffsetSeconds = 1;
  source.clips[0]!.volumeEnvelope = [{ sourceTimeSeconds: 0, gain: 0.2 }, { sourceTimeSeconds: 4, gain: 0.8 }];
  const { definition, diagnostics } = extractCompositionPresetDefinition(source);
  assert.equal(diagnostics.some(diagnostic => diagnostic.code === "SOURCE_BOUND_SETTINGS_PRESERVED"), true);
  const target = createDocument(1, 10);
  target.clips[0]!.sourceOffsetSeconds = 2;
  target.clips[0]!.volumeEnvelope = [{ sourceTimeSeconds: 2, gain: 0.4 }];
  const restored = applyCompositionPresetDefinition({ definition, document: target }).document.clips[0]!;
  assert.equal(restored.sourceOffsetSeconds, 2);
  assert.deepEqual(restored.volumeEnvelope, target.clips[0]!.volumeEnvelope);
});

test("los presets V1 siguen legibles sin introducir mezcla o configuración V2", () => {
  const legacy = findBuiltInCompositionPreset("system-visual-story")!.definition;
  assert.equal(compositionDynamicPresetDefinitionSchema.parse(legacy).schemaVersion, 1);
  const target = createSystemPresetDocument();
  target.audioMix.masterVolume = 0.42;
  const applied = applyCompositionPresetDefinition({ definition: legacy, document: target }).document;
  assert.equal(applied.audioMix.masterVolume, 0.42);
});

test("cada campo actual del documento y clip tiene una política explícita de presets", () => {
  assert.deepEqual(Object.keys(COMPOSITION_PRESET_CLIP_FIELD_POLICY).sort(), Object.keys(compositionClipSchema.shape).sort());
  assert.deepEqual(Object.keys(COMPOSITION_PRESET_DOCUMENT_FIELD_POLICY).sort(), Object.keys(compositionEditorDocumentSchema.shape).sort());
});

function documentWithNativeLayers() {
  const document = createDocument(1, 10);
  document.format = "courseforge-composition-v3";
  for (const kind of ["TEXT", "CAPTION"] as const) {
    const overlay = createCompositionNativeOverlay({ document, id: `native-${kind.toLowerCase()}`, kind, playheadSeconds: 0 });
    if (overlay.track) document.tracks.push(overlay.track);
    document.clips.push(overlay.clip);
  }
  return compositionEditorDocumentSchema.parse(document);
}

function captionsOf(document: ReturnType<typeof documentWithNativeLayers>) {
  const source = document.clips.find(clip => clip.kind === "CAPTION")!.source;
  if (source.type !== "NATIVE_CAPTIONS") throw new Error("Captions requeridos");
  return source.cues;
}

