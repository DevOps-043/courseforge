import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCompositionCaptionPreset,
  listCompositionCaptionPresets,
} from "../composition-caption-preset.service";
import { DEFAULT_TRANSPARENT_CAPTION_STYLE } from "../composition-text-layer.types";

test("exposes deterministic caption presets with user-facing descriptions", () => {
  assert.deepEqual(listCompositionCaptionPresets().map((preset) => preset.id), ["TRANSPARENT", "SOLID", "MINIMAL"]);
  assert.ok(listCompositionCaptionPresets().every((preset) => preset.label && preset.description));
});

test("applies a preset without replacing the selected font", () => {
  const style = { ...DEFAULT_TRANSPARENT_CAPTION_STYLE, fontAssetId: "00000000-0000-4000-8000-000000000001", fontFamily: "Brand Sans" };
  const updated = applyCompositionCaptionPreset(style, "SOLID");

  assert.equal(updated.backgroundOpacity, 0.78);
  assert.equal(updated.strokeWidth, 0);
  assert.equal(updated.fontAssetId, style.fontAssetId);
  assert.equal(updated.fontFamily, "Brand Sans");
});
