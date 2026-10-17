import assert from "node:assert/strict";
import test from "node:test";
import { classifyCompositionPreviewMessage } from "../composition-preview-message-policy";
import { parseCompositionPreviewIframeMessage } from "../composition-preview-protocol";
import { applyCompositionPreviewTerminalFailure } from "../composition-preview-terminal-failure";
import type { CompositionPreviewMetric } from "../composition-preview-telemetry";
import {
  INITIAL_COMPOSITION_PREVIEW_SYNC_STATE,
  shouldReportCompositionPreviewReadyTimeout,
  shouldReportCompositionPreviewRuntimeHandshakeFailure,
  transitionCompositionPreviewSyncState,
} from "../composition-preview-sync-state";

test("tracks persisted and rendered document versions independently", () => {
  const loaded = transitionCompositionPreviewSyncState(INITIAL_COMPOSITION_PREVIEW_SYNC_STATE, {
    documentHash: "hash-a",
    type: "DOCUMENT_LOADED",
  });
  assert.equal(loaded.phase, "VISUAL_SYNC_PENDING");
  assert.equal(loaded.renderedDocumentHash, null);
  assert.equal(loaded.pendingRenderDocumentHash, "hash-a");

  const ready = transitionCompositionPreviewSyncState(loaded, { documentHash: "hash-a", type: "PREVIEW_READY" });
  assert.equal(ready.phase, "SYNCED");

  const dirty = transitionCompositionPreviewSyncState(ready, { type: "EDIT_ACCEPTED" });
  const saving = transitionCompositionPreviewSyncState(dirty, { type: "SAVE_STARTED" });
  const saved = transitionCompositionPreviewSyncState(saving, { documentHash: "hash-b", type: "SAVE_SUCCEEDED" });
  assert.equal(saved.phase, "VISUAL_SYNC_PENDING");
  assert.equal(saved.renderedDocumentHash, "hash-a");
  assert.equal(saved.persistedDocumentHash, "hash-b");
});

test("keeps conflicts and runtime failures explicit", () => {
  const conflicted = transitionCompositionPreviewSyncState(INITIAL_COMPOSITION_PREVIEW_SYNC_STATE, {
    documentHash: "server-hash",
    type: "CONFLICT",
  });
  assert.equal(conflicted.phase, "CONFLICT");
  assert.equal(transitionCompositionPreviewSyncState(conflicted, { type: "RUNTIME_FAILED" }).phase, "RUNTIME_FAILED");
});

test("ignores an obsolete ready event while a newer render is pending", () => {
  const loaded = transitionCompositionPreviewSyncState(INITIAL_COMPOSITION_PREVIEW_SYNC_STATE, {
    documentHash: "hash-a", type: "DOCUMENT_LOADED",
  });
  const newer = transitionCompositionPreviewSyncState(loaded, {
    documentHash: "hash-b", type: "PREVIEW_RELOAD_STARTED",
  });
  assert.equal(transitionCompositionPreviewSyncState(newer, {
    documentHash: "hash-a", type: "PREVIEW_READY",
  }), newer);
  const ready = transitionCompositionPreviewSyncState(newer, {
    documentHash: "hash-b", type: "PREVIEW_READY",
  });
  assert.equal(ready.renderedDocumentHash, "hash-b");
  assert.equal(ready.pendingRenderDocumentHash, null);
});

test("reports a missing ready ACK only for the current pending revision", () => {
  const pending = transitionCompositionPreviewSyncState(INITIAL_COMPOSITION_PREVIEW_SYNC_STATE, {
    documentHash: "hash-a", type: "DOCUMENT_LOADED",
  });
  assert.equal(shouldReportCompositionPreviewReadyTimeout({ expectedDocumentHash: "hash-a", previewReady: false, state: pending }), true);
  assert.equal(shouldReportCompositionPreviewReadyTimeout({ expectedDocumentHash: "hash-b", previewReady: false, state: pending }), false);
  assert.equal(shouldReportCompositionPreviewReadyTimeout({ expectedDocumentHash: "hash-a", previewReady: true, state: pending }), false);
  const ready = transitionCompositionPreviewSyncState(pending, { documentHash: "hash-a", type: "PREVIEW_READY" });
  assert.equal(shouldReportCompositionPreviewReadyTimeout({ expectedDocumentHash: "hash-a", previewReady: false, state: ready }), false);
  const editing = transitionCompositionPreviewSyncState(pending, { type: "EDIT_ACCEPTED" });
  assert.equal(shouldReportCompositionPreviewReadyTimeout({ expectedDocumentHash: "hash-a", previewReady: false, state: editing }), false);
});

