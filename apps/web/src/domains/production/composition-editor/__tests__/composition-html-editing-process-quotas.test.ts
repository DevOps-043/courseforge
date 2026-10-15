import assert from "node:assert/strict";
import test, {type TestContext} from "node:test";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {join, resolve} from "node:path";
import type {ChildProcessWithoutNullStreams} from "node:child_process";
import * as controlledHost from "../qa/composition-controlled-render-worker-host";
import * as jobBridge from "../qa/composition-windows-job-bridge";
import {createWindowsControlledRenderWorkerHost} from "../qa/composition-windows-render-worker-host";
import type {ControlledOwnedExecutorConfiguration} from "../qa/composition-controlled-owned-executor";
import {createOwnedControlledExecutor} from "../qa/composition-controlled-owned-executor";
import {bindHtmlEditingRevisionToComposition} from "../composition-html-editing-document.server";
import {createHtmlEditingRevisionFixture} from "./composition-html-editing-test-fixtures";

type Start = ControlledOwnedExecutorConfiguration["start"];
const executionId = "00000000-0000-4000-8000-000000000001";
const descriptor = {executionId} as Parameters<Start>[0];
const resourceLimits = {policy: "WINDOWS_JOB_RESOURCE_LIMITS_V1" as const, maximumProcesses: 8,
  processMemoryBytes: 256 * 1024 ** 2, jobMemoryBytes: 512 * 1024 ** 2, userCpuSeconds: 60, cpuRatePercent: 25};
const windowsOnly = {skip: process.platform !== "win32"};

function fixture(context: TestContext, limits?: jobBridge.WindowsJobBridgeConfiguration["resourceLimits"]) {
  const root = resolve(".tmp/cap029-quota-fixture"), commands: string[] = [];
  let launches = 0, spawns = 0, collections = 0, start: Start | undefined;
  const child = Object.assign(new EventEmitter(), {stdin: new PassThrough(), stdout: new PassThrough(),
    stderr: new PassThrough(), kill: () => true});
  child.stdin.on("data", (bytes: Buffer) => commands.push(bytes.toString("utf8")));
  const result = {videoPath: "simulated output"} as Awaited<ReturnType<Start>["completion"]>;
  // Only the outer DB/supervisor composition is replaced. The Windows host's
  // wrapper and bridge parser/protocol are real; the OS process is simulated.
  context.mock.method(controlledHost, "createControlledRenderWorkerHost", (input: Parameters<typeof controlledHost.createControlledRenderWorkerHost>[0]) => {
    start = input.ownedExecutor.start;
    return async () => {throw new Error("TEST_SUPERVISOR_NOT_INVOKED");};
  });
  const realBridge = jobBridge.createWindowsJobBridgeStart;
  context.mock.method(jobBridge, "createWindowsJobBridgeStart", (configuration: jobBridge.WindowsJobBridgeConfiguration) => realBridge(configuration, {
    platform: "win32", spawnBridge: () => {spawns++; return child as unknown as ChildProcessWithoutNullStreams;},
  }));
  const paths = ["node.exe", "driver.mjs", "powershell.exe", "bridge.ps1", "OwnedRenderJob.cs",
    "OwnedRenderAccess.cs", "OwnedRenderAppContainer.cs"];
  const configuration: jobBridge.WindowsJobBridgeConfiguration = {
    powerShellPath: join(root, "powershell.exe"), bridgeScriptPath: join(root, "bridge.ps1"), resourceLimits: limits,
    prepareLaunch: (_descriptor, workspace) => {launches++; return {
      executable: join(root, "node.exe"), directory: workspace.directory, arguments: ["driver.mjs"]};},
    collectResult: async () => {collections++; return result;},
  };
  // Inventory-only factory inputs: admission/materialization belong to the outer
  // coordinator, which is not exercised by these launch-boundary tests.
  const input = {jobBridge: configuration, dependencyInventory: {roots: {install: root}, manifest: {
    files: paths.map(path => ({rootId: "install", path})), roles: {node: {rootId: "install", path: "node.exe"}},
  }}} as unknown as Parameters<typeof createWindowsControlledRenderWorkerHost>[0];
  const source = createHtmlEditingRevisionFixture();
  const edited = bindHtmlEditingRevisionToComposition({...source.authority, document: source.document,
    revision: source.next.revision, revisionSha256: source.next.sha256}).document;
  const workspace = (editable: boolean): Parameters<Start>[1] => ({directory: root,
    measurementPlan: {document: editable ? edited : source.document}} as Parameters<Start>[1]);
  const construct = () => {createWindowsControlledRenderWorkerHost(input); assert.ok(start); return start;};
  const close = async (handle: ReturnType<Start>) => {
    const send = (status: string, extra = {}) => child.stdout.write(JSON.stringify({status, executionId, ...extra}) + "\n");
    send("READY"); send("ROOT_EXITED", {exitCode: 0}); await Promise.resolve();
    assert.equal(collections, 0);
    const stopping = handle.stopAndConfirm(); send("STOPPED", {activeProcesses: 0}); child.emit("close", 0);
    await stopping; assert.equal(await handle.completion, result); assert.equal(collections, 1);
  };
  return {configuration, construct, workspace, close, commands, counts: () => ({launches, spawns, collections})};
}

