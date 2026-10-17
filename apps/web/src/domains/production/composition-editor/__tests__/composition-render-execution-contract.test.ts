import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import { controlledRenderExecutionContractSchema, controlledRenderExecutionReportSchema,
  evaluateControlledRenderExecution } from "../composition-render-execution-contract";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { createTransitionDocument } from "./composition-transition-test-fixtures";
import { assertSnapshotVisibilityReuse } from "../composition-snapshot-conformance-policy";
import { evaluateCompositionConformance, compositionConformanceContractSchema } from "../composition-preview-render-conformance";
import { assertConformanceReportMatchesContract } from "../qa/composition-conformance-contract-report-gate";
import {buildControlledComparisonArtifacts} from "../qa/composition-controlled-comparison-artifacts";
import {exportedVideoReceiptSchema} from "../qa/composition-exported-video-conformance";
import {bindControlledSeekRepeatability} from "../qa/composition-controlled-seek-binding";

test("explicit comparison roles preserve legacy decoder identity and cannot omit or alter new obligations", () => {
  const comparisonTools = {policy: "EXPLICIT_PIXEL_DECODER_AND_PROBE_V1" as const,
    pixelDecoder: {sha256: "d".repeat(64), sizeBytes: 20}, probe: {sha256: "e".repeat(64), sizeBytes: 30}};
  const required = controlledRenderExecutionContractSchema.parse({...expected, comparisonTools});
  const observed = {...observation(), comparisonTools: structuredClone(comparisonTools)};
  assert.equal(evaluateControlledRenderExecution({expected: required, documentHash, videoSha256, observation: observed}).status, "MATCH");
  assert.deepEqual(required.files.decoder, expected.files.decoder);
  assert.deepEqual(evaluateControlledRenderExecution({expected: required, documentHash, videoSha256, observation: observation()}).mismatches,
    ["PIXEL_DECODER", "PROBE"]);
  assert.deepEqual(evaluateControlledRenderExecution({expected, documentHash, videoSha256, observation: observed}).mismatches,
    ["PIXEL_DECODER", "PROBE"]);
  for (const [role, mismatch] of [["pixelDecoder", "PIXEL_DECODER"], ["probe", "PROBE"]] as const) {
    for (const field of ["sha256", "sizeBytes"] as const) {
      const changed = structuredClone(observed);
      if (field === "sha256") changed.comparisonTools[role].sha256 = "f".repeat(64);
      else changed.comparisonTools[role].sizeBytes++;
      assert.deepEqual(evaluateControlledRenderExecution({expected: required, documentHash, videoSha256, observation: changed}).mismatches, [mismatch]);
    }
  }
  assert.equal(controlledRenderExecutionContractSchema.safeParse({...required,
    comparisonTools: {...comparisonTools, pixelDecoder: {...comparisonTools.pixelDecoder, path: "private"}}}).success, false);
  assert.equal(controlledRenderExecutionContractSchema.safeParse({...required,
    comparisonTools: {...comparisonTools, policy: "AUTODETECT"}}).success, false);
  const frozen = compositionConformanceContractSchema.parse({...contract(), renderExecution: required});
  const artifacts = buildControlledComparisonArtifacts({contract: frozen, observation: observed, documentHash, videoSha256});
  assert.deepEqual(exportedVideoReceiptSchema.parse(artifacts.receipt).renderExecution?.comparisonTools, comparisonTools);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: contract()}, frozen), /RENDER_EXECUTION_MISMATCH/);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: frozen}, contract()), /RENDER_EXECUTION_MISMATCH/);
  assert.throws(() => buildControlledComparisonArtifacts({contract: frozen, observation: observation(), documentHash, videoSha256}), /MISMATCH/);
  const visual = evaluateCompositionConformance({contract: frozen, previewDocumentHash: documentHash,
    renderDocumentHash: documentHash, samples: []});
  visual.status = "FAIL";
  visual.renderExecution = evaluateControlledRenderExecution({expected: required, documentHash, videoSha256,
    observation: observation()});
  assert.doesNotThrow(() => assertConformanceReportMatchesContract(frozen, visual, {videoSha256}));
  assert.throws(() => assertConformanceReportMatchesContract(contract(), visual, {videoSha256}), /COMPARISON_TOOLS_UNAUTHORIZED/);
});