test("reports a missing runtime handshake only for the active pending navigation", () => {
  const pending = transitionCompositionPreviewSyncState(INITIAL_COMPOSITION_PREVIEW_SYNC_STATE, {
    documentHash: "hash-a", type: "DOCUMENT_LOADED",
  });
  const expected = {
    expectedDocumentHash: "hash-a",
    expectedGeneration: 3,
    frameGeneration: 3,
    observedRuntimeGeneration: null,
    previewReady: false,
    state: pending,
  };
  assert.equal(shouldReportCompositionPreviewRuntimeHandshakeFailure(expected), true);
  assert.equal(shouldReportCompositionPreviewRuntimeHandshakeFailure({ ...expected, frameGeneration: 2 }), false);
  assert.equal(shouldReportCompositionPreviewRuntimeHandshakeFailure({ ...expected, observedRuntimeGeneration: 3 }), false);
  assert.equal(shouldReportCompositionPreviewRuntimeHandshakeFailure({ ...expected, expectedDocumentHash: "hash-b" }), false);
  assert.equal(shouldReportCompositionPreviewRuntimeHandshakeFailure({ ...expected, previewReady: true }), false);
});

test("rejects wrong-hash ready and error messages before cancelling the runtime watchdog", () => {
  const documentHash = "a".repeat(64);
  const state = transitionCompositionPreviewSyncState(INITIAL_COMPOSITION_PREVIEW_SYNC_STATE, { documentHash, type: "DOCUMENT_LOADED" });
  for (const candidate of [
    { type: "courseforge-composition-ready", documentHash: "b".repeat(64), previewGeneration: 4, duration: 20 },
    { type: "courseforge-composition-load-error", documentHash: "b".repeat(64), previewGeneration: 4, code: "AUTH_REQUIRED" },
  ]) {
    const message = parseCompositionPreviewIframeMessage(candidate);
    assert.ok(message);
    const decision = classifyCompositionPreviewMessage({ documentHash, generation: 4, failedGeneration: null, message, strictSync: true });
    const observedRuntimeGeneration = decision.accept && decision.runtimeSignal ? 4 : null;
    assert.equal(decision.accept, false);
    assert.equal(shouldReportCompositionPreviewRuntimeHandshakeFailure({
      expectedDocumentHash: documentHash, expectedGeneration: 4, frameGeneration: 4,
      observedRuntimeGeneration, previewReady: false, state,
    }), true);
  }
});

test("integrates failure, same-hash retry, obsolete messages, media preparation and valid ready", () => {
  const documentHash = "a".repeat(64);
  const state = { current: transitionCompositionPreviewSyncState(INITIAL_COMPOSITION_PREVIEW_SYNC_STATE, { documentHash, type: "DOCUMENT_LOADED" }) };
  const metrics: CompositionPreviewMetric[] = [];
  let failurePresentations = 0;
  const ports = {
    state,
    record: (metric: CompositionPreviewMetric) => { metrics.push(metric); },
    present: () => { failurePresentations += 1; },
  };
  applyCompositionPreviewTerminalFailure({ outcome: "PREVIEW_READY_TIMEOUT", message: "Sin confirmación." }, 0, ports);
  applyCompositionPreviewTerminalFailure({ outcome: "PREVIEW_IFRAME_ERROR", message: "Error tardío." }, 0, ports);
  assert.equal(failurePresentations, 1);
  assert.equal(metrics.length, 1);
  state.current = transitionCompositionPreviewSyncState(state.current, { documentHash, type: "PREVIEW_RELOAD_STARTED" });
  let observedRuntimeGeneration: number | null = null;
  const receive = (candidate: unknown) => {
    const message = parseCompositionPreviewIframeMessage(candidate);
    assert.ok(message);
    const decision = classifyCompositionPreviewMessage({ documentHash, generation: 5, failedGeneration: null, message, strictSync: true });
    if (!decision.accept) return false;
    if (decision.runtimeSignal) observedRuntimeGeneration = 5;
    if (message.type === "courseforge-composition-ready") {
      state.current = transitionCompositionPreviewSyncState(state.current, { documentHash: message.documentHash!, type: "PREVIEW_READY" });
    }
    return true;
  };
  assert.equal(receive({ type: "courseforge-composition-ready", documentHash, previewGeneration: 4, duration: 20 }), false);
  assert.equal(receive({ type: "courseforge-composition-load-error", documentHash, previewGeneration: 4, code: "UNKNOWN" }), false);
  assert.equal(receive({ type: "courseforge-composition-time", previewGeneration: 4, seconds: 10 }), false);
  assert.equal(observedRuntimeGeneration, null);
  assert.equal(receive({ type: "courseforge-composition-media-state", previewGeneration: 5, pendingMediaIds: ["video-1"], state: "PREPARING" }), true);
  assert.equal(shouldReportCompositionPreviewRuntimeHandshakeFailure({ expectedDocumentHash: documentHash, expectedGeneration: 5, frameGeneration: 5, observedRuntimeGeneration, previewReady: false, state: state.current }), false);
  assert.equal(shouldReportCompositionPreviewReadyTimeout({ expectedDocumentHash: documentHash, previewReady: false, state: state.current }), true);
  assert.equal(receive({ type: "courseforge-composition-ready", documentHash, previewGeneration: 5, duration: 20 }), true);
  assert.equal(state.current.phase, "SYNCED");
  assert.equal(state.current.renderedDocumentHash, documentHash);
  assert.equal(shouldReportCompositionPreviewReadyTimeout({ expectedDocumentHash: documentHash, previewReady: true, state: state.current }), false);
});

