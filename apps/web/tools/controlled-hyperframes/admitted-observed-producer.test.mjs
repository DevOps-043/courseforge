import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {generateKeyPairSync, randomUUID} from "node:crypto";
import {mkdtemp, mkdir, writeFile, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {buildProducerExtensionPackage, projectProducerExtensionInventory} from "./build-producer-extension-v1.mjs";
import {fileRecord} from "./producer-extension-files.mjs";
import {loadAdmittedObservedProducer} from "./admitted-observed-producer.mjs";
import {runMaterializedProducer} from "./run-materialized-producer.mjs";
import {encodeMaterializedProducerRequest, MATERIALIZED_REQUEST_POLICY,
  MATERIALIZED_OBSERVED_REQUEST_POLICY, MATERIALIZED_MEASUREMENT_REQUEST_POLICY, materializedExecutionDigest} from "./materialized-producer-request.mjs";
import {runObservedMaterializedProducer} from "./run-observed-materialized-producer.mjs";
import {readObservedOperatorConfiguration, OBSERVED_OPERATOR_CONFIGURATION_POLICY, OBSERVED_NETWORK_OPERATOR_CONFIGURATION_POLICY} from "./observed-producer-operator-configuration.mjs";
import {createOriginalServerFileSupervisor, ORIGINAL_SERVER_FILE_CHANNEL_POLICY} from "./original-server-file-channel.mjs";
import {encodeObservedOperatorReference, decodeObservedOperatorReference} from "./observed-producer-operator-reference.mjs";
import {ORIGINAL_SESSION_OBSERVER_POLICY} from "./original-session-observer.mjs";

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"));
const {digestControlledDependencyManifest} = require("./dist/composition-worker/domains/production/composition-editor/qa/composition-controlled-dependency-inventory.js");
const sourceDirectory = fileURLToPath(new URL("./node_modules/@hyperframes/producer", import.meta.url));
const observer = () => ({onSession() {}, onBeforeFrame() {}, onAfterFrame() {}});
const capture = {forceScreenshot: true, captureMode: "screenshot", workerCount: 1, browserGpuMode: "software", hasHdrContent: false};
const fakeProducer = work => ({DEFAULT_CONFIG: {}, createRenderJob: config => ({config}),
  async executeObservedRenderJob(job, directory, outputPath, progress, signal, hooks) {
    await work?.({job, directory, outputPath, progress, signal, hooks});
    Object.assign(job, {status: "complete", outcome: "completed", warnings: [], outputPath,
      perfSummary: {observability: {capture}}});
  }});

test("admitted observed loader and process route require package/role/inventory before module import", async t => {
  const temporary = await mkdtemp(join(tmpdir(), "courseforge-admitted-observed-"));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const controller = new AbortController();
  const artifact = await buildProducerExtensionPackage({sourceDirectory, outputDirectory: join(temporary, "producer"), signal: controller.signal});
  const fragment = await projectProducerExtensionInventory({directory: artifact.directory,
    expectedManifestSha256: artifact.manifestSha256, rootId: "producer", signal: controller.signal});
  const toolsRoot = join(temporary, "tools");
  await mkdir(toolsRoot);
  const fixtureBytes = Buffer.from("test role bytes, not executable binaries");
  await writeFile(join(toolsRoot, "fixture.txt"), fixtureBytes);
  const reference = {rootId: "tools", path: "fixture.txt"};
  const files = [...fragment.files, {...reference, ...fileRecord("fixture.txt", fixtureBytes)}];
  const roles = Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"]
    .map(role => [role, role === "producer" ? fragment.producer : reference]));
  const manifest = {policy: "EXACT_DECLARED_DEPENDENCY_TREES_V1", roots: ["producer", "tools"], files, roles};
  const dependencyInventory = {manifest, expectedManifestSha256: digestControlledDependencyManifest(manifest),
    roots: {producer: artifact.directory, tools: toolsRoot}};
  const execution = {policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1", backend: "CONTROLLED", sdkVersion: "0.7.106",
    files: Object.fromEntries(Object.entries(roles).map(([role, binding]) => {
      const file = files.find(file => file.rootId === binding.rootId && file.path === binding.path);
      return [role, {sha256: file.sha256, sizeBytes: file.sizeBytes}];
    })), expectedBrowser: {protocolVersion: "1.3", product: "Test", revision: "Test", userAgent: "Test", jsVersion: "Test"}};
  const input = {packageDirectory: artifact.directory, expectedPackageManifestSha256: artifact.manifestSha256,
    dependencyInventory, execution, observer: observer(), signal: controller.signal,
    nativePaths: {browser: join(toolsRoot, "fixture.txt"), encoder: join(toolsRoot, "fixture.txt"), decoder: join(toolsRoot, "fixture.txt")}};

  await t.test("only instrumented entry imports after real declared-tree admission", async () => {
    let imports = 0, executions = 0;
    const authorize = async () => ({status: "AUTHORIZED", address: "127.0.0.1", port: 43210});
    const stageObserver = {...input.observer, onEncode: async () => ({encodeMs: 1}), onAfterAssemble: async () => {}, onOriginalServer: authorize};
    const encode = stageObserver.onEncode, verify = stageObserver.onAfterAssemble;
    const loaded = await loadAdmittedObservedProducer({...input, observer: stageObserver}, {importModule: async url => {
      imports++;
      assert.equal(url, pathToFileURL(artifact.entryPath).href);
      return fakeProducer(({hooks}) => {assert.equal(hooks, loaded.observer);
        assert.equal(hooks.onEncode, encode); assert.equal(hooks.onAfterAssemble, verify); executions++;});
    }});
    stageObserver.onEncode = async () => {throw new Error("mutated callback");};
    stageObserver.onAfterAssemble = async () => {throw new Error("mutated callback");};
    stageObserver.onOriginalServer = async () => {throw new Error("mutated callback");};
    assert.equal(loaded.observer.onOriginalServer, authorize);
    assert.equal(imports, 1);
    assert.equal(loaded.producer.executeRenderJob, undefined);
    await loaded.producer.executeObservedRenderJob({}, temporary, join(temporary, "video.mp4"), undefined, controller.signal, loaded.observer);
    assert.equal(executions, 1);
    await assert.rejects(loaded.producer.executeObservedRenderJob({}, temporary, "unused", undefined,
      new AbortController().signal, loaded.observer), /EXECUTION_BINDING_INVALID/);
    await assert.rejects(loadAdmittedObservedProducer({...input, observer: {...input.observer, onEncode: encode}}), /INPUT_INVALID/);
    await assert.rejects(loadAdmittedObservedProducer({...input, observer: {...input.observer, onOriginalServer: true}}), /INPUT_INVALID/);
  });
  await t.test("bad package digest, wrong producer role and changed dependency never import", async () => {
    let imports = 0;
    const ports = {importModule: async () => {imports++; return fakeProducer();}};
    await assert.rejects(loadAdmittedObservedProducer({...input, expectedPackageManifestSha256: "0".repeat(64)}, ports), /ADMISSION_FAILED/);
    await assert.rejects(loadAdmittedObservedProducer({...input, nativePaths: {...input.nativePaths, browser: resolve("outside.exe")}}, ports), /NATIVE_ROLE_MISMATCH/);
    const mismatched = structuredClone(dependencyInventory);
    mismatched.manifest.roles.producer = reference;
    mismatched.expectedManifestSha256 = digestControlledDependencyManifest(mismatched.manifest);
    const wrongExecution = structuredClone(execution);
    wrongExecution.files.producer = wrongExecution.files.node;
    await assert.rejects(loadAdmittedObservedProducer({...input, dependencyInventory: mismatched, execution: wrongExecution}, ports), /PRODUCER_ROLE_MISMATCH/);
    await writeFile(join(toolsRoot, "fixture.txt"), "changed dependency");
    await assert.rejects(loadAdmittedObservedProducer(input, ports), /ADMISSION_FAILED/);
    await writeFile(join(toolsRoot, "fixture.txt"), fixtureBytes);
    assert.equal(imports, 0);
  });
  await t.test("module import changing a dependency fails before execution", async () => {
    await assert.rejects(loadAdmittedObservedProducer(input, {importModule: async () => {
      await writeFile(join(toolsRoot, "fixture.txt"), "import drift");
      return fakeProducer();
    }}), /ADMISSION_FAILED/);
    await writeFile(join(toolsRoot, "fixture.txt"), fixtureBytes);
  });
  await t.test("uninstrumented namespace is rejected with no fallback", async () => {
    await assert.rejects(loadAdmittedObservedProducer(input, {importModule: async () => ({DEFAULT_CONFIG: {}, createRenderJob() {}, executeRenderJob() {}})}), /MODULE_INVALID/);
  });
  await t.test("driver clears environment before import, uses bound signal/hooks and writes candidate only", async () => {
    const environment = {NODE_OPTIONS: "private", SUPABASE_SERVICE_ROLE_KEY: "private"};
    const writes = [];
    const raw = {policy: MATERIALIZED_REQUEST_POLICY.id, executionId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002", revisionId: "00000000-0000-4000-8000-000000000003",
      documentHash: "a".repeat(64), projectHash: "b".repeat(64), directory: resolve("input"), outputParentDirectory: resolve("output"),
      browserPath: input.nativePaths.browser, encoderPath: input.nativePaths.encoder, probePath: input.nativePaths.decoder, fps: 30};
    const observedRequest = {...raw, policy: MATERIALIZED_OBSERVED_REQUEST_POLICY, renderExecutionSha256: materializedExecutionDigest(execution)};
    const receipt = await runMaterializedProducer(encodeMaterializedProducerRequest(observedRequest), {environment, signal: controller.signal,
      observedInstallation: input, observedLoaderPorts: {importModule: async () => {
        assert.equal(environment.NODE_OPTIONS, undefined);
        assert.equal(environment.SUPABASE_SERVICE_ROLE_KEY, undefined);
        return fakeProducer(({signal, hooks}) => {assert.equal(signal, controller.signal); assert.equal(typeof hooks.onSession, "function");});
      }}, mkdir: async () => {}, writeFile: async (...args) => writes.push(args)});
    assert.equal(receipt.scope, "CANDIDATE_VIDEO_NOT_CONFORMANCE");
    assert.equal(receipt.artifacts, undefined);
    assert.equal(receipt.fileObservations.scope, "DECLARED_TREES_NOT_OS_IMAGE_OR_DYNAMIC_DEPENDENCY_PROOF");
    assert.deepEqual(receipt.fileObservations.files, execution.files);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][2].flag, "wx");
    assert.equal(Object.hasOwn(JSON.parse(writes[0][1]), "fileObservations"), false);
  });
  await t.test("post-render drift prevents receipt and partial/conflicting config never falls back", async () => {
    const raw = {policy: MATERIALIZED_REQUEST_POLICY.id, executionId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002", revisionId: "00000000-0000-4000-8000-000000000003",
      documentHash: "a".repeat(64), projectHash: "b".repeat(64), directory: resolve("input"), outputParentDirectory: resolve("output"),
      browserPath: input.nativePaths.browser, encoderPath: input.nativePaths.encoder, probePath: input.nativePaths.decoder, fps: 30};
    let writes = 0;
    const ports = {environment: {}, signal: controller.signal, observedInstallation: input,
      observedLoaderPorts: {importModule: async () => fakeProducer(async () => {
        await writeFile(join(toolsRoot, "fixture.txt"), "post-render drift");
      })}, mkdir: async () => {}, writeFile: async () => {writes++;}};
    const observedRequest = {...raw, policy: MATERIALIZED_OBSERVED_REQUEST_POLICY, renderExecutionSha256: materializedExecutionDigest(execution)};
    await assert.rejects(runMaterializedProducer(encodeMaterializedProducerRequest(observedRequest), ports), /PROCESS_FAILED/);
    await writeFile(join(toolsRoot, "fixture.txt"), fixtureBytes);
    await assert.rejects(runMaterializedProducer(encodeMaterializedProducerRequest(observedRequest), {...ports, observedInstallation: undefined}), /PROCESS_FAILED/);
    await assert.rejects(runMaterializedProducer(encodeMaterializedProducerRequest(observedRequest), {...ports, producer: fakeProducer()}), /PROCESS_FAILED/);
    assert.equal(writes, 0);
  });
  await t.test("fixed bootstrap reads pinned config and writes bound original-session evidence separately", async bootstrapContext => {
    const configuration = {policy: OBSERVED_OPERATOR_CONFIGURATION_POLICY, observerPolicy: ORIGINAL_SESSION_OBSERVER_POLICY,
      packageDirectory: input.packageDirectory, expectedPackageManifestSha256: input.expectedPackageManifestSha256,
      dependencyInventory, execution};
    const configBytes = Buffer.from(JSON.stringify(configuration));
    const path = join(temporary, "operator.json");
    await writeFile(path, configBytes);
    const reference = {path, sha256: fileRecord("operator.json", configBytes).sha256};
    const encoded = encodeObservedOperatorReference(reference);
    assert.deepEqual(decodeObservedOperatorReference(encoded), reference);
    const config = await readObservedOperatorConfiguration(reference, controller.signal);
    await config.assertUnchanged();
    const raw = {policy: MATERIALIZED_REQUEST_POLICY.id, executionId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002", revisionId: "00000000-0000-4000-8000-000000000003",
      documentHash: "a".repeat(64), projectHash: "b".repeat(64), directory: resolve("input"), outputParentDirectory: join(temporary, "observed-output"),
      browserPath: input.nativePaths.browser, encoderPath: input.nativePaths.encoder, probePath: input.nativePaths.decoder, fps: 30};
    const observations = [];
    await mkdir(raw.outputParentDirectory);
    const observedRequest = {...raw, policy: MATERIALIZED_OBSERVED_REQUEST_POLICY, renderExecutionSha256: materializedExecutionDigest(execution)};
    const receipt = await runObservedMaterializedProducer(encodeMaterializedProducerRequest(observedRequest), encoded, {
      environment: {}, signal: controller.signal, mkdir, writeFile: async () => {},
      writeObservation: async (...args) => observations.push(args), observedLoaderPorts: {importModule: async () => fakeProducer(async ({hooks, outputPath}) => {
        await writeFile(outputPath, "video fixture, not media");
        const session = {serverUrl: "http://localhost:1234"}, cdp = {on() {}, off() {},
          send: async () => execution.expectedBrowser};
        const buffer = Buffer.from("original frame");
        const payload = {session, frameIndex: 0, time: 0, quantizedTime: 0, buffer, sha256: fileRecord("frame", buffer).sha256};
        await hooks.onSession({session, cdp}); await hooks.onBeforeFrame(payload); await hooks.onAfterFrame(payload);
      })}});
    assert.equal(observations.length, 1);
    const evidence = JSON.parse(observations[0][1]);
    assert.equal(evidence.requestSha256, receipt.requestSha256);
    assert.equal(evidence.observations.frameCount, 1);
    assert.equal(evidence.video.sha256, fileRecord("video", Buffer.from("video fixture, not media")).sha256);
    assert.equal(evidence.scope, "CANDIDATE_ORIGINAL_SESSION_NOT_SUPERVISOR_ARTIFACT");
    assert.equal(observations[0][2].flag, "wx");
    await assert.rejects(runObservedMaterializedProducer(encodeMaterializedProducerRequest({...observedRequest,
      renderExecutionSha256: "0".repeat(64)}), encoded), /OBSERVED_PROCESS_FAILED/);
    let unapprovedImports = 0;
    await assert.rejects(runObservedMaterializedProducer(encodeMaterializedProducerRequest({...observedRequest,
      policy: MATERIALIZED_MEASUREMENT_REQUEST_POLICY, measurementPlanSha256: "a".repeat(64), measurementPlanSizeBytes: 2}), encoded,
    {environment: {}, signal: controller.signal, observedLoaderPorts: {importModule: async () => {unapprovedImports++; return fakeProducer();}}}),
    /OBSERVED_PROCESS_FAILED/);
    assert.equal(unapprovedImports, 0);
    await bootstrapContext.test("V2 bootstrap routes original server gate through real signed mailbox, not callback metadata", async () => {
      const executionId = randomUUID(), operationNonce = randomUUID(), keys = generateKeyPairSync("ed25519");
      const directory = join(raw.outputParentDirectory, `${executionId}.original-server-channel`);
      await mkdir(directory);
      const der = keys.publicKey.export({type: "spki", format: "der"});
      const transport = await readFile(new URL("./original-server-file-channel.mjs", import.meta.url));
      const networkChannel = {policy: ORIGINAL_SERVER_FILE_CHANNEL_POLICY.id, directory, executionId, operationNonce,
        publicKeySpki: der.toString("base64"), publicKeySha256: fileRecord("key", der).sha256,
        transportSha256: fileRecord("transport", transport).sha256, transportSizeBytes: transport.length};
      const v2 = {...configuration, policy: OBSERVED_NETWORK_OPERATOR_CONFIGURATION_POLICY, networkChannel};
      const bytes = Buffer.from(JSON.stringify(v2)), v2Path = join(temporary, "operator-v2.json");
      await writeFile(v2Path, bytes);
      const reference = encodeObservedOperatorReference({path: v2Path, sha256: fileRecord("config", bytes).sha256});
      const serve = await createOriginalServerFileSupervisor({directory, binding: {executionId, operationNonce}, privateKey: keys.privateKey,
        rootIdentity: {pid: process.pid, creationFileTime: "133000000000000001"},
        authorize: async candidate => ({status: "AUTHORIZED", address: candidate.address, port: candidate.port})});
      let grants = 0;
      await runObservedMaterializedProducer(encodeMaterializedProducerRequest({...observedRequest, executionId}), reference, {
        environment: {}, signal: controller.signal, mkdir, writeFile: async () => {}, writeObservation: async () => {},
        observedLoaderPorts: {importModule: async () => fakeProducer(async ({hooks, outputPath, signal}) => {
          assert.equal(typeof hooks.onOriginalServer, "function");
          const serving = serve(signal);
          const ack = await hooks.onOriginalServer({serverUrl: "http://localhost:1234", address: "127.0.0.1", port: 1234, signal});
          await serving; assert.deepEqual(ack, {status: "AUTHORIZED", address: "127.0.0.1", port: 1234}); grants++;
          await writeFile(outputPath, "video fixture, not media");
          const session = {serverUrl: "http://127.0.0.1:1234"}, cdp = {on() {}, off() {}, send: async () => execution.expectedBrowser};
          const buffer = Buffer.from("original frame"), payload = {session, frameIndex: 0, time: 0, quantizedTime: 0,
            buffer, sha256: fileRecord("frame", buffer).sha256};
          await hooks.onSession({session, cdp}); await hooks.onBeforeFrame(payload); await hooks.onAfterFrame(payload);
        })}});
      assert.equal(grants, 1);
      for (const altered of [{...v2, policy: OBSERVED_OPERATOR_CONFIGURATION_POLICY}, {...v2, networkChannel: {...networkChannel, privateKey: "forbidden"}},
        {...v2, networkChannel: {...networkChannel, publicKeySha256: "0".repeat(64)}}]) {
        const invalid = Buffer.from(JSON.stringify(altered)); await writeFile(v2Path, invalid);
        await assert.rejects(readObservedOperatorConfiguration({path: v2Path, sha256: fileRecord("invalid", invalid).sha256}, controller.signal), /CONFIGURATION_INVALID/);
      }
    });
    await writeFile(path, "changed");
    await assert.rejects(config.assertUnchanged());
    await assert.rejects(runObservedMaterializedProducer(encodeMaterializedProducerRequest(raw), encoded), /OBSERVED_PROCESS_FAILED/);
  });
  // No real SDK import, process, browser or render happened; binaries are non-executable fixtures.
  assert.ok((await readFile(join(sourceDirectory, "dist/index.js"))).length > 0);
});
