import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildCompositionEventCheckpointPlan, requireSingleEventCheckpointBatch } from "../composition-conformance-event-checkpoints";
import { selectCompositionEventCheckpointBatch } from "../composition-conformance-batch-identity";
import { eventCheckpointBatchSchema } from "../composition-conformance-batch-contract";
import { evaluateCompositionConformance } from "../composition-preview-render-conformance";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";
import { COMPOSITION_EVENT_CHECKPOINT_POLICY } from "../composition-conformance-checkpoint-policy";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { getHyperframesRenderProfile } from "../../hyperframes/hyperframes-render-profiles";
import { hashCompositionDocument } from "../composition-document.service";
import { buildConformanceReferenceSource, verifyConformanceReferenceSource } from "../composition-conformance-reference.service";
import { createTransition, createTransitionDocument } from "./composition-transition-test-fixtures";
import { assertSnapshotVisibilityReuse, restrictSnapshotEventCheckpointReuse } from "../composition-snapshot-conformance-policy";

function nativeDocument(kind: "TEXT" | "CAPTION", durationSeconds = 10) {
  const document = createInitialCompositionDocument({sourceInsertionMode: "MANUAL", animatedDeck: null, assets: [],
    plan: {title: "Events", subtitle: "Complete", accentColor: "#38BDF8", durationSeconds}});
  document.canvas.durationSeconds = durationSeconds;
  const {clip, track} = createCompositionNativeOverlay({document, id: "native", kind, playheadSeconds: 0});
  if (track) document.tracks.push(track);
  clip.durationSeconds = durationSeconds; document.clips.push(clip);
  document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  return {document, clip};
}
function framesWithReason(document: ReturnType<typeof nativeDocument>["document"], reason: string) {
  return buildCompositionEventCheckpointPlan(document).batches.flat().filter((entry) => entry.reasons.includes(reason)).map((entry) => entry.frameIndex);
}

test("exact and sub-frame borders retain the actual before/at/after samples, with deterministic bounded batches", () => {
  const {document, clip} = nativeDocument("TEXT", 5);
  clip.startSeconds = 1.02; clip.durationSeconds = 2; clip.fadeInSeconds = 0.4; clip.fadeOutSeconds = 0.6;
  assert.deepEqual(framesWithReason(document, "before:clip-start:native"), [25]);
  assert.deepEqual(framesWithReason(document, "at:clip-start:native"), [26]);
  assert.deepEqual(framesWithReason(document, "after:clip-start:native"), [26]);
  assert.deepEqual(framesWithReason(document, "at:fade-in-end:native"), [36]);
  assert.deepEqual(framesWithReason(document, "at:fade-out-start:native"), [61]);
  const plan = buildCompositionEventCheckpointPlan(document), all = plan.batches.flat();
  assert.deepEqual(plan, buildCompositionEventCheckpointPlan(structuredClone(document)));
  assert.equal(all[0]!.frameIndex, 0); assert.equal(all.at(-1)!.frameIndex, 124);
  assert.equal(new Set(all.map((entry) => entry.frameIndex)).size, plan.checkpointCount);
  assert.ok(plan.batches.every((batch) => batch.length > 0 && batch.length <= 48));
});

test("caption and karaoke boundaries use clip-relative cue/word times and never persist their text", () => {
  const {document, clip} = nativeDocument("CAPTION", 5);
  clip.startSeconds = 1; clip.durationSeconds = 3;
  if (clip.source.type !== "NATIVE_CAPTIONS") throw new Error("Expected captions");
  clip.source.cues = [{id: "cue", startSeconds: 0.2, endSeconds: 1, text: "private-caption", words: [
    {id: "word", startSeconds: 0.2, endSeconds: 0.6, text: "private-word"}]}];
  assert.deepEqual(framesWithReason(document, "before:cue-start:native:cue"), [29]);
  assert.deepEqual(framesWithReason(document, "at:cue-end:native:cue"), [50]);
  assert.deepEqual(framesWithReason(document, "after:word-end:native:cue:word"), [41]);
  assert.equal(JSON.stringify(buildCompositionEventCheckpointPlan(document)).includes("private-"), false);
});