test("seek obligation survives export and final gating; missing or foreign summaries cannot be silently accepted", () => {
  const required = compositionConformanceContractSchema.parse({...contract(), renderExecution: {...expected,
    seekRepeatabilityPolicy: "EXACT_RGBA_FORWARD_REVERSE_V1"}});
  const seek = {policy: "EXACT_RGBA_FORWARD_REVERSE_V1", scope: "SDK_SESSION_CHECKPOINTS_NOT_PREVIEW_PARITY_OR_JOB_ATTESTATION",
    status: "PASS", documentHash, contractSha256: createHash("sha256").update(JSON.stringify(required)).digest("hex"),
    checkpointCount: required.checkpoints.length, byteCounts: {forward: 100, reverse: 100},
    samples: [...required.checkpoints].sort((left, right) => left.frameIndex - right.frameIndex)
      .map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds, rgbaSha256: "d".repeat(64)}))};
  assert.deepEqual(bindControlledSeekRepeatability(required, seek), seek);
  assert.equal(bindControlledSeekRepeatability(required, undefined), undefined);
  assert.throws(() => bindControlledSeekRepeatability(contract(), seek), /UNAUTHORIZED/);
  for (const kind of ["hash", "document", "frame", "coverage", "order", "scope"] as const) {
    const changed = structuredClone(seek);
    if (kind === "hash") changed.contractSha256 = "e".repeat(64);
    if (kind === "document") changed.documentHash = videoSha256;
    if (kind === "frame") changed.samples[0].timeSeconds += 1 / 25;
    if (kind === "coverage") changed.samples.pop();
    if (kind === "order") changed.samples.reverse();
    if (kind === "scope") changed.scope = "PRODUCTION_APPROVED";
    assert.throws(() => bindControlledSeekRepeatability(required, changed), kind);
  }
  const input = {contract: required, observation: observation(), documentHash, videoSha256};
  assert.throws(() => buildControlledComparisonArtifacts(input), /SEEK_REQUIRED/);
  const exported = buildControlledComparisonArtifacts({...input, seekRepeatability: seek});
  assert.deepEqual(exported.receipt.seekRepeatability, seek);
  const visual = evaluateCompositionConformance({contract: required, previewDocumentHash: documentHash,
    renderDocumentHash: documentHash, samples: []});
  assert.ok(visual.incompletenessReasons?.includes("RENDER_SEEK_REPEATABILITY_UNAVAILABLE"));
  visual.renderExecution = exported.execution;
  assert.doesNotThrow(() => assertConformanceReportMatchesContract(required, visual, {videoSha256}));
  const omitted = {...visual, incompletenessReasons: visual.incompletenessReasons!.filter(reason => reason !== "RENDER_SEEK_REPEATABILITY_UNAVAILABLE")};
  assert.throws(() => assertConformanceReportMatchesContract(required, omitted, {videoSha256}), /SEEK_REQUIRED/);
  assert.doesNotThrow(() => assertConformanceReportMatchesContract(required, {...omitted, seekRepeatability: exported.receipt.seekRepeatability}, {videoSha256}));
});

const documentHash = "a".repeat(64), videoSha256 = "b".repeat(64);
const browser = {protocolVersion: "1.3", product: "Chrome/test", revision: "revision", userAgent: "test", jsVersion: "test"};
const expected = controlledRenderExecutionContractSchema.parse({policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
  backend: "CONTROLLED", sdkVersion: "0.7.106", expectedBrowser: browser,
  files: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"]
    .map(role => [role, {sha256: "c".repeat(64), sizeBytes: 10}]))});
function observation() {return {policy: expected.policy, documentHash, videoSha256,
  files: structuredClone(expected.files), browserBefore: {...browser}, browserAfter: {...browser}};}
function contract(renderExecution = true) {return buildSnapshotConformanceContract({document: createTransitionDocument(),
  documentHash, assets: [], contractVersion: 4, ...(renderExecution ? {renderExecution: expected} : {}),
  renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});}

test("controlled exports are comparator-readable, independently cloned and bound to the expected execution", () => {
  const frozen = contract(), observed = observation();
  const artifacts = buildControlledComparisonArtifacts({contract: frozen, observation: observed, documentHash, videoSha256});
  assert.deepEqual(exportedVideoReceiptSchema.parse(artifacts.receipt).renderExecution, observed);
  assert.equal(artifacts.execution.status, "MATCH");
  assert.equal(artifacts.execution.reason, "RENDER_EXECUTION_ATTESTATION_PENDING");
  artifacts.receipt.renderExecution!.files.node.sizeBytes++;
  assert.equal(observed.files.node.sizeBytes, 10);
  for (const invalid of [{contract: contract(false)}, {documentHash: videoSha256}, {videoSha256: documentHash},
    {observation: undefined}, {observation: {...observed, browserAfter: {...browser, revision: "changed"}}}])
    assert.throws(() => buildControlledComparisonArtifacts({contract: frozen, observation: observed,
      documentHash, videoSha256, ...invalid}));
  assert.deepEqual(exportedVideoReceiptSchema.parse({documentHash, videoSha256}), {documentHash, videoSha256});
});

