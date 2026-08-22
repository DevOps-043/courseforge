import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPOSITION_PREVIEW_PROTOCOL_VERSION,
  createCompositionPreviewParentCommand,
  parseCompositionPreviewIframeMessage,
} from "../composition-preview-protocol";

test("normalizes legacy iframe messages to the current protocol version", () => {
  const message = parseCompositionPreviewIframeMessage({
    duration: 42,
    selectedHfId: null,
    type: "courseforge-composition-ready",
  });
  assert.equal(message?.protocolVersion, COMPOSITION_PREVIEW_PROTOCOL_VERSION);
});

test("rejects unknown fields, unsafe bounds and unsupported protocol versions", () => {
  assert.equal(parseCompositionPreviewIframeMessage({
    duration: 42,
    sourceUrl: "https://storage.test/private.mp4?token=secret",
    type: "courseforge-composition-ready",
  }), null);
  assert.equal(parseCompositionPreviewIframeMessage({
    protocolVersion: 999,
    seconds: 1,
    type: "courseforge-composition-time",
  }), null);
  assert.equal(parseCompositionPreviewIframeMessage({
    hfId: "clip-1",
    layout: { height: 100, width: 100, x: Number.NaN, y: 0 },
    type: "courseforge-composition-layout-commit",
  }), null);
});

test("adds a version to valid parent commands and rejects invalid ranges", () => {
  assert.deepEqual(createCompositionPreviewParentCommand({
    seconds: 12,
    type: "courseforge-composition-seek",
  }), {
    protocolVersion: COMPOSITION_PREVIEW_PROTOCOL_VERSION,
    seconds: 12,
    type: "courseforge-composition-seek",
  });
  assert.equal(createCompositionPreviewParentCommand({
    scale: 8,
    type: "courseforge-composition-preview-zoom",
  }), null);
});

test("validates visual patches and their correlated acknowledgements", () => {
  const command = createCompositionPreviewParentCommand({
    baseDocumentHash: "a".repeat(64),
    patch: { changes: [{ hfId: "clip-1", hidden: true }] },
    sequence: 7,
    type: "courseforge-composition-visual-patch",
  });
  assert.equal(command?.protocolVersion, COMPOSITION_PREVIEW_PROTOCOL_VERSION);
  assert.equal(parseCompositionPreviewIframeMessage({
    applied: true,
    code: "APPLIED",
    durationMs: 3,
    protocolVersion: COMPOSITION_PREVIEW_PROTOCOL_VERSION,
    sequence: 7,
    type: "courseforge-composition-visual-patch-result",
  })?.type, "courseforge-composition-visual-patch-result");
  assert.equal(createCompositionPreviewParentCommand({
    baseDocumentHash: "not-a-hash",
    patch: { changes: [{ hfId: "clip-1", hidden: true }] },
    sequence: 7,
    type: "courseforge-composition-visual-patch",
  }), null);
});
