import assert from "node:assert/strict";
import test from "node:test";
import { compositionPreviewMetricSchema, type CompositionPreviewMetric } from "../composition-preview-telemetry";
import {
  INITIAL_COMPOSITION_PREVIEW_SYNC_STATE,
  transitionCompositionPreviewSyncState,
} from "../composition-preview-sync-state";
import {
  applyCompositionPreviewTerminalFailure,
  type TerminalPreviewPresentation,
} from "../composition-preview-terminal-failure";

test("commits one terminal failure with a consistent UI state and bounded metric", () => {
  const state = { current: transitionCompositionPreviewSyncState(INITIAL_COMPOSITION_PREVIEW_SYNC_STATE, {
    documentHash: "hash-a",
    type: "DOCUMENT_LOADED",
  }) };
  const metrics: CompositionPreviewMetric[] = [];
  const presentations: TerminalPreviewPresentation[] = [];
  const ports = {
    present: (presentation: TerminalPreviewPresentation) => { presentations.push(presentation); },
    record: (metric: CompositionPreviewMetric) => { metrics.push(metric); },
    state,
  };

  assert.equal(applyCompositionPreviewTerminalFailure({
    code: "AUTH_REQUIRED",
    message: "Inicia sesión.",
    outcome: "AUTH_REQUIRED",
  }, 12, ports), true);
  assert.equal(state.current.phase, "RUNTIME_FAILED");
  assert.deepEqual(presentations, [{
    loadErrorCode: "AUTH_REQUIRED",
    mediaState: "READY",
    message: "Inicia sesión.",
    pendingMediaIds: [],
    playing: false,
    ready: false,
  }]);
  assert.equal(compositionPreviewMetricSchema.safeParse(metrics[0]).success, true);
  assert.equal(metrics[0]?.context?.syncOutcome, "AUTH_REQUIRED");
  assert.equal(metrics[0]?.atSeconds, 12);

  assert.equal(applyCompositionPreviewTerminalFailure({
    message: "Un fallo tardío no debe sustituir el primero.",
    outcome: "PREVIEW_READY_TIMEOUT",
  }, 15, ports), false);
  assert.equal(metrics.length, 1);
  assert.equal(presentations.length, 1);
});

test("allows another terminal outcome after a new preview navigation starts", () => {
  const state = { current: transitionCompositionPreviewSyncState(INITIAL_COMPOSITION_PREVIEW_SYNC_STATE, {
    documentHash: "hash-a",
    type: "DOCUMENT_LOADED",
  }) };
  const metrics: CompositionPreviewMetric[] = [];
  const presentations: TerminalPreviewPresentation[] = [];
  const ports = {
    present: (presentation: TerminalPreviewPresentation) => { presentations.push(presentation); },
    record: (metric: CompositionPreviewMetric) => { metrics.push(metric); },
    state,
  };
  assert.equal(applyCompositionPreviewTerminalFailure({ message: "Sin runtime.", outcome: "PREVIEW_LOADED_NO_RUNTIME" }, 0, ports), true);
  state.current = transitionCompositionPreviewSyncState(state.current, { documentHash: "hash-a", type: "PREVIEW_RELOAD_STARTED" });
  assert.equal(applyCompositionPreviewTerminalFailure({ message: "Falló la navegación.", outcome: "PREVIEW_IFRAME_ERROR" }, 0, ports), true);
  assert.deepEqual(metrics.map((metric) => metric.context?.syncOutcome), ["PREVIEW_LOADED_NO_RUNTIME", "PREVIEW_IFRAME_ERROR"]);
  assert.equal(presentations.length, 2);
  assert.equal(presentations[1]?.loadErrorCode, null);
});

test("keeps the editor failure visible when telemetry delivery throws", () => {
  const state = { current: INITIAL_COMPOSITION_PREVIEW_SYNC_STATE };
  const presentations: TerminalPreviewPresentation[] = [];
  assert.equal(applyCompositionPreviewTerminalFailure({ message: "El preview falló.", outcome: "RUNTIME_FAILED" }, 0, {
    present: (presentation) => { presentations.push(presentation); },
    record: () => { throw new Error("Telemetry unavailable"); },
    state,
  }), true);
  assert.equal(state.current.phase, "RUNTIME_FAILED");
  assert.equal(presentations[0]?.message, "El preview falló.");
});
