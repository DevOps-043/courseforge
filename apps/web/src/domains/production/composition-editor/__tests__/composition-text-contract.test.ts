import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTransitionDocument } from "./composition-transition-test-fixtures";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { compositionConformanceContractSchema, evaluateCompositionConformance, resolveSnapshotConformanceContractVersion } from "../composition-preview-render-conformance";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "../composition-text-parity-policy";
import { validateTextParityEvidence, TEXT_PARITY_REPEATABILITY, type TextParityEvidence } from "../qa/composition-text-parity-evidence";
import { compareCompositionConformanceDirectories } from "../qa/composition-conformance-files";
import { textRegionReportSchema, NATIVE_TEXT_APPEARANCE_POLICY, NATIVE_TEXT_GEOMETRY_POLICY, type NativeTextVisibilityPolicy } from "../composition-text-parity-contract";

function fixture(visibilityPolicy?: NativeTextVisibilityPolicy) {
  const document = createTransitionDocument(); document.canvas.width = 64; document.canvas.height = 48;
  const {clip, track} = createCompositionNativeOverlay({document, id: "native", kind: "TEXT", playheadSeconds: 0});
  if (track) document.tracks.push(track); document.clips.push(clip); document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  const contract = buildSnapshotConformanceContract({document, contractVersion: 4, visibilityPolicy, assets: [], documentHash: "a".repeat(64),
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const evidence: TextParityEvidence = {schemaVersion: 1, policy: policy.id, repeatability: TEXT_PARITY_REPEATABILITY,
    checkpoints: contract.textParity.checkpoints.map((entry) => ({...entry, policy: policy.id, status: "CAPTURED",
      regions: entry.expectedTexts.map((text) => ({...text, left: 8, top: 6, width: 6, height: 8})), unavailable: []}))};
  return {contract, evidence};
}

test("v4 freezes native expectations independently, retains audio/SSIM and validates exact plan coverage", () => {
  const {contract, evidence} = fixture(); assert.ok("audio" in contract); assert.equal(contract.visualMetrics.minimumSsim, 0.995);
  assert.equal(contract.textParity.scope, "NATIVE_TEXT_AND_CAPTIONS"); assert.ok(contract.textParity.checkpoints[0]!.expectedTexts.length);
  validateTextParityEvidence(evidence, contract);
  const changed = structuredClone(evidence); changed.checkpoints[0]!.expectedTexts = []; changed.checkpoints[0]!.regions = [];
  assert.throws(() => validateTextParityEvidence(changed, contract), /EXPECTATION_MISMATCH/);
  const plan = structuredClone(contract); plan.textParity.checkpoints.pop();
  assert.equal(compositionConformanceContractSchema.safeParse(plan).success, false);
});

test("private appearance witness cannot invent low opacity even when both declarations agree", () => {
  const {contract, evidence} = fixture(NATIVE_TEXT_APPEARANCE_POLICY);
  validateTextParityEvidence(evidence, contract);
  const changed = structuredClone(evidence);
  changed.checkpoints[0]!.expectedTexts[0]!.presentation!.effectiveOpacity = 0.01;
  changed.checkpoints[0]!.regions[0]!.presentation!.effectiveOpacity = 0.01;
  assert.throws(() => validateTextParityEvidence(changed, contract), /EXPECTATION_MISMATCH/);
  const missingPolicy = structuredClone(contract); delete missingPolicy.textParity.visibilityPolicy;
  assert.equal(compositionConformanceContractSchema.safeParse(missingPolicy).success, false);
  const missingAppearance = structuredClone(contract); delete missingAppearance.textParity.checkpoints[0]!.expectedTexts[0]!.presentation;
  assert.equal(compositionConformanceContractSchema.safeParse(missingAppearance).success, false);
});

test("missing text samples never pass v4 even when global image metrics are perfect", () => {
  const {contract} = fixture(); const samples = contract.checkpoints.map(({frameIndex}) => ({frameIndex, meanAbsoluteError: 0,
    mismatchedPixelRatio: 0, psnrDb: 99, temporalDriftMs: 0, width: 64, height: 48, ssim: 1}));
  const result = evaluateCompositionConformance({contract, samples, previewDocumentHash: contract.documentHash, renderDocumentHash: contract.documentHash});
  assert.equal(result.status, "INCOMPLETE"); assert.equal(result.textParity!.status, "INCOMPLETE");
  assert.ok(result.textParity!.expectedRegionCount > 0); assert.equal(result.textParity!.checkedRegionCount, 0);
  assert.equal(resolveSnapshotConformanceContractVersion(undefined, undefined, "true"), 4);
  assert.equal(resolveSnapshotConformanceContractVersion(undefined, undefined, "TRUE"), 1);
});

test("private geometry witness cannot replace both copies of the frozen pose to invent clipping", () => {
  const {contract, evidence} = fixture(NATIVE_TEXT_GEOMETRY_POLICY);
  validateTextParityEvidence(evidence, contract);
  const altered = structuredClone(evidence);
  const expectedPose = altered.checkpoints[0]!.expectedTexts[0]!.presentation!.paintPose!;
  const regionPose = altered.checkpoints[0]!.regions[0]!.presentation!.paintPose!;
  expectedPose.inset = [0, 1, 0, 0]; expectedPose.support = {empty: true, polygon: []};
  regionPose.inset = [0, 1, 0, 0]; regionPose.support = {empty: true, polygon: []};
  assert.throws(() => validateTextParityEvidence(altered, contract), /EXPECTATION_MISMATCH/);
});

test("metric schema rejects global PASS with failing regions or fabricated local error", () => {
  const report = {policy: policy.id, status: "PASS", checkedRegionCount: 1, expectedRegionCount: 1, maximumAcceptedDisplacementPixels: 0,
    regions: [{elementId: "native-motion", status: "PASS", reason: null, displacementX: 0, displacementY: 0, meanAbsoluteError: 100, mismatchedPixelRatio: 0}]};
  assert.equal(textRegionReportSchema.safeParse(report).success, false);
  report.regions[0]!.meanAbsoluteError = 0; assert.ok(textRegionReportSchema.safeParse(report).success);
  report.regions[0]!.status = "FAIL"; assert.equal(textRegionReportSchema.safeParse(report).success, false);
});

test("PNG production path finds a small glyph change despite passing full-frame metrics", async () => {
  const root = await mkdtemp(join(tmpdir(), "text-contract-png-"));
  try {
    const {contract, evidence} = fixture(); const previewDirectory = join(root, "preview"), renderDirectory = join(root, "render");
    await Promise.all([mkdir(previewDirectory), mkdir(renderDirectory)]);
    const metadata = {documentHash: contract.documentHash, frames: contract.checkpoints.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds}))};
    const contractPath = join(root, "contract.json"), previewMetadataPath = join(root, "preview.json"), renderMetadataPath = join(root, "render.json");
    await writeFile(contractPath, JSON.stringify(contract)); await writeFile(previewMetadataPath, JSON.stringify({...metadata, textParity: evidence}));
    await writeFile(renderMetadataPath, JSON.stringify(metadata));
    let firstGlyph: Buffer | undefined;
    for (const checkpoint of evidence.checkpoints) {
      const image = Buffer.alloc(64 * 48 * 3, 64);
      if (checkpoint.regions.length) for (let y = 6; y < 14; y++) for (let x = 8; x < 14; x++) {
        if (x === 8 || y === 6 || y === 10) image.fill(200, (y * 64 + x) * 3, (y * 64 + x + 1) * 3);
      }
      const png = await sharp(image, {raw: {width: 64, height: 48, channels: 3}}).png().toBuffer();
      await writeFile(join(previewDirectory, `frame-${checkpoint.frameIndex}.png`), png);
      await writeFile(join(renderDirectory, `frame-${checkpoint.frameIndex}.png`), png);
      if (checkpoint === evidence.checkpoints[0]) firstGlyph = image;
    }
    const params = {contractPath, previewDirectory, renderDirectory, previewMetadataPath, renderMetadataPath};
    assert.equal((await compareCompositionConformanceDirectories(params)).status, "PASS");
    firstGlyph!.fill(180, (6 * 64 + 8) * 3, (6 * 64 + 8) * 3 + 3);
    const changedPng = await sharp(firstGlyph!, {raw: {width: 64, height: 48, channels: 3}}).png().toBuffer();
    await writeFile(join(renderDirectory, `frame-${evidence.checkpoints[0]!.frameIndex}.png`), changedPng);
    const failed = await compareCompositionConformanceDirectories(params);
    assert.equal(failed.status, "FAIL"); assert.equal(failed.textParity!.status, "FAIL");
    assert.ok(failed.failures.some((failure) => failure.metric === "text_parity"));
    assert.ok(!failed.failures.some((failure) => ["ssim", "mean_absolute_error", "mismatched_pixel_ratio", "psnr_db"].includes(failure.metric)));
    await writeFile(previewMetadataPath, JSON.stringify(metadata));
    assert.equal((await compareCompositionConformanceDirectories(params)).textParity!.status, "INCOMPLETE");
  } finally {await rm(root, {recursive: true, force: true});}
});