test("editable HTML without quotas rejects before operator preparation or spawn, including late configuration addition", windowsOnly, context => {
  const f = fixture(context), start = f.construct();
  assert.throws(() => start(descriptor, f.workspace(true), new AbortController().signal), /CONFORMANCE_HTML_PROCESS_QUOTAS_REQUIRED/);
  f.configuration.resourceLimits = {...resourceLimits};
  assert.throws(() => start(descriptor, f.workspace(true), new AbortController().signal), /CONFORMANCE_HTML_PROCESS_QUOTAS_REQUIRED/);
  assert.deepEqual(f.counts(), {launches: 0, spawns: 0, collections: 0});
});

test("quota rejection respects existing ownership quarantine and never releases a fence or starts a fallback", windowsOnly, async context => {
  const f = fixture(context); let acquired = 0, released = 0;
  const execute = createOwnedControlledExecutor({start: f.construct(), fence: {
    acquire: async () => {acquired++; return {executionId} as never;},
    releaseConfirmed: async () => {released++;},
  }});
  await assert.rejects(execute(descriptor, f.workspace(true)), /EXECUTOR_TERMINATION_UNCONFIRMED/);
  assert.equal(execute.isQuarantined(), true);
  await assert.rejects(execute(descriptor, f.workspace(false)), /EXECUTOR_TERMINATION_UNCONFIRMED/);
  assert.equal(acquired, 1); assert.equal(released, 0);
  assert.deepEqual(f.counts(), {launches: 0, spawns: 0, collections: 0});
});

test("editable HTML uses existing validated V2 quotas pinned at construction and confirmed closure", windowsOnly, async context => {
  const limits = {...resourceLimits}, f = fixture(context, limits), start = f.construct();
  limits.cpuRatePercent = 99; f.configuration.resourceLimits = undefined;
  const handle = start(descriptor, f.workspace(true), new AbortController().signal);
  const command = JSON.parse(f.commands[0]);
  assert.equal(command.policy, "WINDOWS_JOB_CONTROL_CHANNEL_V2"); assert.deepEqual(command.resourceLimits, resourceLimits);
  await f.close(handle); assert.deepEqual(f.counts(), {launches: 1, spawns: 1, collections: 1});
});

test("native documents preserve the existing no-quota V1 launch path", windowsOnly, async context => {
  const f = fixture(context), start = f.construct();
  const handle = start(descriptor, f.workspace(false), new AbortController().signal);
  const command = JSON.parse(f.commands[0]);
  assert.equal(command.policy, "WINDOWS_JOB_CONTROL_CHANNEL_V1"); assert.equal(command.resourceLimits, undefined);
  await f.close(handle);
});

test("the real bridge rejects invalid HTML quota configuration before any launch", windowsOnly, context => {
  const f = fixture(context, {...resourceLimits, cpuRatePercent: 0});
  assert.throws(f.construct); assert.deepEqual(f.counts(), {launches: 0, spawns: 0, collections: 0});
});

test("HTML quota admission does not bypass the existing declared-driver inventory guard", windowsOnly, context => {
  const f = fixture(context, resourceLimits), start = f.construct();
  f.configuration.prepareLaunch = (_descriptor, workspace) => ({executable: resolve("foreign.exe"),
    directory: workspace.directory, arguments: ["driver.mjs"]});
  assert.throws(() => start(descriptor, f.workspace(true), new AbortController().signal), /BRIDGE_INVENTORY_REQUIRED/);
  assert.equal(f.counts().spawns, 0); assert.equal(f.counts().collections, 0);
});
