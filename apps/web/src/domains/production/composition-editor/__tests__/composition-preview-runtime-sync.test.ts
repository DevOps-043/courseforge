import assert from "node:assert/strict";
import test from "node:test";
import type { CompositionPreviewParentCommandInput } from "../composition-preview-protocol";
import { canCommitCompositionPreviewRuntimePatch, CompositionPreviewRuntimePatchCoordinator } from "../composition-preview-runtime-sync.client";

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

test("invalidates pending patches on navigation and preserves sequence correlation after retry", async () => {
  const coordinator = new CompositionPreviewRuntimePatchCoordinator(100);
  const sequences: number[] = [];
  const dispatch = () => coordinator.dispatch({
    baseDocumentHash: "a".repeat(64), patch,
    send: (command) => {
      if (command.type === "courseforge-composition-visual-patch") sequences.push(command.sequence);
      return true;
    },
  });
  const previous = dispatch();
  coordinator.dispose();
  assert.equal((await previous).code, "DISPOSED");
  const retried = dispatch();
  const acknowledge = (sequence: number) => coordinator.acknowledge({
    applied: true, code: "APPLIED", durationMs: 1, protocolVersion: 1, sequence,
    type: "courseforge-composition-visual-patch-result",
  });
  assert.notEqual(sequences[0], sequences[1]);
  assert.equal(acknowledge(sequences[0]!), false);
  assert.equal(acknowledge(sequences[1]!), true);
  assert.equal((await retried).applied, true);
  coordinator.dispose();
});

test("does not commit an already-resolved ACK after navigation or terminal failure during save", async () => {
  const coordinator = new CompositionPreviewRuntimePatchCoordinator(100);
  const result = coordinator.dispatch({
    baseDocumentHash: "a".repeat(64), patch,
    send: (command) => {
      if (command.type === "courseforge-composition-visual-patch") coordinator.acknowledge({
        applied: true, code: "APPLIED", durationMs: 1, protocolVersion: 1, sequence: command.sequence,
        type: "courseforge-composition-visual-patch-result",
      });
      return true;
    },
  });
  coordinator.dispose();
  const outcome = await result;
  assert.equal(outcome.applied, true);
  const input = { applied: outcome.applied, dispatchedGeneration: 4, currentGeneration: 4, failedGeneration: null };
  assert.equal(canCommitCompositionPreviewRuntimePatch(input), true);
  assert.equal(canCommitCompositionPreviewRuntimePatch({ ...input, currentGeneration: 5 }), false);
  assert.equal(canCommitCompositionPreviewRuntimePatch({ ...input, failedGeneration: 4 }), false);
  assert.equal(canCommitCompositionPreviewRuntimePatch({ ...input, applied: false }), false);
});

test("settles a thrown send as SEND_REJECTED and ignores its late ACK", async () => {
  const coordinator = new CompositionPreviewRuntimePatchCoordinator(100);
  const outcome = await coordinator.dispatch({
    baseDocumentHash: "a".repeat(64), patch,
    send: () => { throw new Error("Detached frame"); },
  });
  assert.equal(outcome.code, "SEND_REJECTED");
  assert.equal(outcome.applied, false);
  assert.equal(coordinator.acknowledge({
    applied: true, code: "APPLIED", durationMs: 1, protocolVersion: 1, sequence: outcome.sequence,
    type: "courseforge-composition-visual-patch-result",
  }), false);
  coordinator.dispose();
});
