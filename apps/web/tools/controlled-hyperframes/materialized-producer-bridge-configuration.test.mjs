import test from "node:test";
import assert from "node:assert/strict";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createMaterializedProducerBridgeConfiguration} from "./materialized-producer-bridge-configuration.mjs";
import {createMaterializedProducerReferenceBridgeConfiguration} from "./materialized-reference-measurer.mjs";
import {decodeMaterializedProducerRequest} from "./materialized-producer-request.mjs";
import {decodeObservedOperatorReference} from "./observed-producer-operator-reference.mjs";
import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {materializedProducerOutputPaths, materializedProducerRequestDigest} from "./materialized-producer-request.mjs";
import {auditMaterializedProducerCapture} from "./materialized-producer-capture-audit.mjs";
const observedDependencies = ["run-observed-materialized-producer.mjs", "original-session-observer.mjs",
  "observed-producer-operator-configuration.mjs", "materialized-measurement-plan.mjs", "original-session-native-observer.mjs",
  "original-session-sdr-stages.mjs", "closed-stage-executor.mjs"];
function configuration() {
  const tools = dirname(fileURLToPath(import.meta.url)), runtime = resolve("runtime");
  const roles = Object.fromEntries(["node", "browser", "encoder", "decoder"].map(role => [role, {rootId: "runtime", path: `${role}.exe`}]));
  return {powerShellPath: join(runtime, "powershell.exe"), bridgeScriptPath: join(tools, "windows/owned-job-bridge.ps1"),
    outputParentDirectory: resolve("outputs"), measure: async () => {throw new Error("not called");},
    dependencyInventory: {roots: {runtime, tools}, manifest: {roles, files: [
      ...["node.exe", "browser.exe", "encoder.exe", "decoder.exe", "powershell.exe"].map(path => ({rootId: "runtime", path})),
      ...["windows/owned-job-bridge.ps1", "windows/OwnedRenderJob.cs", "windows/OwnedRenderAccess.cs", "windows/OwnedRenderAppContainer.cs", "run-materialized-producer.mjs",
        "controlled-materialized-producer.mjs", "materialized-producer-request.mjs",
        "materialized-producer-capture-audit.mjs", "admitted-observed-producer.mjs",
        "build-producer-extension-v1.mjs", "producer-extension-v1.mjs", "producer-extension-files.mjs",
        "observed-producer-operator-reference.mjs", "original-session-receipt.mjs",
        "original-session-observer.mjs", "materialized-measurement-plan-policy.mjs", "original-native-receipt.mjs"].map(path => ({rootId: "tools", path}))]}}};
}