test("keeps legacy messages accepted only when strict navigation validation is disabled", () => {
  const message = parseCompositionPreviewIframeMessage({ type: "courseforge-composition-ready", duration: 20 });
  assert.ok(message);
  assert.deepEqual(classifyCompositionPreviewMessage({ documentHash: "a".repeat(64), generation: 5, failedGeneration: null, message, strictSync: true }), { accept: false, outcome: "UNVERIFIED_READY" });
  assert.deepEqual(classifyCompositionPreviewMessage({ documentHash: "a".repeat(64), generation: 5, failedGeneration: 5, message, strictSync: false }), { accept: true, runtimeSignal: false });
});

test("quarantines a failed navigation until retry even when a save changes the sync phase", () => {
  const documentHash = "a".repeat(64);
  const failed = transitionCompositionPreviewSyncState(INITIAL_COMPOSITION_PREVIEW_SYNC_STATE, { type: "RUNTIME_FAILED" });
  const saved = transitionCompositionPreviewSyncState(failed, { documentHash, type: "SAVE_SUCCEEDED" });
  assert.equal(saved.phase, "VISUAL_SYNC_PENDING");
  const candidates = [
    { type: "courseforge-composition-ready", documentHash, duration: 20 },
    { type: "courseforge-composition-time", seconds: 9 },
    { type: "courseforge-composition-playback", playing: true },
    { type: "courseforge-composition-selection", hfId: "clip-1" },
    { type: "courseforge-composition-layout-commit", hfId: "clip-1", layout: { x: 0, y: 0, width: 100, height: 100 } },
    { type: "courseforge-composition-visual-patch-result", applied: true, code: "APPLIED", durationMs: 1, sequence: 1 },
    { type: "courseforge-composition-media-state", pendingMediaIds: [], state: "READY" },
  ];
  for (const candidate of candidates) {
    const message = parseCompositionPreviewIframeMessage({ ...candidate, previewGeneration: 5 });
    assert.ok(message);
    assert.deepEqual(classifyCompositionPreviewMessage({ documentHash, generation: 5, failedGeneration: 5, message, strictSync: true }), { accept: false });
    assert.equal(classifyCompositionPreviewMessage({ documentHash, generation: 6, failedGeneration: null, message, strictSync: true }).accept, false);
    const retried = parseCompositionPreviewIframeMessage({ ...candidate, previewGeneration: 6 });
    assert.ok(retried);
    assert.deepEqual(classifyCompositionPreviewMessage({ documentHash, generation: 6, failedGeneration: null, message: retried, strictSync: true }), { accept: true, runtimeSignal: true });
  }
});

test("adopting a saved revision after failure waits for its own ready signal even with identical content", () => {
  const documentHash = "a".repeat(64);
  const loaded = transitionCompositionPreviewSyncState(INITIAL_COMPOSITION_PREVIEW_SYNC_STATE, { documentHash, type: "DOCUMENT_LOADED" });
  const ready = transitionCompositionPreviewSyncState(loaded, { documentHash, type: "PREVIEW_READY" });
  const failed = transitionCompositionPreviewSyncState(ready, { type: "RUNTIME_FAILED" });
  for (const adoptedHash of [documentHash, "b".repeat(64)]) {
    const adopted = transitionCompositionPreviewSyncState(failed, { documentHash: adoptedHash, type: "DOCUMENT_LOADED" });
    assert.equal(adopted.phase, "VISUAL_SYNC_PENDING");
    assert.equal(adopted.persistedDocumentHash, adoptedHash);
    assert.equal(shouldReportCompositionPreviewReadyTimeout({ expectedDocumentHash: adoptedHash, previewReady: false, state: adopted }), true);
    const previousReady = parseCompositionPreviewIframeMessage({ type: "courseforge-composition-ready", documentHash, previewGeneration: 3, duration: 20 });
    assert.ok(previousReady);
    assert.equal(classifyCompositionPreviewMessage({ documentHash: adoptedHash, generation: 4, failedGeneration: null, message: previousReady, strictSync: true }).accept, false);
    const confirmed = transitionCompositionPreviewSyncState(adopted, { documentHash: adoptedHash, type: "PREVIEW_READY" });
    assert.equal(confirmed.phase, "SYNCED");
  }
});
