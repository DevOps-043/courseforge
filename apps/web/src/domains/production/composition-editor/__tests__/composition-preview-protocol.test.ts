import assert from "node:assert/strict";
import test from "node:test";
import { buildCompositionPreviewFailureBridge } from "../composition-preview-failure-bridge";
import { resolveCompositionPreviewLoadErrorPresentation } from "../composition-preview-load-error";
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

test("accepts a versioned ready event and rejects malformed document hashes", () => {
  const documentHash = "a".repeat(64);
  const ready = parseCompositionPreviewIframeMessage({
    documentHash,
    duration: 42,
    previewGeneration: 7,
    type: "courseforge-composition-ready",
  });
  assert.equal(ready?.type, "courseforge-composition-ready");
  if (ready?.type === "courseforge-composition-ready") {
    assert.equal(ready.documentHash, documentHash);
    assert.equal(ready.previewGeneration, 7);
  }
  assert.equal(parseCompositionPreviewIframeMessage({
    documentHash: "stale",
    duration: 42,
    type: "courseforge-composition-ready",
  }), null);
  assert.equal(parseCompositionPreviewIframeMessage({
    documentHash,
    duration: 42,
    previewGeneration: -1,
    type: "courseforge-composition-ready",
  }), null);
});

test("accepts only fixed, versioned load failures from the active iframe", () => {
  const documentHash = "b".repeat(64);
  for (const code of ["AUTH_REQUIRED", "ACCESS_DENIED"] as const) {
    assert.equal(parseCompositionPreviewIframeMessage({
      code,
      documentHash,
      previewGeneration: 7,
      type: "courseforge-composition-load-error",
    })?.type, "courseforge-composition-load-error");
  }
  assert.deepEqual(parseCompositionPreviewIframeMessage({
    code: "COMPILATION_FAILED",
    documentHash,
    previewGeneration: 7,
    type: "courseforge-composition-load-error",
  }), {
    code: "COMPILATION_FAILED",
    documentHash,
    previewGeneration: 7,
    protocolVersion: COMPOSITION_PREVIEW_PROTOCOL_VERSION,
    type: "courseforge-composition-load-error",
  });
  assert.equal(parseCompositionPreviewIframeMessage({ code: "STACK_TRACE", documentHash, previewGeneration: 7, type: "courseforge-composition-load-error" }), null);
  assert.equal(parseCompositionPreviewIframeMessage({ code: "UNKNOWN", documentHash: "invalid", previewGeneration: 7, type: "courseforge-composition-load-error" }), null);
  assert.equal(parseCompositionPreviewIframeMessage({ code: "UNKNOWN", documentHash, type: "courseforge-composition-load-error" }), null);
});

test("builds a nonce-restricted error bridge without server messages", () => {
  const nonce = "00000000-0000-4000-8000-000000000041";
  const documentHash = "c".repeat(64);
  const bridge = buildCompositionPreviewFailureBridge({ code: "DEPENDENCY_FAILED", documentHash, nonce, previewGeneration: 7 });
  assert.match(bridge.contentSecurityPolicy, new RegExp(`script-src 'nonce-${nonce}'`));
  assert.match(bridge.html, new RegExp(`nonce="${nonce}"`));
  assert.match(bridge.html, /"code":"DEPENDENCY_FAILED"/);
  assert.match(bridge.html, /"previewGeneration":7/);
  assert.equal(bridge.html.includes("stack"), false);
  const authBridge = buildCompositionPreviewFailureBridge({ code: "AUTH_REQUIRED", documentHash, nonce, previewGeneration: 7 });
  assert.match(authBridge.html, /"code":"AUTH_REQUIRED"/);
  assert.equal(authBridge.html.includes("No autorizado"), false);
  assert.throws(() => buildCompositionPreviewFailureBridge({ code: "</script><script>" as "UNKNOWN", documentHash, nonce, previewGeneration: 7 }));
  assert.throws(() => buildCompositionPreviewFailureBridge({ code: "UNKNOWN", documentHash: "<script>", nonce, previewGeneration: 7 }));
  assert.throws(() => buildCompositionPreviewFailureBridge({ code: "UNKNOWN", documentHash, nonce: "unsafe\"", previewGeneration: 7 }));
  assert.throws(() => buildCompositionPreviewFailureBridge({ code: "UNKNOWN", documentHash, nonce, previewGeneration: -1 }));
});

