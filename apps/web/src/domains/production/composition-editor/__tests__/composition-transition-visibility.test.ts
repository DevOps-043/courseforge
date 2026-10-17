import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { gsap } from "gsap";
import { createTransitionDocument } from "./composition-transition-test-fixtures";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { compositionEditorDocumentSchema, NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";
import { buildCompositionTransitionRuntime } from "../composition-transition-runtime";
import { scheduleCompositionTransitions } from "../composition-transition-timeline";
import { buildTextParityCheckpointPlan } from "../composition-text-checkpoint-plan";
import { NATIVE_TRANSITION_VISIBILITY_POLICY as policy, NATIVE_TEXT_APPEARANCE_POLICY as appearancePolicy } from "../composition-text-parity-contract";
import { resolveSnapshotTextVisibilityPolicy, assertSnapshotVisibilityReuse } from "../composition-snapshot-conformance-policy";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { COMPOSITION_TRANSITION_TYPES } from "../composition-transition.types";
import { hashCompositionDocument } from "../composition-document.service";
import { buildConformanceReferenceSource, verifyConformanceReferenceSource } from "../composition-conformance-reference.service";
import { captureTextParityCheckpoint } from "../qa/composition-text-checkpoint-capture";
import { textCheckpointEvidenceSchema } from "../qa/composition-text-parity-evidence";

function documentFixture(type: typeof COMPOSITION_TRANSITION_TYPES[number] = "CROSS_DISSOLVE") {
  const document = createTransitionDocument();
  const first = createCompositionNativeOverlay({document, id: "outgoing", kind: "TEXT", playheadSeconds: 0});
  if (first.track) document.tracks.push(first.track); document.clips.push(first.clip);
  const second = createCompositionNativeOverlay({document, id: "incoming", kind: "TEXT", playheadSeconds: 4});
  if (second.track) document.tracks.push(second.track);
  first.clip.durationSeconds = 4; second.clip.durationSeconds = 4;
  second.clip.layout.zIndex = first.clip.layout.zIndex;
  document.clips = [first.clip, second.clip];
  document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  document.transitions = {schemaVersion: 1, items: [{id: "transition", fromClipId: first.clip.id, toClipId: second.clip.id,
    durationSeconds: 1, alignment: "CENTER_AT_CUT", easing: "power1.inOut", audioMode: "CUT", origin: "USER", type,
    ...(type === "DIP_TO_COLOR" ? {parameters: {color: "#000000"}} : {}),
    ...(type === "PUSH" || type === "SOFT_WIPE" ? {parameters: {direction: "LEFT"}} : {}),
    ...(type === "BLUR_DISSOLVE" ? {parameters: {blurPixels: 20}} : {}),
  }]};
  return compositionEditorDocumentSchema.parse(document);
}

test("transition policy includes both native subjects throughout the verified handle window", () => {
  const document = documentFixture();
  const plan = (time: number) => buildTextParityCheckpointPlan(document, time, policy).expectedTexts;
  assert.equal(plan(3.49).length, 1);
  assert.deepEqual(plan(3.5).map((entry) => entry.visibility), ["VISIBLE", "HIDDEN"]);
  assert.deepEqual(plan(3.75).map((entry) => entry.visibility), ["VISIBLE", "VISIBLE"]);
  assert.equal(plan(4.25).length, 2);
  assert.equal(plan(4.5).length, 1);
  assert.equal(buildTextParityCheckpointPlan(document, 3.75, true).expectedTexts.length, 1);
  assert.equal(buildTextParityCheckpointPlan(document, 4.25, true).expectedTexts.length, 1);
});

test("dip midpoint switches parent visibility exactly, without assuming overlay occlusion from DOM opacity", () => {
  const document = documentFixture("DIP_TO_COLOR");
  const states = (time: number) => buildTextParityCheckpointPlan(document, time, policy).expectedTexts.map((entry) => entry.visibility);
  assert.deepEqual(states(3.75), ["VISIBLE", "HIDDEN"]);
  assert.deepEqual(states(4), ["HIDDEN", "VISIBLE"]);
  assert.deepEqual(states(4.25), ["HIDDEN", "VISIBLE"]);
  assert.deepEqual(states(3.75), ["VISIBLE", "HIDDEN"]);
});

test("all five transition schedulers embed self-contained operations identical to server projection", () => {
  for (const type of COMPOSITION_TRANSITION_TYPES) {
    const runtime = buildCompositionTransitionRuntime(documentFixture(type));
    const rows: unknown[] = [], embeddedRows: unknown[] = [];
    const targets = new Map(["outgoing", "incoming", "transition-overlay"].map((id) => [id, {id}]));
    const adapter = (operations: unknown[]) => ({set(target: object, values: object, position: number) {operations.push(["set", target, values, position]);},
      to(target: object, values: object, position: number) {operations.push(["to", target, values, position]);},
      fromTo(target: object, from: object, to: object, position: number) {operations.push(["fromTo", target, from, to, position]);}});
    scheduleCompositionTransitions(adapter(rows), runtime.items, (id) => targets.get(id));
    runInNewContext(`(${scheduleCompositionTransitions.toString()})(timeline, transitions, resolveTarget)`, {
      timeline: adapter(embeddedRows), transitions: runtime.items, resolveTarget: (id: string) => targets.get(id)});
    assert.equal(JSON.stringify(rows), JSON.stringify(embeddedRows)); assert.ok(rows.length >= 2);
  }
});

test("numeric cross dissolve obeys easing and repeatable reverse seeks", () => {
  const runtime = buildCompositionTransitionRuntime(documentFixture());
  const targets = new Map(["outgoing", "incoming"].map((id) => [id, {autoAlpha: 1}]));
  const timeline = gsap.timeline({paused: true});
  try {
    scheduleCompositionTransitions(timeline, runtime.items, (id) => targets.get(id));
    for (const time of [3.5, 3.75, 4, 4.25, 4.5, 4, 3.5]) {
      timeline.render(time, true, true);
      const progress = gsap.parseEase("power1.inOut")(time - 3.5);
      assert.ok(Math.abs(targets.get("outgoing")!.autoAlpha - (1 - progress)) < 0.000001);
      assert.ok(Math.abs(targets.get("incoming")!.autoAlpha - progress) < 0.000001);
    }
  } finally {timeline.kill();}
});

test("v2 is strict opt-in and is never reused as v1 or policy-absent", () => {
  assert.equal(resolveSnapshotTextVisibilityPolicy(3, "true", "true"), undefined);
  assert.equal(resolveSnapshotTextVisibilityPolicy(4, undefined, "TRUE"), undefined);
  assert.equal(resolveSnapshotTextVisibilityPolicy(4, "true", "true"), policy);
  const input = {document: documentFixture(), assets: [], documentHash: "a".repeat(64), contractVersion: 4 as const,
    renderProfile: {format: "mp4" as const, fps: 25 as const, quality: "high" as const, resolution: "1080p" as const}};
  const v2 = buildSnapshotConformanceContract({...input, visibilityPolicy: policy});
  const v1 = buildSnapshotConformanceContract({...input, motionVisibility: true});
  assert.doesNotThrow(() => assertSnapshotVisibilityReuse({conformance_contract: v2}, v2));
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: v1}, v2), /POLICY_MISMATCH/);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: v2}, v1), /POLICY_MISMATCH/);
});

