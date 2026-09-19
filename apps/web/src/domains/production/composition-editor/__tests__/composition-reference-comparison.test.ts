import assert from "node:assert/strict";
import test from "node:test";
import {
  clampCompositionReferenceZoom,
  COMPOSITION_REFERENCE_MAX_BYTES,
  validateCompositionReferenceImage,
} from "../composition-reference-comparison";

test("accepts supported reference images within the safety limits", () => {
  assert.equal(validateCompositionReferenceImage({
    byteLength: 2_000_000,
    height: 2_160,
    mimeType: "image/webp",
    width: 3_840,
  }), null);
});

test("rejects unsupported or unsafe reference images", () => {
  assert.match(validateCompositionReferenceImage({ mimeType: "image/svg+xml" }) || "", /PNG, JPEG o WebP/);
  assert.match(validateCompositionReferenceImage({ byteLength: COMPOSITION_REFERENCE_MAX_BYTES + 1, mimeType: "image/png" }) || "", /20 MB/);
  assert.match(validateCompositionReferenceImage({ height: 20_000, mimeType: "image/jpeg", width: 100 }) || "", /16 384 px/);
  assert.match(validateCompositionReferenceImage({ height: 8_000, mimeType: "image/png", width: 8_000 }) || "", /40 megapíxeles/);
});

test("requires complete, positive decoded dimensions", () => {
  assert.match(validateCompositionReferenceImage({ mimeType: "image/png", width: 1920 }) || "", /dimensiones/);
  assert.match(validateCompositionReferenceImage({ height: 1080, mimeType: "image/png", width: 0 }) || "", /dimensiones/);
});

test("clamps and normalizes reference zoom", () => {
  assert.equal(clampCompositionReferenceZoom(0.1), 0.5);
  assert.equal(clampCompositionReferenceZoom(1.234), 1.23);
  assert.equal(clampCompositionReferenceZoom(4), 2);
  assert.equal(clampCompositionReferenceZoom(Number.NaN), 1);
});