test("execution observation detects every tool role, both browser observations and output bindings", () => {
  assert.equal(evaluateControlledRenderExecution({expected, documentHash, videoSha256}).status, "MISSING");
  assert.equal(evaluateControlledRenderExecution({expected, documentHash, videoSha256, observation: observation()}).status, "MATCH");
  for (const role of Object.keys(expected.files) as Array<keyof typeof expected.files>) {
    const changed = observation(); changed.files[role].sha256 = "d".repeat(64);
    assert.equal(evaluateControlledRenderExecution({expected, documentHash, videoSha256, observation: changed}).status, "MISMATCH");
    changed.files[role].sha256 = expected.files[role].sha256; changed.files[role].sizeBytes++;
    assert.equal(evaluateControlledRenderExecution({expected, documentHash, videoSha256, observation: changed}).status, "MISMATCH");
  }
  for (const phase of ["browserBefore", "browserAfter"] as const) {
    const changed = observation(); changed[phase].revision = "different";
    assert.deepEqual(evaluateControlledRenderExecution({expected, documentHash, videoSha256, observation: changed}).mismatches, ["BROWSER_SESSION"]);
  }
  const changed = observation(); changed.documentHash = videoSha256; changed.videoSha256 = documentHash;
  assert.deepEqual(evaluateControlledRenderExecution({expected, documentHash, videoSha256, observation: changed}).mismatches, ["DOCUMENT", "VIDEO"]);
});

test("strict bounded evidence rejects misleading summaries and extra fields", () => {
  const report = evaluateControlledRenderExecution({expected, documentHash, videoSha256, observation: observation()});
  for (const invalid of [{...report, status: "PASS"}, {...report, status: "MISMATCH"},
    {...report, mismatches: ["NODE"]}, {...report, status: "MISMATCH", mismatches: ["NODE", "NODE"]},
    {...report, reason: "APPROVED"}, {...report, path: "private/path"}])
    assert.equal(controlledRenderExecutionReportSchema.safeParse(invalid).success, false);
  assert.equal(controlledRenderExecutionContractSchema.safeParse({...expected, sdkVersion: "latest"}).success, false);
});

test("snapshot freezes execution expectations and rejects changed or omitted obligations on reuse", () => {
  const requested = contract();
  assert.doesNotThrow(() => assertSnapshotVisibilityReuse({conformance_contract: requested}, requested));
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: contract(false)}, requested), /RENDER_EXECUTION_MISMATCH/);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: requested}, contract(false)), /RENDER_EXECUTION_MISMATCH/);
  const changed = structuredClone(requested);
  if (changed.schemaVersion !== 4 || !changed.renderExecution) throw new Error("Expected execution v4");
  changed.renderExecution.files.engine.sha256 = "d".repeat(64);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: changed}, requested), /RENDER_EXECUTION_MISMATCH/);
  assert.throws(() => buildSnapshotConformanceContract({document: createTransitionDocument(), documentHash,
    assets: [], contractVersion: 3, renderExecution: expected,
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}}), /VERSION_INVALID/);
});

test("file and CDP MATCH remains incomplete and cannot bypass the independent report gate", () => {
  const required = contract();
  const visual = evaluateCompositionConformance({contract: required, previewDocumentHash: documentHash,
    renderDocumentHash: documentHash, samples: []});
  assert.equal(visual.status, "INCOMPLETE");
  assert.ok(visual.incompletenessReasons?.includes("RENDER_EXECUTION_ATTESTATION_PENDING"));
  visual.renderExecution = evaluateControlledRenderExecution({expected, documentHash, videoSha256, observation: observation()});
  assert.doesNotThrow(() => assertConformanceReportMatchesContract(required, visual, {videoSha256}));
  assert.throws(() => assertConformanceReportMatchesContract(required, visual), /BINDING_INVALID/);
  assert.throws(() => assertConformanceReportMatchesContract(required, visual, {videoSha256: documentHash}), /BINDING_INVALID/);
  assert.throws(() => assertConformanceReportMatchesContract(required,
    {...visual, incompletenessReasons: []}, {videoSha256}), /ATTESTATION_PENDING/);
  assert.throws(() => assertConformanceReportMatchesContract(contract(false), visual, {videoSha256}), /UNAUTHORIZED/);
  assert.throws(() => assertConformanceReportMatchesContract(required,
    {...visual, renderExecution: {...visual.renderExecution!, status: "MISMATCH", mismatches: ["NODE"]}},
    {videoSha256}), /FAILURE_INVALID/);
});
