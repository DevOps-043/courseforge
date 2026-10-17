import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buildDeckConformanceCorpusCase } from "../qa/composition-deck-conformance-corpus";
import { hashDeckTextPlan, selectDeckTextCheckpointClips } from "../composition-deck-text-plan";
import { captureDeckTextCheckpoint } from "../qa/composition-deck-text-capture";
import { validateDeckTextEvidence, hashDeckTextEvidence } from "../qa/composition-deck-text-evidence";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import type { CompositionQaCdpClient } from "../qa/composition-qa-browser";

function fixture() {
  const corpus = buildDeckConformanceCorpusCase("deck-basic", 25);
  const contract = buildSnapshotConformanceContract({document: corpus.document, documentHash: corpus.documentHash,
    assets: [], contractVersion: 4, deckText: true,
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const text = {nodeType: 3, textContent: corpus.expectationLedger.entries[0]!.expectedText, parentElement: null as unknown};
  const parent = {parentElement: null, childNodes: [text]}; text.parentElement = parent;
  const root = {childNodes: [{nodeType: 1, childNodes: []}, parent]};
  const owner = {querySelectorAll: () => [root]};
  const environment = {CSS: {escape: (value: string) => value},
    document: {querySelectorAll: () => [owner], createRange: () => ({selectNode: () => {}, detach: () => {},
      getBoundingClientRect: () => ({left: 8.2, top: 6.5, right: 14.1, bottom: 12.2})})},
    getComputedStyle: () => ({opacity: "1", display: "block", visibility: "visible"})};
  const client = {send: async (_method: string, params: {expression: string}) => ({result: {
    value: JSON.parse(JSON.stringify(runInNewContext(params.expression, environment))),
  }})} as unknown as CompositionQaCdpClient;
  return {corpus, contract, text, environment, client};
}

test("browser read follows source paths without relying on text element IDs and persists hashes only", async () => {
  const {corpus, client} = fixture();
  const captured = await captureDeckTextCheckpoint(client, corpus.sourceTextPlan, 0, 1920, 1080);
  assert.equal(captured.status, "CAPTURED");
  assert.deepEqual(captured.regions[0]!.nodePath, [1, 0]);
  assert.deepEqual([captured.regions[0]!.left, captured.regions[0]!.top, captured.regions[0]!.width, captured.regions[0]!.height], [8, 6, 7, 7]);
  assert.ok(!JSON.stringify(captured).includes(corpus.expectationLedger.entries[0]!.expectedText));
});

test("changed content rejects, while missing and invisible nodes remain incomplete", async () => {
  const state = fixture();
  state.text.textContent = "altered";
  await assert.rejects(captureDeckTextCheckpoint(state.client, state.corpus.sourceTextPlan, 0, 1920, 1080), /CONTENT_MISMATCH/);
  state.text.textContent = state.corpus.expectationLedger.entries[0]!.expectedText;
  state.environment.getComputedStyle = () => ({opacity: "0", display: "block", visibility: "visible"});
  const hidden = await captureDeckTextCheckpoint(state.client, state.corpus.sourceTextPlan, 0, 1920, 1080);
  assert.equal(hidden.status, "INCOMPLETE"); assert.equal(hidden.unavailable[0]!.reason, "ELEMENT_NOT_VISIBLE");
  state.environment.document.querySelectorAll = () => [];
  const missing = await captureDeckTextCheckpoint(state.client, state.corpus.sourceTextPlan, 0, 1920, 1080);
  assert.equal(missing.status, "INCOMPLETE"); assert.equal(missing.unavailable[0]!.reason, "ROOT_MISSING");
});

test("duplicate clip IDs cannot silently select an unrelated deck root", async () => {
  const state = fixture(); const original = state.environment.document.querySelectorAll;
  state.environment.document.querySelectorAll = () => [...original(), ...original()];
  const captured = await captureDeckTextCheckpoint(state.client, state.corpus.sourceTextPlan, 0, 1920, 1080);
  assert.equal(captured.status, "INCOMPLETE"); assert.equal(captured.unavailable[0]!.reason, "ROOT_MISSING");
});

test("additional meaningful DOM text cannot hide behind matching source paths", async () => {
  const state = fixture();
  const root = state.environment.document.querySelectorAll()[0]!.querySelectorAll()[0]!;
  const extra = {nodeType: 3, textContent: "unexpected", parentElement: null};
  root.childNodes.push({nodeType: 1, childNodes: [extra]} as never);
  await assert.rejects(captureDeckTextCheckpoint(state.client, state.corpus.sourceTextPlan, 0, 1920, 1080), /DOM_COVERAGE_MISMATCH/);
});

test("half-open authored runtime windows select the incoming deck exactly at the cut", () => {
  const {sourceTextPlan} = buildDeckConformanceCorpusCase("deck-cut", 25);
  assert.equal(selectDeckTextCheckpointClips(sourceTextPlan, 3.99)[0]!.clipId, sourceTextPlan.clips[0]!.clipId);
  assert.equal(selectDeckTextCheckpointClips(sourceTextPlan, 4)[0]!.clipId, sourceTextPlan.clips[1]!.clipId);
  assert.deepEqual(selectDeckTextCheckpointClips(sourceTextPlan, 8), []);
});

test("evidence binds every checkpoint, source hash, node address and geometry without certifying paint", async () => {
  const state = fixture();
  const checkpoints = [];
  for (const checkpoint of state.contract.checkpoints) checkpoints.push({frameIndex: checkpoint.frameIndex,
    timeSeconds: checkpoint.timeSeconds, ...await captureDeckTextCheckpoint(state.client, state.corpus.sourceTextPlan, checkpoint.timeSeconds, 1920, 1080)});
  const evidence = {policy: "DECK_SOURCE_NODE_CAPTURE_V1", scope: "PREVIEW_TEXT_CONTENT_GEOMETRY_NOT_PAINT_OR_RENDER_FONT_EVIDENCE",
    documentHash: state.corpus.documentHash, planSha256: hashDeckTextPlan(state.corpus.sourceTextPlan),
    repeatability: "EXACT_DECK_TEXT_GEOMETRY_FORWARD_REVERSE_V1", checkpoints};
  validateDeckTextEvidence(evidence, state.contract);
  assert.match(hashDeckTextEvidence(evidence), /^[a-f0-9]{64}$/);
  assert.throws(() => validateDeckTextEvidence(undefined, state.contract), /EVIDENCE_REQUIRED/);
  const omitted = structuredClone(evidence); omitted.checkpoints[0]!.regions = [];
  assert.throws(() => validateDeckTextEvidence(omitted, state.contract), /EXPECTATIONS_MISMATCH/);
  const changed = structuredClone(evidence); changed.checkpoints[0]!.regions[0]!.nodePath = [0];
  assert.throws(() => validateDeckTextEvidence(changed, state.contract), /EXPECTATIONS_MISMATCH/);
  const outside = structuredClone(evidence); outside.checkpoints[0]!.regions[0]!.left = 1920;
  assert.throws(() => validateDeckTextEvidence(outside, state.contract), /GEOMETRY_LIMIT/);
});
