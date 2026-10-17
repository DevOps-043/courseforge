import assert from "node:assert/strict";
import test from "node:test";
import {resolve} from "node:path";
import {encodeMaterializedProducerRequest, decodeMaterializedProducerRequest, materializedProducerRequestDigest,
  MATERIALIZED_REQUEST_POLICY, prepareMaterializedProducerLaunch} from "./materialized-producer-request.mjs";
import {MATERIALIZED_OBSERVED_REQUEST_POLICY, MATERIALIZED_MEASUREMENT_REQUEST_POLICY, materializedExecutionDigest} from "./materialized-producer-request.mjs";
import {runMaterializedProducer} from "./run-materialized-producer.mjs";
const request = () => ({policy: MATERIALIZED_REQUEST_POLICY.id,
  executionId: "00000000-0000-4000-8000-000000000001", organizationId: "00000000-0000-4000-8000-000000000002",
  revisionId: "00000000-0000-4000-8000-000000000003", documentHash: "a".repeat(64), projectHash: "b".repeat(64),
  directory: resolve("input"), outputParentDirectory: resolve("output"), browserPath: resolve("browser.exe"),
  encoderPath: resolve("encoder.exe"), probePath: resolve("probe.exe"), fps: 30});
test("strict bounded request roundtrip and digest independent of property insertion order", () => {
  const raw = request(); assert.deepEqual(decodeMaterializedProducerRequest(encodeMaterializedProducerRequest(raw)), raw);
  assert.equal(materializedProducerRequestDigest(raw), materializedProducerRequestDigest(Object.fromEntries(Object.entries(raw).reverse())));
  for (const patch of [{fps: 29.97}, {actor: "extra"}, {directory: "relative"}, {browserPath: "a".repeat(5000)}])
    assert.throws(() => encodeMaterializedProducerRequest({...raw, ...patch}));
  for (const encoded of ["!", "a".repeat(6000), Buffer.from([0xff]).toString("base64")])
    assert.throws(() => decodeMaterializedProducerRequest(encoded));
});
test("process entry clears secrets before SDK use, creates exclusive output and writes bound candidate only", async () => {
  const raw = request(), environment = {SUPABASE_SERVICE_ROLE_KEY: "secret", NODE_OPTIONS: "untrusted", PATH: "operator-path"};
  const writes = [], directories = [];
  const producer = {DEFAULT_CONFIG: {fps: 30}, createRenderJob(config) {
    assert.equal(environment.SUPABASE_SERVICE_ROLE_KEY, undefined); assert.equal(environment.NODE_OPTIONS, undefined);
    assert.equal(environment.HYPERFRAMES_FFMPEG_PATH, raw.encoderPath); return {config};
  }, async executeRenderJob(job, directory, outputPath) {
    assert.equal(directory, raw.directory); Object.assign(job, {status: "complete", outcome: "completed", warnings: [], outputPath,
      perfSummary: {observability: {capture: {forceScreenshot: true, captureMode: "screenshot", workerCount: 1,
        browserGpuMode: "software", hasHdrContent: false}}}});
  }};
  const receipt = await runMaterializedProducer(encodeMaterializedProducerRequest(raw), {producer, environment,
    mkdir: async (...args) => directories.push(args), writeFile: async (...args) => writes.push(args)});
  assert.equal(directories[0][1].recursive, false); assert.equal(writes[0][2].flag, "wx");
  assert.equal(receipt.executionId, raw.executionId); assert.equal(receipt.requestSha256, materializedProducerRequestDigest(raw));
  assert.equal(receipt.scope, "CANDIDATE_VIDEO_NOT_CONFORMANCE"); assert.equal(receipt.artifacts, undefined);
});
test("existing output or SDK failure never writes candidate receipt or retries", async () => {
  for (const failCreate of [true, false]) {
    let executions = 0, writes = 0;
    await assert.rejects(runMaterializedProducer(encodeMaterializedProducerRequest(request()), {environment: {},
      producer: {DEFAULT_CONFIG: {}, createRenderJob: () => ({}), async executeRenderJob() {executions++; throw new Error("private");}},
      mkdir: async () => {if (failCreate) throw new Error("exists");}, writeFile: async () => {writes++;}}),
    {message: "CONTROLLED_RENDER_PRODUCER_PROCESS_FAILED"});
    assert.equal(executions, failCreate ? 0 : 1); assert.equal(writes, 0);
  }
});

