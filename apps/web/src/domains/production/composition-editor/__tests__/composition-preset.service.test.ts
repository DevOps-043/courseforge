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
    ruleId: "slot-avatar",
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