test("maps load failures to safe recovery actions", () => {
  assert.equal(resolveCompositionPreviewLoadErrorPresentation("AUTH_REQUIRED")?.action, "LOGIN");
  assert.equal(resolveCompositionPreviewLoadErrorPresentation("ACCESS_DENIED")?.action, "NONE");
  assert.equal(resolveCompositionPreviewLoadErrorPresentation("ACCESS_DENIED")?.actionLabel, null);
  assert.equal(resolveCompositionPreviewLoadErrorPresentation("DOCUMENT_UNAVAILABLE")?.action, "RELOAD_EDITOR");
  assert.equal(resolveCompositionPreviewLoadErrorPresentation("COMPILATION_FAILED")?.action, "RETRY_PREVIEW");
  assert.equal(resolveCompositionPreviewLoadErrorPresentation(null), null);
});

test("rejects unknown fields, unsafe bounds and unsupported protocol versions", () => {
  assert.equal(parseCompositionPreviewIframeMessage({ seconds: 1, previewGeneration: 7, type: "courseforge-composition-time" })?.previewGeneration, 7);
  assert.equal(parseCompositionPreviewIframeMessage({ seconds: 1, previewGeneration: -1, type: "courseforge-composition-time" }), null);
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

test("identifies whether a preview selection came from the canvas or a parent command", () => {
  assert.deepEqual(parseCompositionPreviewIframeMessage({
    hfId: "clip-1",
    origin: "PARENT",
    type: "courseforge-composition-selection",
  }), {
    hfId: "clip-1",
    origin: "PARENT",
    protocolVersion: COMPOSITION_PREVIEW_PROTOCOL_VERSION,
    type: "courseforge-composition-selection",
  });
  assert.equal(parseCompositionPreviewIframeMessage({
    hfId: "clip-1",
    origin: "UNKNOWN",
    type: "courseforge-composition-selection",
  }), null);
  assert.deepEqual(createCompositionPreviewParentCommand({
    hfId: "clip-2",
    hfIds: ["clip-1", "clip-2"],
    type: "courseforge-composition-select",
  }), {
    hfId: "clip-2",
    hfIds: ["clip-1", "clip-2"],
    protocolVersion: COMPOSITION_PREVIEW_PROTOCOL_VERSION,
    type: "courseforge-composition-select",
  });
  assert.equal(createCompositionPreviewParentCommand({
    hfId: "clip-1",
    hfIds: Array.from({ length: 101 }, (_, index) => `clip-${index}`),
    type: "courseforge-composition-select",
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

test("valida preview efímero y estados del runtime de color", () => {
  assert.deepEqual(createCompositionPreviewParentCommand({
    colorGrading: { adjust: { contrast: 0.2, exposure: 0.5, saturation: -0.3 } },
    hfId: "clip-1",
    type: "courseforge-composition-preview-color-grading",
  }), {
    colorGrading: { adjust: { contrast: 0.2, exposure: 0.5, saturation: -0.3 } },
    hfId: "clip-1",
    protocolVersion: COMPOSITION_PREVIEW_PROTOCOL_VERSION,
    type: "courseforge-composition-preview-color-grading",
  });
  assert.equal(createCompositionPreviewParentCommand({
    colorGrading: { adjust: { contrast: 0, exposure: 3, saturation: 0 } },
    hfId: "clip-1",
    type: "courseforge-composition-preview-color-grading",
  }), null);
  assert.deepEqual(parseCompositionPreviewIframeMessage({
    hfId: "clip-1",
    message: "WebGL unavailable",
    state: "unavailable",
    type: "courseforge-composition-color-grading-status",
  }), {
    hfId: "clip-1",
    message: "WebGL unavailable",
    protocolVersion: COMPOSITION_PREVIEW_PROTOCOL_VERSION,
    state: "unavailable",
    type: "courseforge-composition-color-grading-status",
  });
});
