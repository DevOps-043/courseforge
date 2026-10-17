import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {collectMaterializedProducerCandidate} from "./materialized-producer-collector.mjs";
import {auditMaterializedProducerCapture} from "./materialized-producer-capture-audit.mjs";
import {materializedProducerRequestDigest, materializedProducerOutputPaths, MATERIALIZED_REQUEST_POLICY,
  MATERIALIZED_OBSERVED_REQUEST_POLICY, materializedExecutionDigest} from "./materialized-producer-request.mjs";
import {ORIGINAL_SESSION_RECEIPT_FILE} from "./original-session-receipt.mjs";
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "cf-producer-candidate-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const request = {policy: MATERIALIZED_REQUEST_POLICY.id, executionId: "00000000-0000-4000-8000-000000000001",
    organizationId: "00000000-0000-4000-8000-000000000002", revisionId: "00000000-0000-4000-8000-000000000003",
    documentHash: "a".repeat(64), projectHash: "b".repeat(64), directory: join(root, "input"), outputParentDirectory: root,
    browserPath: join(root, "browser.exe"), encoderPath: join(root, "encoder.exe"), probePath: join(root, "probe.exe"), fps: 30};
  const paths = materializedProducerOutputPaths(request); await mkdir(paths.directory);
  const receipt = {version: 1, scope: "CANDIDATE_VIDEO_NOT_CONFORMANCE", requestSha256: materializedProducerRequestDigest(request),
    executionId: request.executionId, organizationId: request.organizationId, revisionId: request.revisionId,
    documentHash: request.documentHash, projectHash: request.projectHash,
    candidate: {policy: "MATERIALIZED_FULL_PRODUCER_SDR_V1", scope: "CANDIDATE_VIDEO_NOT_CONFORMANCE", videoPath: paths.videoPath,
      capture: auditMaterializedProducerCapture({forceScreenshot: true, captureMode: "screenshot", workerCount: 1,
        browserGpuMode: "software", hasHdrContent: false})}};
  await writeFile(paths.receiptPath, JSON.stringify(receipt)); await writeFile(paths.videoPath, "candidate bytes, not a real video");
  return {request, paths, receipt};
}
test("collector pins bytes and validates execution scope without claiming media conformance", async t => {
  const f = await fixture(t), candidate = await collectMaterializedProducerCandidate(f.request, new AbortController().signal);
  assert.equal(candidate.videoPin.sha256, createHash("sha256").update("candidate bytes, not a real video").digest("hex"));
  assert.equal(candidate.receipt.scope, "CANDIDATE_VIDEO_NOT_CONFORMANCE"); assert.equal(candidate.artifacts, undefined);
  await candidate.assertUnchanged();
});
test("foreign receipt, extra fields and redirected candidate reject before measurement", async t => {
  const f = await fixture(t);
  for (const patch of [{executionId: "00000000-0000-4000-8000-000000000099"}, {requestSha256: "c".repeat(64)},
    {pass: true}, {candidate: {...f.receipt.candidate, videoPath: join(f.paths.directory, "other.mp4")}}]) {
    await writeFile(f.paths.receiptPath, JSON.stringify({...f.receipt, ...patch}));
    await assert.rejects(collectMaterializedProducerCandidate(f.request, new AbortController().signal), /CANDIDATE_INVALID/);
  }
});
test("bounded strict UTF8 receipt and absent video never return a candidate", async t => {
  const f = await fixture(t);
  for (const bytes of [Buffer.alloc(8193, 65), Buffer.from([0xff]), Buffer.from('{"version":')]) {
    await writeFile(f.paths.receiptPath, bytes);
    await assert.rejects(collectMaterializedProducerCandidate(f.request, new AbortController().signal), /CANDIDATE_INVALID/);
  }
  await writeFile(f.paths.receiptPath, JSON.stringify(f.receipt)); await rm(f.paths.videoPath);
  await assert.rejects(collectMaterializedProducerCandidate(f.request, new AbortController().signal), /CANDIDATE_INVALID/);
});
test("candidate drift or abort is rejected by the post-measurement recheck", async t => {
  const f = await fixture(t), controller = new AbortController();
  const candidate = await collectMaterializedProducerCandidate(f.request, controller.signal);
  await writeFile(f.paths.videoPath, "changed bytes"); await assert.rejects(candidate.assertUnchanged());
  controller.abort(); await assert.rejects(candidate.assertUnchanged());
  await assert.rejects(collectMaterializedProducerCandidate(f.request, controller.signal), /CANDIDATE_INVALID/);
});

