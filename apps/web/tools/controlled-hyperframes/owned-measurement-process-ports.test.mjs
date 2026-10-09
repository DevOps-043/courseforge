import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {mkdir, mkdtemp, writeFile, readdir, rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {join, resolve} from "node:path";
import {runOwnedMeasurement} from "./run-owned-measurement.mjs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const compiled = "./dist/composition-worker/domains/production/composition-editor/";
const {createWindowsComparisonProcessPorts} = require(`${compiled}qa/composition-windows-comparison-process-ports.js`);
const {createWindowsReservedConformancePortResolver} = require(`${compiled}qa/composition-windows-reserved-conformance-ports.js`);
const {COMPOSITION_CONFORMANCE_THRESHOLDS} = require(`${compiled}composition-preview-render-conformance.js`);
const {CompositionControlledExecutionFenceStore} = require(`${compiled}qa/composition-controlled-execution-fence.js`);
const {digestControlledDependencyManifest, CONTROLLED_DEPENDENCY_INVENTORY_POLICY} = require(`${compiled}qa/composition-controlled-dependency-inventory.js`);
const {controlledRenderExecutionContractSchema, CONTROLLED_COMPARISON_TOOLS_POLICY} = require(`${compiled}composition-render-execution-contract.js`);
const {decodeOwnedMeasurementReference, OWNED_MEASUREMENT_POLICY: policy} = require(`${compiled}qa/composition-owned-measurement-contract.js`);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const uuid = "00000000-0000-4000-8000-000000000001";
function deferred() {let resolve; const promise = new Promise(accept => {resolve = accept;}); return {promise, resolve};}

async function fixture(t, options = {}) {
  const jobAbort = new AbortController(); let driverRunning;
  const parent = resolve("apps/web/.tmp"); await mkdir(parent, {recursive: true});
  const root = await mkdtemp(join(parent, "owned-measurement-"));
  t.after(async () => {jobAbort.abort(); await driverRunning?.catch(() => {}); await rm(root, {recursive: true, force: true});});
  const install = join(root, "install"), outputs = join(root, "outputs"), fences = join(root, "fences");
  await mkdir(outputs); await mkdir(fences);
  const entries = ["node.exe", "probe.exe", "decoder.exe", "powershell.exe",
    "tools/controlled-hyperframes/run-owned-measurement.mjs", "tools/controlled-hyperframes/windows/owned-job-bridge.ps1",
    "tools/controlled-hyperframes/windows/OwnedRenderJob.cs",
    "tools/controlled-hyperframes/windows/OwnedRenderAccess.cs",
    "tools/controlled-hyperframes/windows/OwnedRenderAppContainer.cs",
    ...["composition-owned-measurement-contract.js", "composition-owned-measurement-files.js",
      "composition-conformance-file-integrity.js", "composition-controlled-process-environment.js"]
      .map(name => `dist/composition-worker/domains/production/composition-editor/qa/${name}`)];
  const files = [];
  for (const path of entries) {
    const target = join(install, path); await mkdir(join(target, ".."), {recursive: true});
    const bytes = Buffer.from(`non-executable inventory fixture: ${path}`); await writeFile(target, bytes);
    files.push({rootId: "install", path, sha256: digest(bytes), sizeBytes: bytes.length});
  }
  const reference = path => ({rootId: "install", path});
  const manifest = {policy: CONTROLLED_DEPENDENCY_INVENTORY_POLICY.id, roots: ["install"], files,
    roles: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"].map(role => [role, reference("node.exe")])),
    comparisonTools: {pixelDecoder: reference("decoder.exe"), probe: reference("probe.exe")}};
  const identity = path => {const file = files.find(entry => entry.path === path); return {sha256: file.sha256, sizeBytes: file.sizeBytes};};
  const execution = controlledRenderExecutionContractSchema.parse({policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
    backend: "CONTROLLED", sdkVersion: "0.7.106", files: Object.fromEntries(Object.keys(manifest.roles).map(role => [role, identity("node.exe")])),
    expectedBrowser: {protocolVersion: "1.3", product: "Fixture", revision: "Fixture", userAgent: "Fixture", jsVersion: "Fixture"},
    comparisonTools: {policy: CONTROLLED_COMPARISON_TOOLS_POLICY, pixelDecoder: identity("decoder.exe"), probe: identity("probe.exe")}});
  const configuration = {descriptor: {executionId: uuid, organizationId: uuid, revisionId: uuid,
    documentHash: "a".repeat(64), projectHash: "b".repeat(64), contract: {schemaVersion: 4, renderExecution: execution}},
    dependencyInventory: {manifest, expectedManifestSha256: digestControlledDependencyManifest(manifest), roots: {install}},
    measurementFence: new CompositionControlledExecutionFenceStore(fences, "measurements"), outputParentDirectory: outputs,
    powerShellPath: join(install, "powershell.exe"), bridgeScriptPath: join(install, "tools/controlled-hyperframes/windows/owned-job-bridge.ps1")};
  const started = deferred(), rootExited = deferred(), stopRequested = deferred();
  let child, native, stopped = false, calls = 0, referenceValue;
  const send = (status, extra = {}) => child.stdout.write(JSON.stringify({status, executionId: uuid, ...extra}) + "\n");
  const confirmStop = () => {stopped = true; jobAbort.abort(); send("STOPPED", {activeProcesses: 0}); child.emit("close", 0);};
  const spawnBridge = (_binary, _args, spawnOptions) => {
    calls++; assert.equal(spawnOptions.shell, false); assert.equal(spawnOptions.windowsHide, true);
    assert.equal(spawnOptions.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
    for (const name of ["TEMP", "TMP", "TMPDIR"]) assert.equal(spawnOptions.env[name], spawnOptions.cwd);
    child = Object.assign(new EventEmitter(), {stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true});
    child.stdin.on("data", bytes => {
      const command = JSON.parse(bytes.toString());
      if (command.command === "STOP") {stopRequested.resolve(); if (options.autoStop) confirmStop(); return;}
      assert.equal(command.executable, join(install, "node.exe"));
      assert.equal(command.arguments[0], join(install, "tools/controlled-hyperframes/run-owned-measurement.mjs"));
      referenceValue = decodeOwnedMeasurementReference(command.arguments[2]);
      send("READY"); started.resolve();
      driverRunning = runOwnedMeasurement(command.arguments[2], {signal: jobAbort.signal, spawn: (binary, args, nativeOptions) => {
        assert.ok([join(install, "probe.exe"), join(install, "decoder.exe")].includes(binary));
        assert.equal(nativeOptions.shell, false); assert.equal(nativeOptions.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
        for (const name of ["TEMP", "TMP", "TMPDIR"]) assert.equal(nativeOptions.env[name], nativeOptions.cwd);
        native = Object.assign(new EventEmitter(), {stdout: new PassThrough(), stderr: new PassThrough(), pid: 123,
          kill: () => {native.stdout.end(); native.stderr.end(); native.emit("close", 1); return true;}});
        if (!options.hang) queueMicrotask(() => {
          native.stdout.end(options.stdout ?? Buffer.from('{"duration":1}'));
          native.stderr.end(options.stderr ?? Buffer.from("diagnostic fixture")); native.emit("close", 0);
        });
        return native;
      }}).then(() => {if (!stopped) {send("ROOT_EXITED", {exitCode: 0}); rootExited.resolve();}},
        () => {if (!stopped) {send("ROOT_EXITED", {exitCode: 1}); rootExited.resolve();}});
    });
    return child;
  };
  if (options.poisonWorkspace) Object.defineProperty(configuration, "workspace", {enumerable: true,
    get: () => {throw new Error("Deleted producer workspace must never be read");}});
  const ports = createWindowsComparisonProcessPorts(configuration, {spawnBridge, platform: "win32"});
  return {root, install, outputs, fences, configuration, ports, started, rootExited, stopRequested, confirmStop,
    bridgePorts: {spawnBridge, platform: "win32"},
    get child() {return child;}, get reference() {return referenceValue;}, calls: () => calls};
}
const executeOptions = {maxBuffer: 1024, timeout: 30_000, windowsHide: true, encoding: "utf8", env: {SUPABASE_SERVICE_ROLE_KEY: "not-forwarded"}};

test("reserved provider measures with its own spool and operator binaries, without producer workspace", {timeout: 10_000}, async t => {
  const f = await fixture(t, {autoStop: true});
  const {descriptor, ...configuration} = f.configuration;
  const contract = {schemaVersion: 4, assets: [], documentHash: descriptor.documentHash,
    compilerContract: "courseforge-composition-preview-compiler-v1",
    canvas: {durationSeconds: 1, fps: 25, height: 1080, width: 1920},
    checkpoints: [{frameIndex: 0, timeSeconds: 0, reasons: ["test"]}],
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"},
    thresholds: COMPOSITION_CONFORMANCE_THRESHOLDS, audio: {required: false},
    visualMetrics: {ssimPolicy: "ssim-gaussian-11-coded-bt709-luma-v1", minimumSsim: .995},
    textParity: {policy: "text-region-rgb-shift-one-v1", scope: "NATIVE_TEXT_AND_CAPTIONS",
      checkpoints: [{frameIndex: 0, timeSeconds: 0, expectedTexts: []}]},
    renderExecution: descriptor.contract.renderExecution};
  // Reservation authentication is tested by the host; this fixture exercises native port wiring only.
  const reservation = {scope: {organizationId: uuid, revisionId: uuid, executionId: uuid},
    binding: {documentHash: descriptor.documentHash, projectHash: descriptor.projectHash},
    artifacts: {kind: "SINGLE_CONTRACT", input: {contract}}};
  const resourceLimits = {policy: "WINDOWS_JOB_RESOURCE_LIMITS_V1", maximumProcesses: 8,
    processMemoryBytes: 256 * 1024 ** 2, jobMemoryBytes: 512 * 1024 ** 2, userCpuSeconds: 60, cpuRatePercent: 25};
  const reducedToken = {policy: "WINDOWS_APPCONTAINER_NO_NETWORK_V5", desktop: "winsta0\\courseforge-worker",
    appContainerSid: "S-1-15-2-1-2-3-4-5-6-7", readOnlyPaths: [f.install], deniedPaths: [f.fences],
    treeAudit: {maximumEntries: 4096, maximumDepth: 16, timeoutMilliseconds: 10000}};
  const spawnBridge = f.bridgePorts.spawnBridge;
  const bridgePorts = {...f.bridgePorts, spawnBridge: (...args) => {
    const child = spawnBridge(...args);
    child.stdin.on("data", bytes => {
      const command = JSON.parse(bytes.toString());
      if (command.command === "START") {
        assert.equal(command.policy, "WINDOWS_JOB_CONTROL_CHANNEL_V3");
        assert.deepEqual(command.resourceLimits, resourceLimits);
        assert.deepEqual(command.reducedToken, reducedToken);
      }
    });
    return child;
  }};
  const resolvePorts = createWindowsReservedConformancePortResolver({...configuration, resourceLimits, reducedToken}, bridgePorts);
  const ports = resolvePorts(reservation, new AbortController().signal);
  assert.deepEqual(await ports.execute(ports.probePath, [], executeOptions),
    {stdout: '{"duration":1}', stderr: "diagnostic fixture"});
  assert.deepEqual(await readdir(f.outputs), []);
  const cancelled = new AbortController(); cancelled.abort();
  assert.throws(() => resolvePorts(reservation, cancelled.signal), /EXECUTION_CANCELLED/);
  assert.equal(f.calls(), 1);
});

test("measurement never reads a deleted producer workspace", {timeout: 10_000}, async t => {
  const f = await fixture(t, {poisonWorkspace: true, autoStop: true});
  assert.deepEqual(await f.ports.execute(f.ports.probePath, [], executeOptions),
    {stdout: '{"duration":1}', stderr: "diagnostic fixture"});
  assert.deepEqual(await readdir(f.outputs), []);
});

test("buffered measurement traverses driver/spool and waits for STOPPED plus bridge close before reading", {timeout: 10_000}, async t => {
  const f = await fixture(t); let settled = false;
  const running = f.ports.execute(f.ports.probePath, ["-of", "json"], executeOptions).then(value => {settled = true; return value;});
  await f.rootExited.promise; await f.stopRequested.promise;
  assert.equal(settled, false); assert.deepEqual(await readdir(f.fences), ["measurements.pending.json"]);
  f.confirmStop();
  assert.deepEqual(await running, {stdout: '{"duration":1}', stderr: "diagnostic fixture"});
  assert.deepEqual(await readdir(f.fences), []); assert.deepEqual(await readdir(f.outputs), []);
});

test("PCM consumes bounded real spool bytes only after independently confirmed job closure", {timeout: 10_000}, async t => {
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), f = await fixture(t, {stdout: pcm});
  const chunks = [];
  const running = f.ports.consumePcm({binary: f.ports.pixelDecoderPath, arguments: ["-f", "f32le"], maximumBytes: 64,
    timeoutMilliseconds: 30_000, consume: bytes => {chunks.push(Buffer.from(bytes));}});
  await f.rootExited.promise; await f.stopRequested.promise;
  assert.equal(chunks.length, 0); f.confirmStop(); await running;
  assert.deepEqual(Buffer.concat(chunks), pcm); assert.deepEqual(await readdir(f.outputs), []);
});

test("missing stop acknowledgement quarantines measurements and preserves durable fence and spool", {timeout: 10_000}, async t => {
  const f = await fixture(t);
  const running = f.ports.execute(f.ports.probePath, [], executeOptions);
  const rejection = assert.rejects(running, /TERMINATION_UNCONFIRMED/);
  await f.rootExited.promise; await f.stopRequested.promise; f.child.emit("close", 0); await rejection;
  assert.equal(f.ports.isQuarantined(), true); assert.equal((await readdir(f.outputs)).length, 1);
  assert.deepEqual(await readdir(f.fences), ["measurements.pending.json"]);
  await assert.rejects(f.ports.execute(f.ports.probePath, [], executeOptions), /TERMINATION_UNCONFIRMED/);
  assert.equal(f.calls(), 1);
});

test("cancellation waits for measurement job closure and does not consume or delete pending output", {timeout: 10_000}, async t => {
  const f = await fixture(t, {hang: true}), controller = new AbortController(); let consumed = false;
  const running = f.ports.consumePcm({binary: f.ports.pixelDecoderPath, arguments: [], maximumBytes: 64,
    timeoutMilliseconds: 30_000, signal: controller.signal, consume: () => {consumed = true;}});
  const rejection = assert.rejects(running);
  await f.started.promise; controller.abort(); await f.stopRequested.promise;
  let settled = false; void running.catch(() => {settled = true;}); await Promise.resolve(); assert.equal(settled, false);
  f.confirmStop(); await rejection;
  assert.equal(consumed, false); assert.equal(f.ports.isQuarantined(), false);
  assert.deepEqual(await readdir(f.fences), []); assert.equal((await readdir(f.outputs)).length, 1);
});

test("byte overflow rejects and retains the bounded spool after confirmed tree stop", {timeout: 10_000}, async t => {
  const f = await fixture(t, {stdout: Buffer.alloc(100, 1), autoStop: true});
  await assert.rejects(f.ports.execute(f.ports.probePath, [], {...executeOptions, maxBuffer: 10}),
    {message: "CONTROLLED_RENDER_WINDOWS_ROOT_FAILED"});
  assert.equal(f.ports.isQuarantined(), false); assert.deepEqual(await readdir(f.fences), []);
  assert.equal((await readdir(f.outputs)).length, 1);
});

test("foreign receipt, unauthorized binary and undeclared driver cannot become measurements", {timeout: 10_000}, async t => {
  const f = await fixture(t);
  await assert.rejects(f.ports.execute(join(f.install, "foreign.exe"), [], executeOptions), /BINARY_UNAUTHORIZED/);
  const incomplete = structuredClone({...f.configuration, measurementFence: undefined});
  incomplete.measurementFence = f.configuration.measurementFence;
  incomplete.dependencyInventory.manifest.files = incomplete.dependencyInventory.manifest.files
    .filter(file => !file.path.endsWith("run-owned-measurement.mjs"));
  assert.throws(() => createWindowsComparisonProcessPorts(incomplete, {platform: "win32"}), /INVENTORY_REQUIRED/);
  const missingAclHelper = structuredClone({...f.configuration, measurementFence: undefined});
  missingAclHelper.measurementFence = f.configuration.measurementFence;
  missingAclHelper.dependencyInventory.manifest.files = missingAclHelper.dependencyInventory.manifest.files
    .filter(file => !file.path.endsWith("OwnedRenderAccess.cs"));
  assert.throws(() => createWindowsComparisonProcessPorts(missingAclHelper, {platform: "win32"}), /INVENTORY_REQUIRED/);
  const running = f.ports.execute(f.ports.probePath, [], executeOptions), rejection = assert.rejects(running, /MEASUREMENT_FAILED|EXECUTOR_FAILED/);
  await f.rootExited.promise; await f.stopRequested.promise;
  const receiptPath = join(f.reference.path, "..", policy.receiptFile);
  await writeFile(receiptPath, JSON.stringify({policy: policy.id, executionId: uuid, operationId: uuid,
    requestSha256: "a".repeat(64), scope: "LOCAL_PROCESS_OUTPUT_NOT_CONFORMANCE_OR_ATTESTATION",
    stdout: {sha256: "a".repeat(64), sizeBytes: 0}, stderr: {sha256: "a".repeat(64), sizeBytes: 0}}));
  f.confirmStop(); await rejection; assert.equal(f.ports.isQuarantined(), false);
});

test("invalid UTF8 is rejected after stop, without silently replacing probe bytes", {timeout: 10_000}, async t => {
  const f = await fixture(t, {stdout: Buffer.from([0xff]), autoStop: true});
  await assert.rejects(f.ports.execute(f.ports.probePath, [], executeOptions), /MEASUREMENT_FAILED/);
  assert.deepEqual(await readdir(f.fences), []); assert.equal((await readdir(f.outputs)).length, 1);
});

test("shared deadline covers a noncooperative PCM consumer and retains files until reconciliation", {timeout: 10_000}, async t => {
  const f = await fixture(t, {stdout: Buffer.alloc(8), autoStop: true});
  const release = deferred(); let count = 0;
  const running = f.ports.consumePcm({binary: f.ports.pixelDecoderPath, arguments: [], maximumBytes: 64,
    timeoutMilliseconds: 1500, consume: async () => {count++; await release.promise;}});
  await assert.rejects(running, /DEADLINE_EXCEEDED/);
  assert.equal(count, 1); assert.deepEqual(await readdir(f.fences), []);
  assert.equal(f.ports.isQuarantined(), false); assert.equal((await readdir(f.outputs)).length, 1);
  release.resolve(); await new Promise(resolveImmediate => setImmediate(resolveImmediate));
});
