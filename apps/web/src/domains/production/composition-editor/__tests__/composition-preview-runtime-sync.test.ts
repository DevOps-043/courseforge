import assert from "node:assert/strict";
import test from "node:test";
import type { CompositionPreviewParentCommandInput } from "../composition-preview-protocol";
import { CompositionPreviewRuntimePatchCoordinator } from "../composition-preview-runtime-sync.client";

const patch = { changes: [{ hfId: "clip-1", hidden: true }] };

test("correlates one visual patch acknowledgement by sequence", async () => {
  const coordinator = new CompositionPreviewRuntimePatchCoordinator(100);
  const sentCommands: CompositionPreviewParentCommandInput[] = [];
  const outcomePromise = coordinator.dispatch({
    baseDocumentHash: "a".repeat(64),
    patch,
    send: (command) => { sentCommands.push(command); return true; },
  });
  const sent = sentCommands[0];
  assert.equal(sent?.type, "courseforge-composition-visual-patch");
  const sequence = sent && "sequence" in sent ? sent.sequence : 0;
  assert.equal(coordinator.acknowledge({
    applied: true,
    code: "APPLIED",
    durationMs: 4,
    protocolVersion: 1,
    sequence,
    type: "courseforge-composition-visual-patch-result",
  }), true);
  const outcome = await outcomePromise;
  assert.equal(outcome.applied, true);
  assert.equal(outcome.code, "APPLIED");
  assert.equal(outcome.sequence, sequence);
  assert.ok(outcome.durationMs >= 0);
  assert.equal(coordinator.acknowledge({
    applied: true, code: "APPLIED", durationMs: 4, protocolVersion: 1, sequence,
    type: "courseforge-composition-visual-patch-result",
  }), false);
});

test("times out without rejecting or leaving a pending acknowledgement", async () => {
  const coordinator = new CompositionPreviewRuntimePatchCoordinator(1);
  const outcome = await coordinator.dispatch({
    baseDocumentHash: "b".repeat(64),
    patch,
    send: () => true,
  });
  assert.equal(outcome.applied, false);
  assert.equal(outcome.code, "TIMEOUT");
  assert.ok(outcome.durationMs >= 0);
});
