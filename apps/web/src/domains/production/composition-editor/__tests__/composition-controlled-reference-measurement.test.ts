import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, writeFile, unlink, rmdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {measureControlledConformanceReferences} from "../qa/composition-controlled-reference-measurement";
import {pinConformanceFile} from "../qa/composition-conformance-file-integrity";
import {buildSnapshotConformanceContract} from "../composition-snapshot-conformance-contract";
import {controlledRenderExecutionContractSchema, evaluateControlledRenderExecution} from "../composition-render-execution-contract";
import {evaluateCompositionConformance} from "../composition-preview-render-conformance";
import {createTransitionDocument} from "./composition-transition-test-fixtures";
import {bindControlledReferenceSelection, createControlledReferenceSelectionResolver} from "../qa/composition-controlled-reference-selection";

const organizationId = "70000000-0000-4000-8000-000000000001", documentHash = "b".repeat(64), projectHash = "c".repeat(64);
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "controlled-reference-test-"));
  const videoPath = join(directory, "candidate.mp4"), referencePath = join(directory, "preview-metadata.json");
  await writeFile(videoPath, "non-executable candidate test bytes"); await writeFile(referencePath, "reference test bytes");
  const videoPin = await pinConformanceFile(videoPath, 1024);
  const file = {sha256: "a".repeat(64), sizeBytes: 10};
  const browser = {protocolVersion: "1.3", product: "Chrome/test", revision: "test", userAgent: "test", jsVersion: "test"};
  const execution = controlledRenderExecutionContractSchema.parse({policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
    backend: "CONTROLLED", sdkVersion: "0.7.106", expectedBrowser: browser,
    files: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"].map(role => [role, file]))});
  const document = createTransitionDocument();
  for (const clip of document.clips) clip.volume = 0;
  const contract = buildSnapshotConformanceContract({document, documentHash, assets: [],
    contractVersion: 4, renderExecution: execution,
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  if (contract.schemaVersion !== 4) throw new Error("Test fixture requires V4");
  const observation = {policy: execution.policy, documentHash, videoSha256: videoPin.sha256,
    files: execution.files, browserBefore: browser, browserAfter: browser};
  const visualReport = evaluateCompositionConformance({contract, previewDocumentHash: documentHash,
    renderDocumentHash: documentHash, samples: []});
  visualReport.renderExecution = evaluateControlledRenderExecution({expected: execution, documentHash,
    videoSha256: videoPin.sha256, observation});
  let compares = 0, cleanups = 0;
  const visual = {directory, contract, contractPath: referencePath, previewDirectory: directory,
    previewMetadataPath: referencePath, checksum: "d".repeat(64),
    receipt: {organizationId, revisionId: organizationId, projectHash, documentHash}, cleanup: async () => {cleanups++;}};
  const report = {documentHash, video: {sha256: videoPin.sha256, sizeBytes: videoPin.sizeBytes},
    status: "INCOMPLETE", visual: visualReport, audioTiming: {status: "NOT_REQUESTED"}};
  const dependencies = {readVisual: async () => visual,
    readAudio: async () => {throw new Error("unexpected audio read");},
    compare: async () => {compares++; return report;}} as unknown as NonNullable<Parameters<typeof measureControlledConformanceReferences>[1]>;
  const params = {descriptor: {organizationId, revisionId: organizationId, executionId: organizationId,
    documentHash, projectHash, contract}, artifacts: {kind: "SINGLE_CONTRACT", input: {contract, observation,
    documentHash, videoSha256: videoPin.sha256}}, supabase: {}, references: [{batchIndex: 0, visualChecksum: visual.checksum}],
    videoPath, videoPin, outputParentDirectory: directory, processPorts: {execute: async () => {}, consumePcm: async () => {}},
    signal: new AbortController().signal} as unknown as Parameters<typeof measureControlledConformanceReferences>[0];
  return {params, dependencies, visual, report, referencePath, counts: () => ({compares, cleanups}),
    cleanup: async () => {await unlink(videoPath); await unlink(referencePath); await rmdir(directory);}};
}

test("controlled reader invokes comparison and retains explicit incomplete local scope", async () => {
  const f = await fixture();
  try {
    const result = await measureControlledConformanceReferences(f.params, f.dependencies);
    assert.equal(result.status, "INCOMPLETE"); assert.equal(result.reports.length, 1);
    assert.equal(result.scope, "LOCAL_CONTROLLED_MEASUREMENTS_NOT_SIGNED_OR_DURABLE_CONFORMANCE");
    assert.deepEqual(f.counts(), {compares: 1, cleanups: 1});
  } finally {await f.cleanup();}
});

test("foreign authorized reference is rejected before any decoder comparison", async () => {
  const f = await fixture();
  try {
    f.visual.receipt.projectHash = "f".repeat(64);
    await assert.rejects(measureControlledConformanceReferences(f.params, f.dependencies), /REFERENCE_MISMATCH/);
    assert.deepEqual(f.counts(), {compares: 0, cleanups: 1});
  } finally {await f.cleanup();}
});

test("required audio cannot be omitted from an otherwise matching visual reference", async () => {
  const f = await fixture();
  try {
    f.visual.contract.audio.required = true;
    assert.equal(f.params.descriptor.contract, f.visual.contract);
    await assert.rejects(measureControlledConformanceReferences(f.params, f.dependencies), /AUDIO_REQUIRED/);
    assert.equal(f.counts().compares, 0);
  } finally {await f.cleanup();}
});

test("foreign result cannot replace the pinned candidate video", async () => {
  const f = await fixture();
  try {
    f.report.video.sha256 = "f".repeat(64);
    await assert.rejects(measureControlledConformanceReferences(f.params, f.dependencies), /REPORT_MISMATCH/);
    assert.deepEqual(f.counts(), {compares: 1, cleanups: 1});
  } finally {await f.cleanup();}
});

test("duplicate reference coverage fails before reading any reference", async () => {
  const f = await fixture();
  try {
    await assert.rejects(measureControlledConformanceReferences({...f.params,
      references: [...f.params.references, f.params.references[0]!]}, f.dependencies), /BINDING_INVALID/);
    assert.deepEqual(f.counts(), {compares: 0, cleanups: 0});
  } finally {await f.cleanup();}
});

test("controlled comparison has no unmanaged process fallback", async () => {
  const f = await fixture();
  try {
    await assert.rejects(measureControlledConformanceReferences({...f.params, processPorts: undefined as never}, f.dependencies), /PROCESS_PORTS_REQUIRED/);
    assert.deepEqual(f.counts(), {compares: 0, cleanups: 0});
  } finally {await f.cleanup();}
});

test("reference mutation during measurement never publishes a report", async () => {
  const f = await fixture();
  try {
    const dependencies = {...f.dependencies, compare: async () => {await writeFile(f.referencePath, "mutated bytes"); return f.report as never;}};
    await assert.rejects(measureControlledConformanceReferences(f.params, dependencies), /INTEGRITY_MISMATCH/);
    assert.equal(f.counts().cleanups, 1);
  } finally {await f.cleanup();}
});

test("uncertain child ownership preserves all measurement inputs for reconciliation", async () => {
  const f = await fixture();
  let retainedReceipt: string | undefined, retainedDirectory: string | undefined;
  try {
    const dependencies = {...f.dependencies, compare: async (params: Parameters<typeof f.dependencies.compare>[0]) => {
      retainedReceipt = params.renderReceiptPath;
      retainedDirectory = join(retainedReceipt, "..");
      throw new Error("CONTROLLED_RENDER_EXECUTOR_TERMINATION_UNCONFIRMED");
    }};
    await assert.rejects(measureControlledConformanceReferences(f.params, dependencies), /TERMINATION_UNCONFIRMED/);
    assert.equal(f.counts().cleanups, 0);
  } finally {
    // Test-only reconciliation: no physical native process was launched by the injected comparator.
    if (retainedReceipt) await unlink(retainedReceipt);
    if (retainedDirectory) await rmdir(retainedDirectory);
    await f.cleanup();
  }
});

test("host reference reservation is immutable on input and on every returned lookup", async () => {
  const f = await fixture();
  try {
    const selection = bindControlledReferenceSelection(f.params.descriptor, f.params.references);
    const resolveReferences = createControlledReferenceSelectionResolver([selection]);
    selection.references[0]!.visualChecksum = "e".repeat(64);
    const first = await resolveReferences(f.params.descriptor);
    assert.equal(first[0]!.visualChecksum, "d".repeat(64));
    first[0]!.visualChecksum = "f".repeat(64);
    assert.equal((await resolveReferences(f.params.descriptor))[0]!.visualChecksum, "d".repeat(64));
  } finally {await f.cleanup();}
});

test("host reservation rejects other executions and changes to scoped revision/project/contract", async () => {
  const f = await fixture();
  try {
    const resolveReferences = createControlledReferenceSelectionResolver([
      bindControlledReferenceSelection(f.params.descriptor, f.params.references)]);
    await assert.rejects(resolveReferences({...f.params.descriptor, executionId: "70000000-0000-4000-8000-000000000002"}), /UNAVAILABLE/);
    for (const patch of [{revisionId: "70000000-0000-4000-8000-000000000002"},
      {organizationId: "70000000-0000-4000-8000-000000000002"}, {projectHash: "f".repeat(64)}])
      await assert.rejects(resolveReferences({...f.params.descriptor, ...patch}), /BINDING_INVALID/);
    const changed = structuredClone(f.params.descriptor);
    if (changed.contract.schemaVersion !== 4 || !changed.contract.renderExecution) throw new Error("Expected V4");
    changed.contract.renderExecution.files.encoder.sha256 = "e".repeat(64);
    await assert.rejects(resolveReferences(changed), /BINDING_INVALID/);
  } finally {await f.cleanup();}
});

test("reservations reject duplicates, excess configuration and incomplete audio/coverage", async () => {
  const f = await fixture();
  try {
    const selection = bindControlledReferenceSelection(f.params.descriptor, f.params.references);
    assert.throws(() => createControlledReferenceSelectionResolver([selection, selection]), /DUPLICATE/);
    assert.throws(() => createControlledReferenceSelectionResolver(Array(1025).fill(selection)), /CONFIGURATION_INVALID/);
    assert.throws(() => bindControlledReferenceSelection(f.params.descriptor, []));
    assert.throws(() => bindControlledReferenceSelection(f.params.descriptor, [...f.params.references, f.params.references[0]!]), /COVERAGE_INVALID/);
    f.visual.contract.audio.required = true;
    assert.throws(() => bindControlledReferenceSelection(f.params.descriptor, f.params.references), /COVERAGE_INVALID/);
  } finally {await f.cleanup();}
});

async function audioFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const directory = await mkdtemp(join(tmpdir(), "controlled-audio-reference-test-"));
  const audioReferencePath = join(directory, "audio-reference.wav"), audioReferenceMetadataPath = join(directory, "audio-reference-metadata.json");
  await writeFile(audioReferencePath, "non-audio reference fixture bytes");
  await writeFile(audioReferenceMetadataPath, "bounded test metadata");
  f.visual.contract.audio.required = true;
  f.params.references[0]!.audioChecksum = "e".repeat(64);
  f.report.audioTiming.status = "INCOMPLETE";
  let cleanups = 0;
  const audio = {directory, audioReferencePath, audioReferenceMetadataPath, contract: f.visual.contract,
    checksum: "e".repeat(64), receipt: {...f.visual.receipt, schemaVersion: 2, visualChecksum: f.visual.checksum},
    cleanup: async () => {cleanups++;}};
  const dependencies = {...f.dependencies, readAudio: async () => audio as never};
  return {audio, dependencies, cleanups: () => cleanups, cleanup: async () => {
    await unlink(audioReferencePath); await unlink(audioReferenceMetadataPath); await rmdir(directory);
  }};
}

test("matching visual/audio pair reaches controlled measurement without promoting incomplete audio", async () => {
  const f = await fixture(), a = await audioFixture(f);
  try {
    const result = await measureControlledConformanceReferences(f.params, a.dependencies);
    assert.equal(result.status, "INCOMPLETE");
    assert.equal(result.reports[0]!.audioChecksum, "e".repeat(64));
    assert.deepEqual(f.counts(), {compares: 1, cleanups: 1}); assert.equal(a.cleanups(), 1);
  } finally {await a.cleanup(); await f.cleanup();}
});

test("audio from a different visual reservation fails before decoder comparison", async () => {
  const f = await fixture(), a = await audioFixture(f);
  try {
    a.audio.receipt.visualChecksum = "f".repeat(64);
    await assert.rejects(measureControlledConformanceReferences(f.params, a.dependencies), /AUDIO_MISMATCH/);
    assert.equal(f.counts().compares, 0); assert.equal(a.cleanups(), 1);
  } finally {await a.cleanup(); await f.cleanup();}
});

test("uncertain audio measurement retains both references and its private receipt", async () => {
  const f = await fixture(), a = await audioFixture(f);
  let receiptPath: string | undefined;
  try {
    const dependencies = {...a.dependencies, compare: async (params: Parameters<typeof f.dependencies.compare>[0]) => {
      receiptPath = params.renderReceiptPath;
      throw new Error("CONTROLLED_RENDER_EXECUTOR_TERMINATION_UNCONFIRMED");
    }};
    await assert.rejects(measureControlledConformanceReferences(f.params, dependencies), /TERMINATION_UNCONFIRMED/);
    assert.equal(f.counts().cleanups, 0); assert.equal(a.cleanups(), 0);
  } finally {
    if (receiptPath) {await unlink(receiptPath); await rmdir(join(receiptPath, ".."));}
    await a.cleanup(); await f.cleanup();
  }
});