test("fixed reference bridge admits immutable selections and requires the measured launch plan", () => {
  const input = configuration(), tools = dirname(fileURLToPath(import.meta.url));
  delete input.measure;
  input.supabase = {}; input.measurementFence = {};
  const organizationId = "00000000-0000-4000-8000-000000000002", revisionId = "00000000-0000-4000-8000-000000000003";
  const descriptor = {executionId: "00000000-0000-4000-8000-000000000001", organizationId, revisionId,
    documentHash: "a".repeat(64), projectHash: "b".repeat(64), contract: {schemaVersion: 4, documentHash: "a".repeat(64),
      canvas: {fps: 30}, renderExecution: {sdkVersion: "0.7.106"}, renderProfile: {fps: 30, quality: "high", format: "mp4"}}};
  const contractSha256 = createHash("sha256").update(JSON.stringify(descriptor.contract)).digest("hex");
  input.referenceSelections = [{scope: "HOST_AUTHORIZED_EXACT_REFERENCE_SELECTION_NOT_DURABLE_ATTESTATION",
    organizationId, revisionId, executionId: descriptor.executionId, documentHash: descriptor.documentHash,
    projectHash: descriptor.projectHash, contractSha256, references: [{batchIndex: 0, visualChecksum: "e".repeat(64)}]}];
  input.operatorConfiguration = {path: join(tools, "operator.json"), sha256: "c".repeat(64)};
  const compiled = resolve(tools, "../../dist/composition-worker/domains/production/composition-editor/qa");
  input.dependencyInventory.roots.compiled = compiled;
  input.dependencyInventory.manifest.files.push({rootId: "tools", path: "operator.json", sha256: input.operatorConfiguration.sha256},
    {rootId: "tools", path: "materialized-reference-measurer.mjs"},
    ...observedDependencies.map(path => ({rootId: "tools", path})),
    ...["composition-controlled-reference-measurement.js", "composition-controlled-reference-selection.js",
      "composition-windows-comparison-process-ports.js"].map(path => ({rootId: "compiled", path})));
  const bridge = createMaterializedProducerReferenceBridgeConfiguration(input);
  const directory = resolve("input"), workspace = {directory, entryPath: join(directory, "index.html"), receipt: descriptor};
  assert.throws(() => bridge.prepareLaunch(descriptor, workspace), /MEASUREMENT_PLAN_REQUIRED/);
  const plan = {organizationId, revisionId, documentHash: descriptor.documentHash, projectHash: descriptor.projectHash,
    contractSha256, document: {}}; // Structural launch fixture, not an authorized materialized document.
  const measuredWorkspace = {...workspace, measurementPlan: plan, measurementPlanReference: {sha256: "d".repeat(64), sizeBytes: 100}};
  const launch = bridge.prepareLaunch(descriptor, measuredWorkspace), request = decodeMaterializedProducerRequest(launch.arguments[2]);
  assert.equal(launch.arguments[0], join(tools, "run-observed-materialized-producer.mjs"));
  assert.equal(request.measurementPlanSha256, "d".repeat(64));
  assert.equal(request.measurementPlanSizeBytes, 100);
  assert.equal(launch.arguments.some(argument => argument.includes("visualChecksum")), false);
  assert.throws(() => bridge.prepareLaunch(descriptor, {...measuredWorkspace, measurementPlan: {...plan, revisionId: organizationId}}), /MEASUREMENT_PLAN_REQUIRED/);
  assert.throws(() => createMaterializedProducerReferenceBridgeConfiguration({...input, resolveReferences: () => []}), /CONFIGURATION_REQUIRED/);
});
test("bridge composition maps native binaries from admitted roles and uses fixed declared driver", () => {
  const input = configuration(), bridge = createMaterializedProducerBridgeConfiguration(input);
  const descriptor = {executionId: "00000000-0000-4000-8000-000000000001", organizationId: "00000000-0000-4000-8000-000000000002",
    revisionId: "00000000-0000-4000-8000-000000000003", documentHash: "a".repeat(64), projectHash: "b".repeat(64),
    contract: {schemaVersion: 4, documentHash: "a".repeat(64), canvas: {fps: 30},
      renderExecution: {sdkVersion: "0.7.106"}, renderProfile: {fps: 30, quality: "high", format: "mp4"}}};
  const directory = resolve("input");
  const launch = bridge.prepareLaunch(descriptor, {directory, entryPath: join(directory, "index.html"), receipt: descriptor});
  const request = decodeMaterializedProducerRequest(launch.arguments[2]);
  assert.equal(request.browserPath, resolve("runtime/browser.exe"));
  assert.equal(request.encoderPath, resolve("runtime/encoder.exe")); assert.equal(request.probePath, resolve("runtime/decoder.exe"));
  assert.equal(launch.executable, resolve("runtime/node.exe"));
});
test("absent measurement, unknown roles and undeclared driver fail before launching", () => {
  assert.throws(() => createMaterializedProducerBridgeConfiguration({...configuration(), measure: undefined}), /MEASUREMENT_REQUIRED/);
  const absent = configuration(); delete absent.dependencyInventory.manifest.roles.browser;
  assert.throws(() => createMaterializedProducerBridgeConfiguration(absent), /ROLE_REQUIRED/);
  const undeclared = configuration(); undeclared.dependencyInventory.manifest.files.pop();
  assert.throws(() => createMaterializedProducerBridgeConfiguration(undeclared), /INVENTORY_REQUIRED/);
});

test("observed bridge binds declared operator config to fixed entry and unchanged bounded request", () => {
  const input = configuration(), tools = dirname(fileURLToPath(import.meta.url));
  input.operatorConfiguration = {path: join(tools, "operator.json"), sha256: "c".repeat(64)};
  input.dependencyInventory.manifest.files.push({rootId: "tools", path: "operator.json", sha256: input.operatorConfiguration.sha256},
    ...observedDependencies.map(path => ({rootId: "tools", path})));
  const bridge = createMaterializedProducerBridgeConfiguration(input);
  const descriptor = {executionId: "00000000-0000-4000-8000-000000000001", organizationId: "00000000-0000-4000-8000-000000000002",
    revisionId: "00000000-0000-4000-8000-000000000003", documentHash: "a".repeat(64), projectHash: "b".repeat(64),
    contract: {schemaVersion: 4, documentHash: "a".repeat(64), canvas: {fps: 30}, renderExecution: {sdkVersion: "0.7.106"},
      renderProfile: {fps: 30, quality: "high", format: "mp4"}}};
  const directory = resolve("input");
  const launch = bridge.prepareLaunch(descriptor, {directory, entryPath: join(directory, "index.html"), receipt: descriptor});
  assert.equal(launch.arguments[0], join(tools, "run-observed-materialized-producer.mjs"));
  assert.equal(launch.arguments[3], "--operator-configuration");
  assert.deepEqual(decodeObservedOperatorReference(launch.arguments[4]), input.operatorConfiguration);
  assert.equal(decodeMaterializedProducerRequest(launch.arguments[2]).executionId, descriptor.executionId);
  assert.throws(() => createMaterializedProducerBridgeConfiguration({...input,
    operatorConfiguration: {...input.operatorConfiguration, sha256: "d".repeat(64)}}), /CONFIGURATION_INVENTORY_REQUIRED/);
});