async function observedFixture(t) {
  const f = await fixture(t);
  const version = {protocolVersion: "1.3", product: "Test", revision: "Test", userAgent: "Test", jsVersion: "Test"};
  const execution = {sdkVersion: "0.7.106", expectedBrowser: version};
  f.request.policy = MATERIALIZED_OBSERVED_REQUEST_POLICY;
  f.request.renderExecutionSha256 = materializedExecutionDigest(execution);
  f.receipt.requestSha256 = materializedProducerRequestDigest(f.request);
  await writeFile(f.paths.receiptPath, JSON.stringify(f.receipt));
  const bytes = Buffer.from("candidate bytes, not a real video");
  const witness = {version: 1, scope: "CANDIDATE_ORIGINAL_SESSION_NOT_SUPERVISOR_ARTIFACT",
    requestSha256: f.receipt.requestSha256, executionId: f.request.executionId, documentHash: f.request.documentHash,
    projectHash: f.request.projectHash, video: {sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length},
    observations: {policy: "ORIGINAL_SESSION_BROWSER_FRAME_DIGEST_V1",
      scope: "ORIGINAL_CDP_SELF_REPORTED_VERSION_AND_FRAME_DIGEST_NOT_CONFORMANCE", browserBefore: version, browserAfter: version,
      frameCount: 3, frameDigestSha256: "d".repeat(64)}};
  const witnessPath = join(f.paths.directory, ORIGINAL_SESSION_RECEIPT_FILE);
  await writeFile(witnessPath, JSON.stringify(witness));
  return {...f, witness, witnessPath, expectation: {execution, frameCount: 3}};
}

test("observed collector requires bound witness and independently pins its bytes, without granting PASS", async t => {
  const f = await observedFixture(t), signal = new AbortController().signal;
  await assert.rejects(collectMaterializedProducerCandidate(f.request, signal), /CANDIDATE_INVALID/);
  const candidate = await collectMaterializedProducerCandidate(f.request, signal, f.expectation);
  assert.deepEqual(candidate.originalSession, f.witness);
  assert.equal(candidate.originalSessionPin.sha256, createHash("sha256").update(JSON.stringify(f.witness)).digest("hex"));
  assert.equal(candidate.artifacts, undefined);
  await candidate.assertUnchanged();
  await writeFile(f.witnessPath, JSON.stringify({...f.witness, pass: true}));
  await assert.rejects(candidate.assertUnchanged());
});

test("witness foreign bindings, missing/oversized/invalid UTF8 and invented conformance reject", async t => {
  const f = await observedFixture(t), signal = new AbortController().signal;
  const variants = [{...f.witness, requestSha256: "0".repeat(64)}, {...f.witness, executionId: "foreign"},
    {...f.witness, scope: "PASS"}, {...f.witness, video: {...f.witness.video, sha256: "0".repeat(64)}},
    {...f.witness, video: {...f.witness.video, sizeBytes: 1}}, {...f.witness, observations: {...f.witness.observations, frameCount: 2}},
    {...f.witness, observations: {...f.witness.observations, frameDigestSha256: "not a hash"}},
    {...f.witness, observations: {...f.witness.observations, browserAfter: {...f.witness.observations.browserAfter, revision: "changed"}}}];
  for (const variant of variants) {
    await writeFile(f.witnessPath, JSON.stringify(variant));
    await assert.rejects(collectMaterializedProducerCandidate(f.request, signal, f.expectation), /CANDIDATE_INVALID/);
  }
  for (const bytes of [Buffer.alloc(8193, 65), Buffer.from([0xff])]) {
    await writeFile(f.witnessPath, bytes);
    await assert.rejects(collectMaterializedProducerCandidate(f.request, signal, f.expectation), /CANDIDATE_INVALID/);
  }
  await rm(f.witnessPath);
  await assert.rejects(collectMaterializedProducerCandidate(f.request, signal, f.expectation), /CANDIDATE_INVALID/);
});

test("mismatched execution, invalid frame budget and video replacement cannot borrow a witness", async t => {
  const f = await observedFixture(t), signal = new AbortController().signal;
  for (const expectation of [{...f.expectation, execution: {...f.expectation.execution, sdkVersion: "foreign"}},
    {...f.expectation, frameCount: 0}, {...f.expectation, frameCount: 36001}, {...f.expectation, frameCount: 2}])
    await assert.rejects(collectMaterializedProducerCandidate(f.request, signal, expectation), /CANDIDATE_INVALID/);
  await writeFile(f.paths.videoPath, "replaced candidate");
  await assert.rejects(collectMaterializedProducerCandidate(f.request, signal, f.expectation), /CANDIDATE_INVALID/);
});
