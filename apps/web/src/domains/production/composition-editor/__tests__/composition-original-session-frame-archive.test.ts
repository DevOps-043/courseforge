import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, rm, writeFile, readdir, mkdir, readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import sharp from "sharp";
import {createInitialCompositionDocument} from "../composition-document.factory";
import {hashCompositionDocument} from "../composition-document.service";
import {buildSnapshotConformanceContract} from "../composition-snapshot-conformance-contract";
import {createOriginalSessionFrameArchive, ORIGINAL_FRAME_ARCHIVE_DIRECTORY} from "../qa/composition-original-session-frame-archive";
import {SDR_FRAME_CONVERSION_POLICY} from "../composition-sdr-conversion-policy";
import {controlledExecutionFilesSchema} from "../composition-render-execution-contract";

function contractFixture() {
  const document = createInitialCompositionDocument({animatedDeck: null, assets: [], sourceInsertionMode: "MANUAL",
    plan: {accentColor: "#38BDF8", durationSeconds: 1, title: "Archive", subtitle: "Original"}});
  document.canvas.width = 2; document.canvas.height = 2; document.canvas.durationSeconds = 0.08;
  const identity = {sha256: "a".repeat(64), sizeBytes: 10};
  return buildSnapshotConformanceContract({document, documentHash: hashCompositionDocument(document), assets: [], contractVersion: 4, colorTags: true,
    renderExecution: {policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1", backend: "CONTROLLED", sdkVersion: "0.7.106",
      files: controlledExecutionFilesSchema.parse(Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"].map(role => [role, identity]))),
      expectedBrowser: {protocolVersion: "1.3", product: "test", revision: "test", userAgent: "test", jsVersion: "test"},
      comparisonTools: {policy: "EXPLICIT_PIXEL_DECODER_AND_PROBE_V1", pixelDecoder: identity, probe: identity},
      sdrConversionPolicy: SDR_FRAME_CONVERSION_POLICY.id},
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
}
const pngFixture = () => sharp({create: {width: 2, height: 2, channels: 4,
  background: {r: 40, g: 20, b: 10, alpha: 1}}}).png().toBuffer();

test("archive snapshots borrowed bytes before asynchronous work and rejects source drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-forward-snapshot-"));
  try {
    let sourceChanged = false;
    const capture = createOriginalSessionFrameArchive({outputDirectory: root, contract: contractFixture(),
      signal: new AbortController().signal, verifyFiles: async () => {if (sourceChanged) throw new Error("source changed");}});
    const borrowed = await pngFixture(), expected = Buffer.from(borrowed);
    const writing = capture.captureFrame(0, 0, borrowed);
    borrowed.fill(0);
    await writing;
    assert.deepEqual(await readFile(join(root, ORIGINAL_FRAME_ARCHIVE_DIRECTORY, "frame_000000.png")), expected);
    await capture.captureFrame(1, 1 / 25, expected);
    const archived = await capture.finalize();
    sourceChanged = true;
    await assert.rejects(archived.assertUnchanged(), /source changed/);
    await assert.rejects(capture.finalize(), /FINALIZATION_FAILED/);
  } finally {await rm(root, {recursive: true, force: true});}
});

test("concurrent capture invalidates the archive instead of publishing a partial sequence", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-forward-concurrent-"));
  try {
    const capture = createOriginalSessionFrameArchive({outputDirectory: root, contract: contractFixture(),
      signal: new AbortController().signal, verifyFiles: async () => {}});
    const png = await pngFixture();
    const first = capture.captureFrame(0, 0, png);
    const concurrent = capture.captureFrame(0, 0, png);
    const outcomes = await Promise.allSettled([first, concurrent]);
    assert.ok(outcomes.every(outcome => outcome.status === "rejected"));
    await assert.rejects(capture.finalize(), /FINALIZATION_FAILED|CAPTURE_FAILED/);
  } finally {await rm(root, {recursive: true, force: true});}
});

test("archive writes only original forward frames and returns a recheckable opaque sequence", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-forward-archive-"));
  try {
    const capture = createOriginalSessionFrameArchive({outputDirectory: root, contract: contractFixture(),
      signal: new AbortController().signal, verifyFiles: async () => {}});
    const png = await pngFixture();
    await capture.captureFrame(0, 0, png); await capture.captureFrame(1, 1 / 25, png);
    const archived = await capture.finalize();
    assert.deepEqual(await readdir(archived.directory), ["frame_000000.png", "frame_000001.png"]);
    assert.equal(archived.sequence.frameCount, 2);
    assert.equal(archived.sequence.totalBytes, png.length * 2);
    assert.equal(archived.sequence.scope, "LOCAL_RECHECKS_NOT_IMMUTABLE_CAPTURE_OR_COLOR_ATTESTATION");
    await archived.assertUnchanged();
    await writeFile(join(archived.directory, "frame_000000.png"), Buffer.alloc(png.length));
    await assert.rejects(archived.assertUnchanged(), /CONFORMANCE_FILE_/);
    await assert.rejects(capture.finalize(), /FINALIZATION_FAILED/);
  } finally {await rm(root, {recursive: true, force: true});}
});

test("archive rejects gaps, duplicate/reverse frames and incomplete finalization", async () => {
  for (const mode of ["gap", "duplicate", "incomplete"]) {
    const root = await mkdtemp(join(tmpdir(), "cf-forward-order-"));
    try {
      const capture = createOriginalSessionFrameArchive({outputDirectory: root, contract: contractFixture(),
        signal: new AbortController().signal, verifyFiles: async () => {}});
      const png = await pngFixture();
      if (mode === "gap") await assert.rejects(capture.captureFrame(1, 1 / 25, png), /CAPTURE_FAILED/);
      else {
        await capture.captureFrame(0, 0, png);
        if (mode === "duplicate") await assert.rejects(capture.captureFrame(0, 0, png), /CAPTURE_FAILED/);
      }
      await assert.rejects(capture.finalize());
    } finally {await rm(root, {recursive: true, force: true});}
  }
});

test("archive rejects pre-abort, conflicting work directory and invalid PNG profiles", async () => {
  for (const mode of ["abort", "existing", "profile"]) {
    const root = await mkdtemp(join(tmpdir(), "cf-forward-reject-"));
    try {
      const controller = new AbortController();
      const capture = createOriginalSessionFrameArchive({outputDirectory: root, contract: contractFixture(),
        signal: controller.signal, verifyFiles: async () => {}});
      const png = mode === "profile" ? Buffer.from("not a PNG") : await pngFixture();
      if (mode === "abort") controller.abort();
      if (mode === "existing") await mkdir(join(root, ORIGINAL_FRAME_ARCHIVE_DIRECTORY));
      if (mode === "profile") {
        await capture.captureFrame(0, 0, png); await capture.captureFrame(1, 1 / 25, png);
        await assert.rejects(capture.finalize(), /FINALIZATION_FAILED/);
      } else await assert.rejects(capture.captureFrame(0, 0, png), /CAPTURE_FAILED/);
    } finally {await rm(root, {recursive: true, force: true});}
  }
});