// These imports are evaluated by the observed entry even for a contract without SDR.
for (const dependency of ["original-session-sdr-stages.mjs", "closed-stage-executor.mjs"]) {
  test(`observed bridge rejects an inventory without ${dependency} before launching or measuring`, () => {
    const input = configuration(), tools = dirname(fileURLToPath(import.meta.url));
    input.operatorConfiguration = {path: join(tools, "operator.json"), sha256: "c".repeat(64)};
    input.dependencyInventory.manifest.files.push({rootId: "tools", path: "operator.json", sha256: input.operatorConfiguration.sha256},
      ...observedDependencies.filter(path => path !== dependency).map(path => ({rootId: "tools", path})));
    input.measure = () => assert.fail("undeclared runtime must not reach measurement");
    assert.throws(() => createMaterializedProducerBridgeConfiguration(input), /PRODUCER_INVENTORY_REQUIRED/);
  });
}

test("observed bridge validates witness before measure, supplies clones and rechecks after measurement", async t => {
  const root = await mkdtemp(join(tmpdir(), "cf-observed-bridge-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const input = configuration(), tools = dirname(fileURLToPath(import.meta.url));
  input.outputParentDirectory = root;
  input.operatorConfiguration = {path: join(tools, "operator.json"), sha256: "c".repeat(64)};
  input.dependencyInventory.manifest.files.push({rootId: "tools", path: "operator.json", sha256: input.operatorConfiguration.sha256},
    ...observedDependencies.map(path => ({rootId: "tools", path})));
  const version = {protocolVersion: "1.3", product: "Test", revision: "Test", userAgent: "Test", jsVersion: "Test"};
  const descriptor = {executionId: "00000000-0000-4000-8000-000000000001", organizationId: "00000000-0000-4000-8000-000000000002",
    revisionId: "00000000-0000-4000-8000-000000000003", documentHash: "a".repeat(64), projectHash: "b".repeat(64),
    contract: {schemaVersion: 4, documentHash: "a".repeat(64), canvas: {fps: 30, durationSeconds: 1 / 30},
      renderExecution: {sdkVersion: "0.7.106", expectedBrowser: version}, renderProfile: {fps: 30, quality: "high", format: "mp4"}}};
  const directory = resolve("input"), workspace = {directory, entryPath: join(directory, "index.html"), receipt: descriptor};
  let measured = 0, drift = false, witnessPath;
  input.measure = async observed => {
    measured++;
    assert.equal(observed.originalSession.observations.frameCount, 1);
    assert.equal(observed.originalSession.scope, "CANDIDATE_ORIGINAL_SESSION_NOT_SUPERVISOR_ARTIFACT");
    observed.originalSession.observations.frameCount = 999;
    observed.originalSessionPin.sha256 = "0".repeat(64);
    if (drift) await writeFile(witnessPath, "changed witness");
    return {kind: "SINGLE_CONTRACT", input: {fixture: true}}; // Not a real supervisor artifact.
  };
  const bridge = createMaterializedProducerBridgeConfiguration(input);
  const launch = bridge.prepareLaunch(descriptor, workspace);
  const request = decodeMaterializedProducerRequest(launch.arguments[2]), paths = materializedProducerOutputPaths(request);
  await mkdir(paths.directory);
  const video = Buffer.from("non-media bridge fixture");
  await writeFile(paths.videoPath, video);
  await writeFile(paths.receiptPath, JSON.stringify({version: 1, scope: "CANDIDATE_VIDEO_NOT_CONFORMANCE",
    requestSha256: materializedProducerRequestDigest(request), executionId: request.executionId,
    organizationId: request.organizationId, revisionId: request.revisionId, documentHash: request.documentHash, projectHash: request.projectHash,
    candidate: {policy: "MATERIALIZED_FULL_PRODUCER_SDR_V1", scope: "CANDIDATE_VIDEO_NOT_CONFORMANCE", videoPath: paths.videoPath,
      capture: auditMaterializedProducerCapture({forceScreenshot: true, captureMode: "screenshot", workerCount: 1, browserGpuMode: "software", hasHdrContent: false})}}));
  witnessPath = join(paths.directory, "original-session.json");
  await assert.rejects(bridge.collectResult(descriptor, workspace, new AbortController().signal), /CANDIDATE_INVALID/);
  assert.equal(measured, 0);
  await writeFile(witnessPath, JSON.stringify({version: 1, scope: "CANDIDATE_ORIGINAL_SESSION_NOT_SUPERVISOR_ARTIFACT",
    requestSha256: materializedProducerRequestDigest(request), executionId: request.executionId,
    documentHash: request.documentHash, projectHash: request.projectHash,
    video: {sha256: createHash("sha256").update(video).digest("hex"), sizeBytes: video.length},
    observations: {policy: "ORIGINAL_SESSION_BROWSER_FRAME_DIGEST_V1",
      scope: "ORIGINAL_CDP_SELF_REPORTED_VERSION_AND_FRAME_DIGEST_NOT_CONFORMANCE", browserBefore: version, browserAfter: version,
      frameCount: 1, frameDigestSha256: "d".repeat(64)}}));
  const result = await bridge.collectResult(descriptor, workspace, new AbortController().signal);
  assert.equal(result.videoPath, paths.videoPath);
  assert.equal(measured, 1);
  drift = true;
  await assert.rejects(bridge.collectResult(descriptor, workspace, new AbortController().signal));
  assert.equal(measured, 2);
});
