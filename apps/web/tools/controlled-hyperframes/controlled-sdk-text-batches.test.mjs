import test from "node:test";
import assert from "node:assert/strict";
import {prepareControlledSdkTextBatches} from "./controlled-sdk-text-batches.mjs";

test("text collectors are prepared before initialization, routed by batch and closed once in reverse", async () => {
  const calls = [], contracts = [{id: 0}, {id: 1}];
  const group = await prepareControlledSdkTextBatches({contracts}, async ({contract}) => {
    calls.push(`prepare:${contract.id}`);
    return {loadDeclaredFonts: async () => calls.push(`load:${contract.id}`),
      observeCapture: async frame => calls.push(`capture:${contract.id}:${frame}`),
      finish: async () => ({id: contract.id}), close: () => calls.push(`close:${contract.id}`)};
  });
  await group.loadDeclaredFonts();
  await group.observeCapture(1, 49, 1.96);
  assert.deepEqual(await group.finish(), [{id: 0}, {id: 1}]);
  group.close();
  assert.deepEqual(calls, ["prepare:0", "prepare:1", "load:0", "load:1", "capture:1:49", "close:1", "close:0"]);
  await assert.rejects(group.observeCapture(0, 0, 0), /BATCH_INVALID/);
});
test("partial acquisition and font-loading failures drain every owned collector", async () => {
  let closed = 0;
  await assert.rejects(prepareControlledSdkTextBatches({contracts: [0, 1]}, async ({contract}) => {
    if (contract === 1) throw new Error("prepare failed");
    return {close: () => closed++};
  }), /prepare failed/);
  assert.equal(closed, 1);
  const group = await prepareControlledSdkTextBatches({contracts: [0, 1]}, async () => ({
    close: () => closed++, loadDeclaredFonts: async () => {throw new Error("load failed");}}));
  await assert.rejects(group.loadDeclaredFonts(), /load failed/);
  assert.equal(closed, 3);
});
test("cleanup failure cannot prevent closing other batches or publish partial font evidence", async () => {
  const closed = [];
  const group = await prepareControlledSdkTextBatches({contracts: [0, 1]}, async ({contract}) => ({
    finish: async () => {throw new Error("incomplete");},
    close: () => {closed.push(contract); if (contract === 1) throw new Error("private close error");}}));
  await assert.rejects(group.finish(), /^Error: CONTROLLED_RENDER_TEXT_BATCH_CLEANUP_FAILED$/);
  assert.deepEqual(closed, [1, 0]);
  group.close();
  await assert.rejects(prepareControlledSdkTextBatches({contracts: []}), /BATCH_INVALID/);
});
