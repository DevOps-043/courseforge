import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { applyCompositionPresetDefinition, CompositionPresetApplicationError } from "../composition-preset-application.service";
import { findBuiltInCompositionPreset } from "../composition-preset-builtins";
import { extractCompositionPresetDefinition } from "../composition-preset-extraction.service";

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

test("extraction stores no asset ids, labels, URLs, HTML or course copy", () => {
  const document = createDocument(2, 10);
  const { definition } = extractCompositionPresetDefinition(document);
  const serialized = JSON.stringify(definition);

  assert.doesNotMatch(serialized, /Sensitive course title|Private subtitle|B-roll 1|00000000-0000-4000/i);
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

