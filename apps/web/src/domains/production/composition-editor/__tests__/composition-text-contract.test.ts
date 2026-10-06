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
import { captureTextPaintMasks } from "../qa/composition-text-paint-mask-capture";
import { suppressedTextFrameName } from "../qa/composition-text-paint-mask-derivation";

function fixture(visibilityPolicy?: NativeTextVisibilityPolicy, paintMasks = false) {
  const document = createTransitionDocument(); document.canvas.width = 64; document.canvas.height = 48;
  const {clip, track} = createCompositionNativeOverlay({document, id: "native", kind: "TEXT", playheadSeconds: 0});
  if (track) document.tracks.push(track); document.clips.push(clip); document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  const contract = buildSnapshotConformanceContract({document, contractVersion: 4, visibilityPolicy, paintMasks, assets: [], documentHash: "a".repeat(64),
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const evidence: TextParityEvidence = {schemaVersion: 1, policy: policy.id, repeatability: TEXT_PARITY_REPEATABILITY,
    checkpoints: contract.textParity.checkpoints.map((entry) => ({...entry, policy: policy.id, status: "CAPTURED",
      regions: entry.expectedTexts.map((text) => ({...text, left: 8, top: 6, width: 6, height: 8,
        observedBounds: {left: 8, top: 6, right: 14, bottom: 14}})), unavailable: []}))};
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

test("frozen mask policy rejects removal of both witness declarations while legacy contracts remain compatible", () => {
  const legacy = fixture(); validateTextParityEvidence(legacy.evidence, legacy.contract);
  const required = fixture(undefined, true);
  assert.equal(required.contract.textParity.paintMaskPolicy, "NATIVE_TEXT_PAINT_SUPPRESSION_RESTORED_V1");
  assert.throws(() => validateTextParityEvidence(required.evidence, required.contract), /TEXT_PAINT_MASK_REQUIRED/);
  assert.doesNotThrow(() => validateTextParityEvidence(required.evidence, required.contract, "RENDERER_GEOMETRY"));
  const unknownPolicy = structuredClone(required.contract);
  (unknownPolicy.textParity as {paintMaskPolicy?: string}).paintMaskPolicy = "unknown";
  assert.equal(compositionConformanceContractSchema.safeParse(unknownPolicy).success, false);
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
    const browser = {protocolVersion: "1.3", product: "test", revision: "test", userAgent: "test", jsVersion: "test"};
    const controlled = {...contract, renderExecution: {policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1", backend: "CONTROLLED",
      sdkVersion: "0.7.106", expectedBrowser: browser, files: Object.fromEntries(
        ["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"].map(role => [role, {sha256: "b".repeat(64), sizeBytes: 10}]))}};
    await writeFile(contractPath, JSON.stringify(controlled));
    const absentGeometry = await compareCompositionConformanceDirectories(params);
    assert.equal(absentGeometry.textParity!.status, "INCOMPLETE");
    await writeFile(renderMetadataPath, JSON.stringify({...metadata, textParity: evidence}));
    const observedGeometry = await compareCompositionConformanceDirectories(params);
    assert.equal(observedGeometry.textParity!.status, "PASS"); assert.equal(observedGeometry.status, "INCOMPLETE");
    const movedGeometry = structuredClone(evidence);
    movedGeometry.checkpoints[0]!.regions[0]!.left += 2;
    movedGeometry.checkpoints[0]!.regions[0]!.observedBounds!.left += 2;
    movedGeometry.checkpoints[0]!.regions[0]!.observedBounds!.right += 2;
    await writeFile(renderMetadataPath, JSON.stringify({...metadata, textParity: movedGeometry}));
    const geometryFailure = await compareCompositionConformanceDirectories(params);
    assert.equal(geometryFailure.status, "FAIL"); assert.equal(geometryFailure.textParity!.status, "FAIL");
    assert.ok(geometryFailure.failures.some(failure => failure.metric === "text_parity"));
    assert.ok(!geometryFailure.failures.some(failure => failure.metric === "ssim"));
    await writeFile(contractPath, JSON.stringify(contract));
    await writeFile(renderMetadataPath, JSON.stringify(metadata));
    const maskedEvidence = {...evidence, checkpoints: evidence.checkpoints.map((checkpoint, index) => index !== 0
      ? checkpoint : {...checkpoint,
        paintMaskCapture: {policy: "NATIVE_TEXT_PAINT_SUPPRESSION_RESTORED_V1",
          scope: "ALL_NATIVE_TEXT_SUPPRESSED_NOT_PER_GLYPH_CAUSALITY", paintedPngSha256: "a".repeat(64), suppressedPngSha256: "b".repeat(64)},
        regions: checkpoint.regions.map((region) => ({...region, paintMask: {
          scope: "SUPPLEMENTAL_PREVIEW_PAINT_PIXELS_NOT_GLYPH_IDENTITY", width: region.width, height: region.height,
          pixelCount: 0, runs: []}}))})};
    await writeFile(previewMetadataPath, JSON.stringify({...metadata, textParity: maskedEvidence}));
    await assert.rejects(compareCompositionConformanceDirectories(params), /TEXT_PAINT_CAPTURE_FRAME_MISMATCH/);
    const firstPreviewPath = join(previewDirectory, `frame-${evidence.checkpoints[0]!.frameIndex}.png`);
    await writeFile(firstPreviewPath, Buffer.alloc(policy.maximumPaintCapturePngBytes + 1));
    await assert.rejects(compareCompositionConformanceDirectories(params), /TEXT_PAINT_CAPTURE_LIMIT/);
    await writeFile(firstPreviewPath, await sharp(firstGlyph!, {raw: {width: 64, height: 48, channels: 3}}).png().toBuffer());
    await writeFile(previewMetadataPath, JSON.stringify({...metadata, textParity: evidence}));
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

test("file comparator audits paired RGB paint evidence before accepting low-luminance text or rejecting removed paint", async () => {
  const root = await mkdtemp(join(tmpdir(), "text-chromatic-pair-"));
  try {
    const {contract, evidence} = fixture(undefined, true);
    const previewDirectory = join(root, "preview"), renderDirectory = join(root, "render");
    await Promise.all([mkdir(previewDirectory), mkdir(renderDirectory)]);
    const metadata = {documentHash: contract.documentHash, frames: contract.checkpoints.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds}))};
    const suppressed = await sharp(Buffer.alloc(64 * 48 * 3), {raw: {width: 64, height: 48, channels: 3}}).png().toBuffer();
    const checkpoints: TextParityEvidence["checkpoints"] = [];
    let activeFrame: number | undefined;
    for (const checkpoint of evidence.checkpoints) {
      const raw = Buffer.alloc(64 * 48 * 3);
      if (checkpoint.regions.length) {raw[(6 * 64 + 8) * 3 + 2] = 8; activeFrame ??= checkpoint.frameIndex;}
      const painted = await sharp(raw, {raw: {width: 64, height: 48, channels: 3}}).png().toBuffer();
      let screenshots = 0;
      checkpoints.push(await captureTextPaintMasks({send: async () => ({result: {value: true}})} as never,
        {checkpoint, paintedPng: painted, width: 64, height: 48}, async () => screenshots++ === 0 ? suppressed : painted,
        async (png) => {await writeFile(join(previewDirectory, suppressedTextFrameName(checkpoint.frameIndex)), png);}));
      await writeFile(join(previewDirectory, `frame-${checkpoint.frameIndex}.png`), painted);
      await writeFile(join(renderDirectory, `frame-${checkpoint.frameIndex}.png`), painted);
    }
    const contractPath = join(root, "contract.json"), previewMetadataPath = join(root, "preview.json"), renderMetadataPath = join(root, "render.json");
    await writeFile(contractPath, JSON.stringify(contract));
    await writeFile(previewMetadataPath, JSON.stringify({...metadata, textParity: {...evidence, checkpoints}}));
    await writeFile(renderMetadataPath, JSON.stringify(metadata));
    const params = {contractPath, previewDirectory, renderDirectory, previewMetadataPath, renderMetadataPath};
    assert.equal((await compareCompositionConformanceDirectories(params)).status, "PASS");
    assert.notEqual(activeFrame, undefined);
    await writeFile(join(renderDirectory, `frame-${activeFrame}.png`), suppressed);
    const missing = await compareCompositionConformanceDirectories(params);
    assert.equal(missing.status, "FAIL"); assert.equal(missing.textParity!.status, "FAIL");
  } finally {await rm(root, {recursive: true, force: true});}
});
