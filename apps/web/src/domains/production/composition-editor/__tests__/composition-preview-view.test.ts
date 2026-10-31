import assert from "node:assert/strict";
import test from "node:test";
import { COMPOSITION_PREVIEW_ZOOM, COMPOSITION_STUDIO_PANES, normalizeCompositionPreviewZoom } from "../composition-preview-view.config";
import { createCompositionPreviewParentCommand } from "../composition-preview-protocol";
import { resolveCompositionPreviewCanvasBounds } from "../composition-preview-viewport-geometry";

test("controles, protocolo y geometría comparten el rango de zoom", () => {
  for (const scale of [...COMPOSITION_PREVIEW_ZOOM.presets, 1.37]) {
    assert.ok(createCompositionPreviewParentCommand({ type: "courseforge-composition-preview-zoom", scale }));
    assert.ok(resolveCompositionPreviewCanvasBounds({ canvasWidth: 1920, canvasHeight: 1080, viewportWidth: 960, viewportHeight: 540, zoom: scale }));
  }
  for (const scale of [0, 0.24, 4.01, NaN, Infinity]) {
    assert.equal(createCompositionPreviewParentCommand({ type: "courseforge-composition-preview-zoom", scale }), null);
    assert.equal(resolveCompositionPreviewCanvasBounds({ canvasWidth: 1920, canvasHeight: 1080, viewportWidth: 960, viewportHeight: 540, zoom: scale }), null);
  }
  assert.equal(normalizeCompositionPreviewZoom(100), COMPOSITION_PREVIEW_ZOOM.maximum);
  assert.equal(normalizeCompositionPreviewZoom(-1), COMPOSITION_PREVIEW_ZOOM.minimum);
  assert.equal(normalizeCompositionPreviewZoom(NaN), COMPOSITION_PREVIEW_ZOOM.fit);
  assert.equal(normalizeCompositionPreviewZoom(1.37000001), 1.37);
  assert.ok(COMPOSITION_STUDIO_PANES.expanded > COMPOSITION_STUDIO_PANES.initial);
});