test("shared scheduler supplies full and partial yoyo keyframes rather than a guessed linear motion window", () => {
  const {document} = nativeDocument("TEXT");
  document.motion.animations = [{id: "loop", origin: "USER", propertyGroup: "OPACITY", target: {clipId: "native", part: "CONTENT"},
    timing: {anchor: "CLIP_END", durationSeconds: 2.5, offsetSeconds: 0.5},
    loop: {mode: "FINITE", cycleDurationSeconds: 1}, keyframes: [
      {offset: 0, values: {opacity: 1}}, {offset: 0.5, values: {opacity: 0}, ease: "power2.inOut"}, {offset: 1, values: {opacity: 1}}]}];
  assert.deepEqual(framesWithReason(document, "at:motion-keyframe:native-motion"), [175, 188, 200, 213, 225, 231, 238]);
  assert.ok(framesWithReason(document, "midpoint:motion-segment:native-motion").length >= 6);
});

test("transition windows include both extended handles, cut and midpoint neighbors", () => {
  const document = createTransitionDocument(), transition = createTransition(document);
  document.transitions = {schemaVersion: 1, items: [transition]};
  assert.deepEqual(framesWithReason(document, `before:transition-start:${transition.id}`), [94]);
  assert.deepEqual(framesWithReason(document, `at:transition-midpoint:${transition.id}`), [100]);
  assert.deepEqual(framesWithReason(document, `after:transition-end:${transition.id}`), [106]);
  assert.deepEqual(framesWithReason(document, `at:runtime-start:${transition.toClipId}`), [95]);
  transition.type = "DIP_TO_COLOR"; transition.parameters = {color: "#000000"};
  assert.deepEqual(framesWithReason(document, `midpoint:transition-segment:${transition.id}-overlay`), [98, 103]);
});

test("plans larger than 48 retain every event in partitions; the first snapshot identifies its partial scope", async () => {
  const {document, clip} = nativeDocument("CAPTION");
  if (clip.source.type !== "NATIVE_CAPTIONS") throw new Error("Expected captions");
  clip.source.cues = Array.from({length: 40}, (_, index) => ({id: `cue-${index}`, startSeconds: index * 0.2,
    endSeconds: index * 0.2 + 0.16, text: "controlled"}));
  const plan = buildCompositionEventCheckpointPlan(document);
  assert.ok(plan.checkpointCount > 48); assert.ok(plan.batches.length > 1);
  const all = plan.batches.flat();
  for (const cue of clip.source.cues) assert.ok(all.some((checkpoint) => checkpoint.reasons.includes(`at:cue-start:native:${cue.id}`)));
  assert.equal(all.length, plan.checkpointCount); assert.ok(plan.batches.every((batch) => batch.length <= 48));
  assert.throws(() => requireSingleEventCheckpointBatch(document), /REQUIRES_BATCH_EXECUTION/);
  const input = {document, documentHash: hashCompositionDocument(document), assets: [], renderProfile: getHyperframesRenderProfile("balanced")};
  const first = buildSnapshotConformanceContract({...input, contractVersion: 4, eventCheckpoints: true});
  if (first.schemaVersion !== 4) throw new Error("Expected v4");
  assert.equal(first.checkpointBatch?.batchCount, plan.batches.length);
  assert.equal(first.checkpointBatch?.totalCheckpointCount, plan.checkpointCount);
  assert.equal(first.checkpointBatch?.batchIndex, 0);
  const selection = selectCompositionEventCheckpointBatch(document, 0);
  for (let index = 0; index < plan.batches.length; index++) {
    const batch = selectCompositionEventCheckpointBatch(document, index);
    assert.equal(batch.batch.planSha256, selection.batch.planSha256);
    assert.deepEqual(batch.checkpoints, plan.batches[index]);
    const selectedContract = buildSnapshotConformanceContract({...input, contractVersion: 4, eventCheckpoints: true, eventBatchIndex: index});
    const source = await buildConformanceReferenceSource({document, contract: selectedContract, assets: []});
    assert.doesNotThrow(() => verifyConformanceReferenceSource(source));
  }
  for (const index of [-1, 0.5, NaN, plan.batches.length]) assert.throws(() => selectCompositionEventCheckpointBatch(document, index), /BATCH_INDEX_INVALID/);
  assert.equal(eventCheckpointBatchSchema.safeParse({...selection.batch, batchCount: 1}).success, false);
  const samples = first.textParity.checkpoints.map((checkpoint) => ({frameIndex: checkpoint.frameIndex,
    meanAbsoluteError: 0, mismatchedPixelRatio: 0, psnrDb: 99, temporalDriftMs: 0, ssim: 1,
    width: first.canvas.width, height: first.canvas.height,
    textParity: {policy: COMPOSITION_TEXT_PARITY_POLICY.id, status: "PASS" as const,
      expectedRegionCount: checkpoint.expectedTexts.length, checkedRegionCount: checkpoint.expectedTexts.length,
      maximumAcceptedDisplacementPixels: 0, regions: checkpoint.expectedTexts.map((text) => ({elementId: text.elementId,
        status: "PASS" as const, reason: null, displacementX: 0, displacementY: 0, meanAbsoluteError: 0, mismatchedPixelRatio: 0}))}}));
  const report = evaluateCompositionConformance({contract: first, samples, previewDocumentHash: input.documentHash, renderDocumentHash: input.documentHash});
  assert.equal(report.status, "INCOMPLETE"); assert.equal(report.checkpointBatchCoverage?.localStatus, "PASS");
  assert.ok(buildSnapshotConformanceContract({...input, contractVersion: 4}).checkpoints.length <= 48);
});

