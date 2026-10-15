import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { compareCompositionConformanceDirectories, measureCompositionConformanceDirectories } from "../qa/composition-conformance-files";
import { TEXT_PARITY_REPEATABILITY } from "../qa/composition-text-parity-evidence";
import { evaluateExportedColorTags, EXPORTED_COLOR_TAG_POLICY, exportedColorTagReportSchema,
  readExportedColorTags, resolveExportedColorTagPolicyId } from "../qa/composition-exported-color-tags";
import { evaluateExportedVideoConformanceStatus, parseExportedVideoProbe } from "../qa/composition-exported-video-conformance";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { assertConformanceReportMatchesContract } from "../qa/composition-conformance-contract-report-gate";
import { evaluateCompositionConformance, compositionConformanceContractSchema } from "../composition-preview-render-conformance";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { getHyperframesRenderProfile } from "../../hyperframes/hyperframes-render-profiles";
const tags = {matrix: "bt709", primaries: "bt709", transfer: "bt709", range: "tv"};

test("probe retains only bounded video color declarations; audio tags do not substitute for video", () => {
  const probe = parseExportedVideoProbe({format: {duration: "2"}, streams: [
    {codec_type: "audio", color_space: "bt2020nc"},
    {codec_type: "video", width: 160, height: 90, avg_frame_rate: "25/1", color_space: "bt709",
      color_primaries: "bt709", color_transfer: "bt709", color_range: "tv", privateUrl: "not-persisted"},
  ]});
  assert.deepEqual(probe.colorTags, tags);
  assert.deepEqual(readExportedColorTags({}), {matrix: null, primaries: null, transfer: null, range: null});
  for (const value of [5, "", "x".repeat(65), "private\nvalue", "https://private.invalid"]) {
    assert.throws(() => readExportedColorTags({color_space: value}), /^Error: EXPORTED_COLOR_TAG_MEASUREMENT_INVALID$/);
  }
});

test("explicit Rec709 tag policy accepts declared full or limited range without claiming conversion proof", () => {
  for (const range of ["tv", "pc"]) {
    const report = evaluateExportedColorTags({...tags, range}, EXPORTED_COLOR_TAG_POLICY);
    assert.equal(report.status, "TAGS_MATCH");
    assert.equal(report.scope, "ENCODED_STREAM_TAGS_NOT_PIXEL_CONVERSION_OR_DISPLAY_PROFILE");
    assert.deepEqual(exportedColorTagReportSchema.parse(report), report);
  }
  assert.equal(evaluateExportedColorTags(tags).status, "MEASURED_POLICY_NOT_SET");
  assert.equal(resolveExportedColorTagPolicyId(undefined), undefined);
  assert.throws(() => resolveExportedColorTagPolicyId("pretend-converted"), /POLICY_INVALID/);
});

test("missing or unspecified color cannot pass; mismatched matrix, HDR transfer or primaries fail", () => {
  for (const key of ["matrix", "primaries", "transfer", "range"] as const) {
    for (const value of [null, "unknown", "unspecified", "reserved"]) {
      const report = evaluateExportedColorTags({...tags, [key]: value}, EXPORTED_COLOR_TAG_POLICY);
      assert.equal(report.status, "INCOMPLETE"); assert.deepEqual(report.missing, [key]);
    }
    const report = evaluateExportedColorTags({...tags, [key]: key === "transfer" ? "smpte2084" : "bt2020"}, EXPORTED_COLOR_TAG_POLICY);
    assert.equal(report.status, "FAIL"); assert.deepEqual(report.mismatched, [key]);
  }
  assert.equal(evaluateExportedColorTags({...tags, matrix: null, transfer: "arib-std-b67"}, EXPORTED_COLOR_TAG_POLICY).status, "FAIL");
});

test("durable tag report recalculates status and exact diagnostics rather than trusting an asserted result", () => {
  const report = evaluateExportedColorTags({...tags, primaries: "bt2020"}, EXPORTED_COLOR_TAG_POLICY);
  for (const patch of [{status: "TAGS_MATCH"}, {mismatched: []}, {mismatched: ["primaries", "primaries"]},
    {missing: ["range"]}, {scope: "PIXEL_CONVERSION_PROVEN"}, {policy: "unknown"}]) {
    assert.equal(exportedColorTagReportSchema.safeParse({...report, ...patch}).success, false);
  }
});