test("v2 source and capture retain both subjects before the canonical incoming start", async () => {
  const document = documentFixture();
  const contract = buildSnapshotConformanceContract({document, assets: [], documentHash: hashCompositionDocument(document),
    contractVersion: 4, visibilityPolicy: policy, renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  const source = await buildConformanceReferenceSource({document, contract, assets: []});
  assert.equal(verifyConformanceReferenceSource(source).contract.schemaVersion, 4);
  const checkpoint = await captureTextParityCheckpoint({close() {}, async send() {
    return {result: {value: document.clips.map((clip) => ({elementId: `${clip.id}-motion`,
      text: clip.source.type === "NATIVE_TEXT" ? clip.source.text : "", visibility: "VISIBLE",
      left: 10, top: 20, width: 100, height: 40}))}};
  }}, document, 3.76, policy);
  const parsed = textCheckpointEvidenceSchema.parse({...checkpoint, frameIndex: 94, timeSeconds: 3.76});
  assert.equal(parsed.status, "CAPTURED"); assert.equal(parsed.expectedTexts.length, 2); assert.equal(parsed.regions.length, 2);
});

test("appearance policy freezes opacity and opaque overlays without changing v2", async () => {
  const document = documentFixture("DIP_TO_COLOR");
  const expected = buildTextParityCheckpointPlan(document, 4, appearancePolicy).expectedTexts;
  assert.deepEqual(expected.map((text) => text.presentation), [
    {effectiveOpacity: 0, opaqueOverlayIds: ["transition-overlay"]},
    {effectiveOpacity: 1, opaqueOverlayIds: ["transition-overlay"]},
  ]);
  assert.equal(buildTextParityCheckpointPlan(document, 4, policy).expectedTexts[0]!.presentation, undefined);
  assert.equal(buildTextParityCheckpointPlan(document, 3.75, appearancePolicy).expectedTexts[0]!.presentation!.opaqueOverlayIds.length, 0);
  const contract = buildSnapshotConformanceContract({document, assets: [], documentHash: hashCompositionDocument(document),
    contractVersion: 4, visibilityPolicy: appearancePolicy, renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  verifyConformanceReferenceSource(await buildConformanceReferenceSource({document, contract, assets: []}));
  assert.equal(resolveSnapshotTextVisibilityPolicy(4, "true", "true", "true"), appearancePolicy);
  assert.equal(resolveSnapshotTextVisibilityPolicy(3, "true", "true", "true"), undefined);
});