test("bridge launch projects admitted descriptor and rejects incompatible profiles or materialization", () => {
  const raw = request();
  const descriptor = {...raw, contract: {schemaVersion: 4, documentHash: raw.documentHash,
    canvas: {fps: 30}, renderProfile: {quality: "high", format: "mp4", fps: 30}, renderExecution: {sdkVersion: "0.7.106"}}};
  const workspace = {directory: raw.directory, entryPath: resolve("input/index.html"), receipt: raw};
  const installation = {...raw, nodePath: resolve("node.exe")};
  const launch = prepareMaterializedProducerLaunch(descriptor, workspace, installation);
  assert.equal(launch.executable, installation.nodePath); assert.equal(launch.arguments[1], "--operator-request");
  assert.deepEqual(decodeMaterializedProducerRequest(launch.arguments[2]), raw);
  assert.throws(() => prepareMaterializedProducerLaunch(descriptor, {...workspace, receipt: {...raw, documentHash: "c".repeat(64)}}, installation));
  assert.throws(() => prepareMaterializedProducerLaunch({...descriptor, contract: {...descriptor.contract,
    renderExecution: {...descriptor.contract.renderExecution, sdrConversionPolicy: "requires-custom-conversion"}}}, workspace, installation));
  assert.throws(() => prepareMaterializedProducerLaunch({...descriptor, contract: {...descriptor.contract,
    renderProfile: {...descriptor.contract.renderProfile, quality: "draft"}}}, workspace, installation));
});

test("observed v2 request binds execution digest and never falls back to the legacy process path", async () => {
  const expected = {sdkVersion: "0.7.106", files: {node: {sha256: "a".repeat(64), sizeBytes: 1}}};
  const raw = {...request(), policy: MATERIALIZED_OBSERVED_REQUEST_POLICY, renderExecutionSha256: materializedExecutionDigest(expected)};
  assert.deepEqual(decodeMaterializedProducerRequest(encodeMaterializedProducerRequest(raw)), raw);
  assert.equal(materializedExecutionDigest(expected), materializedExecutionDigest({files: expected.files, sdkVersion: expected.sdkVersion}));
  assert.throws(() => encodeMaterializedProducerRequest({...raw, renderExecutionSha256: undefined}));
  assert.throws(() => encodeMaterializedProducerRequest({...request(), renderExecutionSha256: raw.renderExecutionSha256}));
  let executions = 0;
  await assert.rejects(runMaterializedProducer(encodeMaterializedProducerRequest(raw), {environment: {},
    producer: {DEFAULT_CONFIG: {}, executeRenderJob() {executions++;}}}), /PROCESS_FAILED/);
  assert.equal(executions, 0);
});

test("v3 measurement plan hash and size are strict request bindings without a configurable path", () => {
  const raw = {...request(), policy: MATERIALIZED_MEASUREMENT_REQUEST_POLICY,
    renderExecutionSha256: "c".repeat(64), measurementPlanSha256: "d".repeat(64), measurementPlanSizeBytes: 42};
  assert.deepEqual(decodeMaterializedProducerRequest(encodeMaterializedProducerRequest(raw)), raw);
  assert.notEqual(materializedProducerRequestDigest(raw), materializedProducerRequestDigest({...raw, measurementPlanSha256: "e".repeat(64)}));
  for (const patch of [{measurementPlanSizeBytes: 0}, {measurementPlanSizeBytes: 1.5},
    {measurementPlanSha256: "invalid"}, {measurementPlanPath: "arbitrary.json"}, {policy: MATERIALIZED_OBSERVED_REQUEST_POLICY}])
    assert.throws(() => encodeMaterializedProducerRequest({...raw, ...patch}));
  const descriptor = {...request(), contract: {schemaVersion: 4, documentHash: raw.documentHash,
    canvas: {fps: raw.fps}, renderProfile: {quality: "high", format: "mp4", fps: raw.fps}, renderExecution: {sdkVersion: "0.7.106"}}};
  const launch = prepareMaterializedProducerLaunch(descriptor, {directory: raw.directory, entryPath: resolve("input/index.html"),
    receipt: descriptor, measurementPlanReference: {sha256: raw.measurementPlanSha256, sizeBytes: raw.measurementPlanSizeBytes}},
  {...raw, nodePath: resolve("node.exe"), operatorConfiguration: {path: resolve("operator.json"), sha256: "e".repeat(64)}});
  const launched = decodeMaterializedProducerRequest(launch.arguments[2]);
  assert.equal(launched.policy, MATERIALIZED_MEASUREMENT_REQUEST_POLICY);
  assert.equal(launched.measurementPlanSha256, raw.measurementPlanSha256);
  assert.equal(launched.measurementPlanSizeBytes, raw.measurementPlanSizeBytes);
});
