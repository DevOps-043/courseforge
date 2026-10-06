import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import sharp from "sharp";
import { buildNativeTextPaintPose } from "../composition-text-paint-pose";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "../composition-text-parity-policy";
import { readTextParityDom } from "../qa/composition-text-checkpoint-capture";
import { validateOffcanvasTextPaintSeed } from "../qa/composition-text-paint-seed";
import { textCheckpointEvidenceSchema, validateTextParityEvidence, TEXT_PARITY_REPEATABILITY } from "../qa/composition-text-parity-evidence";
import { captureTextPaintMasks } from "../qa/composition-text-paint-mask-capture";
import { verifyTextPaintMaskPair } from "../qa/composition-text-paint-mask-derivation";
import { compareTextParityRegions } from "../qa/composition-text-region-comparison";
import { buildCompositionConformanceContract, compositionConformanceContractSchema } from "../composition-preview-render-conformance";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { NATIVE_TEXT_GEOMETRY_POLICY } from "../composition-text-parity-contract";

const width = 8, height = 8;
const pose = buildNativeTextPaintPose("native", {canvas: {width, height},
  layout: {x: -6, y: 2, width: 4, height: 4, rotation: 0}, motion: {x: 0, y: 0, scale: 1, rotation: 0},
  transition: {xPercent: 0, yPercent: 0, clipPath: "none"}}, "blur(2px)");
const paintSeed = {policy: "OFFCANVAS_FILTERED_PAINT_SEED_V1", originalBounds: {left: -6, top: 2, right: -2, bottom: 6}};
test("DOM reader preserves offcanvas bounds and allocates a seed only under explicit filtered-paint opt-in", () => {
  const context = {limits: policy, presentation: {"native-motion": {effectiveOpacity: 1, opaqueOverlayIds: [], paintPose: pose}},
    document: {getElementById: () => ({parentElement: null, textContent: "Texto"}),
      createRange: () => ({selectNodeContents() {}, detach() {}, getBoundingClientRect: () => paintSeed.originalBounds})},
    getComputedStyle: () => ({opacity: "1", display: "flex", visibility: "visible"})};
  const expression = `(${readTextParityDom.toString()})(["native-motion"],8,8,limits,{"native-motion":"VISIBLE"},presentation`;
  assert.equal(runInNewContext(`${expression},false)`, context)[0].unavailable, "TEXT_OUTSIDE_CANVAS");
  const row = runInNewContext(`${expression},true)`, context)[0];
  assert.equal(row.left, 0); assert.equal(row.top, 2); assert.equal(row.width, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(row.paintSeed)), paintSeed);
  assert.throws(() => validateOffcanvasTextPaintSeed({...paintSeed, policy: "OFFCANVAS_FILTERED_PAINT_SEED_V1",
    originalBounds: {left: 1, top: 1, right: 2, bottom: 2}}, width, height), /SEED_INVALID/);
});
test("observed offcanvas halo expands and measures; empty paint remains incomplete and altered base seed is rejected", async () => {
  const raw = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) raw[pixel * 4 + 3] = 255;
  const suppressed = await sharp(raw, {raw: {width, height, channels: 4}}).png().toBuffer();
  const expected = {elementId: "native-motion", textSha256: "a".repeat(64), visibility: "VISIBLE" as const,
    presentation: {effectiveOpacity: 1, opaqueOverlayIds: [], paintPose: pose}};
  const checkpoint = textCheckpointEvidenceSchema.parse({frameIndex: 0, timeSeconds: 0, policy: policy.id, status: "CAPTURED",
    expectedTexts: [expected], unavailable: [], regions: [{...expected, left: 0, top: 2, width: 1, height: 1, paintSeed}]});
  const capture = async (painted: Buffer) => {
    let count = 0;
    return captureTextPaintMasks({send: async () => ({result: {value: true}})} as never,
      {checkpoint, paintedPng: painted, width, height}, async () => Buffer.from(count++ === 0 ? suppressed : painted));
  };
  const empty = await capture(suppressed);
  assert.equal(compareTextParityRegions({preview: raw, rendered: raw, width, height, channels: 4,
    expectedTexts: [expected], regions: empty.regions}).status, "INCOMPLETE");
  raw[(3 * width + 1) * 4 + 2] = 8;
  const painted = await sharp(raw, {raw: {width, height, channels: 4}}).png().toBuffer();
  const result = await capture(painted);
  assert.equal(result.regions[0]!.width, 2); assert.equal(result.regions[0]!.height, 2);
  await verifyTextPaintMaskPair({checkpoint: result, paintedPng: painted, suppressedPng: suppressed, width, height});
  const document = createInitialCompositionDocument({sourceInsertionMode: "MANUAL", animatedDeck: null, assets: [],
    plan: {title: "Seed", subtitle: "Controlled", accentColor: "#38BDF8", durationSeconds: 5}});
  const base = buildCompositionConformanceContract({document, assets: [], documentHash: "a".repeat(64), contractVersion: 3,
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  const contract = compositionConformanceContractSchema.parse({...base, schemaVersion: 4, canvas: {...base.canvas, width, height},
    checkpoints: [{frameIndex: 0, timeSeconds: 0, reasons: ["CONTROLLED"]}],
    textParity: {policy: policy.id, scope: "NATIVE_TEXT_AND_CAPTIONS", visibilityPolicy: NATIVE_TEXT_GEOMETRY_POLICY,
      paintMaskPolicy: "NATIVE_TEXT_PAINT_SUPPRESSION_RESTORED_V1", paintRegionExpansionPolicy: "JOINT_NATIVE_PAINT_DELTA_NEAREST_ROI_V1",
      paintOffcanvasSeedPolicy: "OFFCANVAS_FILTERED_PAINT_SEED_V1", checkpoints: [{frameIndex: 0, timeSeconds: 0, expectedTexts: [expected]}]}});
  const evidence = {schemaVersion: 1, policy: policy.id, repeatability: TEXT_PARITY_REPEATABILITY, checkpoints: [result]};
  validateTextParityEvidence(evidence, contract);
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const legacy = structuredClone(contract); delete legacy.textParity.paintOffcanvasSeedPolicy;
  assert.throws(() => validateTextParityEvidence(evidence, legacy), /SEED_CONTRACT_INVALID/);
  assert.equal(compareTextParityRegions({preview: raw, rendered: raw, width, height, channels: 4,
    expectedTexts: [expected], regions: result.regions}).status, "PASS");
  const altered = structuredClone(result); altered.paintMaskCapture!.sourceRegions![0]!.left = 1;
  assert.throws(() => validateTextParityEvidence({...evidence, checkpoints: [altered]}, contract), /SEED_INVALID/);
  await assert.rejects(verifyTextPaintMaskPair({checkpoint: altered, paintedPng: painted, suppressedPng: suppressed, width, height}), /SEED_INVALID/);
});