test("color gate combines with visual/audio failures without promoting missing evidence to PASS", () => {
  const base = {audioStatus: "NOT_REQUIRED" as const, audioLoudnessStatus: "NOT_APPLICABLE" as const, visualStatus: "PASS" as const};
  assert.equal(evaluateExportedVideoConformanceStatus({...base, colorTagStatus: "FAIL"}), "FAIL");
  assert.equal(evaluateExportedVideoConformanceStatus({...base, colorTagStatus: "INCOMPLETE"}), "INCOMPLETE");
  assert.equal(evaluateExportedVideoConformanceStatus({...base, visualStatus: "FAIL", colorTagStatus: "INCOMPLETE"}), "FAIL");
  assert.equal(evaluateExportedVideoConformanceStatus({...base, colorTagStatus: "TAGS_MATCH"}), "PASS");
  assert.equal(evaluateExportedVideoConformanceStatus(base), "PASS");
});

test("frozen v4 tag obligation is opt-in, independent of caller policy and required with perfect samples", () => {
  const document = createInitialCompositionDocument({sourceInsertionMode: "MANUAL", animatedDeck: null, assets: [],
    plan: {title: "Color", subtitle: "Frozen", accentColor: "#38BDF8", durationSeconds: 5}});
  const input = {document, documentHash: "a".repeat(64), assets: [], renderProfile: getHyperframesRenderProfile("balanced")};
  for (const contractVersion of [1, 2, 3] as const) {
    assert.equal("colorTagPolicy" in buildSnapshotConformanceContract({...input, contractVersion, colorTags: true}), false);
  }
  const legacy = buildSnapshotConformanceContract({...input, contractVersion: 4});
  assert.equal("colorTagPolicy" in legacy, false);
  const contract = buildSnapshotConformanceContract({...input, contractVersion: 4, colorTags: true});
  assert.equal(contract.schemaVersion === 4 && contract.colorTagPolicy, EXPORTED_COLOR_TAG_POLICY);
  assert.equal(compositionConformanceContractSchema.safeParse({...contract, colorTagPolicy: "unknown"}).success, false);
  const evaluation = {contract, previewDocumentHash: input.documentHash, renderDocumentHash: input.documentHash,
    samples: contract.checkpoints.map((checkpoint) => ({frameIndex: checkpoint.frameIndex, meanAbsoluteError: 0,
      mismatchedPixelRatio: 0, psnrDb: 99, temporalDriftMs: 0, ssim: 1, width: document.canvas.width, height: document.canvas.height,
      textParity: {policy: COMPOSITION_TEXT_PARITY_POLICY.id, status: "PASS" as const, expectedRegionCount: 0, checkedRegionCount: 0,
        maximumAcceptedDisplacementPixels: 0, regions: []}}))};
  const missing = evaluateCompositionConformance(evaluation);
  assert.equal(missing.status, "INCOMPLETE"); assert.equal(missing.colorTags?.status, "INCOMPLETE");
  const observedWithoutPolicy = evaluateExportedColorTags(tags);
  const matched = evaluateCompositionConformance({...evaluation, renderColorTags: observedWithoutPolicy});
  assert.equal(matched.status, "INCOMPLETE"); assert.equal(matched.colorTags?.policy, EXPORTED_COLOR_TAG_POLICY);
  assert.ok(matched.incompletenessReasons?.includes("SDR_PIXEL_CONVERSION_UNATTESTED"));
  assertConformanceReportMatchesContract(contract, matched);
  assert.throws(() => assertConformanceReportMatchesContract(contract, {...matched, status: "PASS"}), /SDR_CONVERSION_ATTESTATION_PENDING/);
  assert.throws(() => assertConformanceReportMatchesContract(contract, {...matched, colorTags: {
    ...matched.colorTags!, tags: {...matched.colorTags!.tags, transfer: "smpte2084"}}}), /COLOR_TAG_CONTRACT/);
  assert.throws(() => assertConformanceReportMatchesContract(contract, {...missing, status: "PASS"}), /SDR_CONVERSION_ATTESTATION_PENDING/);
  assert.throws(() => assertConformanceReportMatchesContract(contract, {...matched,
    incompletenessReasons: []}), /SDR_CONVERSION_ATTESTATION_PENDING/);
  const mismatch = evaluateCompositionConformance({...evaluation, renderColorTags: evaluateExportedColorTags({...tags, transfer: "smpte2084"})});
  assert.equal(mismatch.status, "FAIL"); assert.equal(mismatch.colorTags?.status, "FAIL");
  assert.throws(() => assertConformanceReportMatchesContract(contract, {...mismatch, status: "INCOMPLETE"}), /COLOR_TAG_FAILURE/);
  assert.equal(evaluateCompositionConformance({...evaluation, contract: legacy}).status, "PASS");
});