test("complex event ledgers reject capacity overflow instead of truncating or allocating an unbounded plan", () => {
  const {document, clip} = nativeDocument("TEXT", 600);
  document.clips = Array.from({length: 30}, (_, index) => ({...structuredClone(clip), id: `native-${index}`, hfId: `native-${index}`}));
  document.motion.animations = document.clips.map((target, index) => ({id: `loop-${index}`, origin: "USER", propertyGroup: "OPACITY",
    target: {clipId: target.id, part: "CONTENT"}, timing: {anchor: "CLIP_START", durationSeconds: 600, offsetSeconds: 0},
    loop: {mode: "FINITE", cycleDurationSeconds: 0.5}, keyframes: [
      {offset: 0, values: {opacity: 1}}, {offset: 0.5, values: {opacity: 0}}, {offset: 1, values: {opacity: 1}}]}));
  assert.throws(() => buildCompositionEventCheckpointPlan(document), /CAPACITY_EXCEEDED/);
});

test("event policy is frozen and independently recomputed by producer/reader; reuse cannot erase it", async () => {
  const {document} = nativeDocument("TEXT", 2);
  const input = {document, documentHash: hashCompositionDocument(document), assets: [], renderProfile: getHyperframesRenderProfile("balanced")};
  const contract = buildSnapshotConformanceContract({...input, contractVersion: 4, eventCheckpoints: true});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  assert.equal(contract.checkpointPolicy, COMPOSITION_EVENT_CHECKPOINT_POLICY);
  const source = await buildConformanceReferenceSource({document, contract, assets: []});
  assert.doesNotThrow(() => verifyConformanceReferenceSource(source));
  const changed = structuredClone(contract); changed.checkpoints[0]!.reasons = ["forged"];
  await assert.rejects(buildConformanceReferenceSource({document, contract: changed, assets: []}), /EVENT_(PLAN|BATCH)_MISMATCH/);
  const contractJson = JSON.stringify(changed);
  assert.throws(() => verifyConformanceReferenceSource({...source, contractJson, metadata: {...source.metadata,
    contractSha256: createHash("sha256").update(contractJson).digest("hex")}}), /EVENT_(PLAN|BATCH)_MISMATCH/);
  const legacy = buildSnapshotConformanceContract({...input, contractVersion: 4});
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: contract}, legacy), /POLICY_MISMATCH/);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: legacy}, contract), /POLICY_MISMATCH/);
  const calls: unknown[] = [];
  const query = {eq(column: string, value: string) {calls.push([column, value]); return this;}, is(column: string, value: null) {calls.push([column, value]); return this;}};
  restrictSnapshotEventCheckpointReuse(query, contract); restrictSnapshotEventCheckpointReuse(query, legacy);
  assert.deepEqual(calls, [["manifest->conformance_contract->>checkpointPolicy", COMPOSITION_EVENT_CHECKPOINT_POLICY],
    ["manifest->conformance_contract->>checkpointPolicy", null]]);
});