test("directory comparator consumes render tags and cannot substitute preview tags for missing render evidence", async () => {
  const document = createInitialCompositionDocument({sourceInsertionMode: "MANUAL", animatedDeck: null, assets: [],
    plan: {title: "Color", subtitle: "Frozen", accentColor: "#38BDF8", durationSeconds: 2}});
  document.canvas.width = 160; document.canvas.height = 90;
  const documentHash = "a".repeat(64);
  const contract = buildSnapshotConformanceContract({document, documentHash, assets: [],
    renderProfile: getHyperframesRenderProfile("balanced"), contractVersion: 4, colorTags: true});
  const directory = await mkdtemp(join(tmpdir(), "conformance-color-directory-"));
  const previewDirectory = join(directory, "preview"), renderDirectory = join(directory, "render");
  const contractPath = join(directory, "contract.json"), previewMetadataPath = join(directory, "preview.json"), renderMetadataPath = join(directory, "render.json");
  try {
    await mkdir(previewDirectory); await mkdir(renderDirectory);
    const png = await sharp({create: {width: 160, height: 90, channels: 3, background: "#123456"}}).png().toBuffer();
    for (const checkpoint of contract.checkpoints) {
      await writeFile(join(previewDirectory, `frame-${checkpoint.frameIndex}.png`), png);
      await writeFile(join(renderDirectory, `frame-${checkpoint.frameIndex}.png`), png);
    }
    await writeFile(contractPath, JSON.stringify(contract));
    const metadata = {documentHash, frames: contract.checkpoints.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds}))};
    const textParity = {schemaVersion: 1, policy: COMPOSITION_TEXT_PARITY_POLICY.id, repeatability: TEXT_PARITY_REPEATABILITY,
      checkpoints: metadata.frames.map((frame) => ({...frame, policy: COMPOSITION_TEXT_PARITY_POLICY.id,
        status: "CAPTURED", expectedTexts: [], regions: [], unavailable: []}))};
    await writeFile(previewMetadataPath, JSON.stringify({...metadata, textParity, colorTags: evaluateExportedColorTags(tags, EXPORTED_COLOR_TAG_POLICY)}));
    const input = {contractPath, previewDirectory, renderDirectory, previewMetadataPath, renderMetadataPath};
    await writeFile(renderMetadataPath, JSON.stringify(metadata));
    assert.equal((await compareCompositionConformanceDirectories(input)).status, "INCOMPLETE");
    await writeFile(renderMetadataPath, JSON.stringify({...metadata, colorTags: evaluateExportedColorTags(tags)}));
    assert.equal((await compareCompositionConformanceDirectories(input)).status, "INCOMPLETE");
    const measured = await measureCompositionConformanceDirectories(input);
    assert.equal(measured.report.status, "INCOMPLETE");
    assert.equal(measured.measurements.samples.length, contract.checkpoints.length);
    assert.equal(measured.measurements.previewDocumentHash, documentHash);
    assert.equal(measured.measurements.renderDocumentHash, documentHash);
    assert.equal(measured.measurements.renderColorTags?.status, "MEASURED_POLICY_NOT_SET");
    assert.ok(measured.measurements.samples.every((sample) => sample.ssim === 1 && sample.meanAbsoluteError === 0
      && sample.textParity?.status === "PASS"));
    await writeFile(renderMetadataPath, JSON.stringify({...metadata, colorTags: evaluateExportedColorTags({...tags, transfer: "smpte2084"})}));
    assert.equal((await compareCompositionConformanceDirectories(input)).status, "FAIL");
  } finally {await rm(directory, {recursive: true, force: true});}
});
