import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {resolve} from "node:path";
import {randomUUID} from "node:crypto";
import type {ChildProcessWithoutNullStreams} from "node:child_process";
import {createWindowsNetworkOwnedStart} from "../qa/composition-windows-network-owned-start";
import {createWindowsNetworkCommandClient} from "../qa/composition-windows-network-command-client";
import {createWindowsOriginalServerAuthorization} from "../qa/composition-windows-original-server-authorization";
import {createOwnedControlledOperation, type ControlledOwnedExecutorConfiguration} from "../qa/composition-controlled-owned-executor";
import type {ControlledExecutionFence} from "../qa/composition-controlled-execution-fence";
import {buildWindowsNetworkPlan} from "../qa/composition-windows-network-policy";

type Start = ControlledOwnedExecutorConfiguration["start"];
const executionId = randomUUID(), organizationId = randomUUID(), descriptor = {executionId, organizationId} as Parameters<Start>[0];
const workspace = {directory: resolve("apps/web/.tmp")} as Parameters<Start>[1];
const root = {pid: 123, creationFileTime: "133000000000000001"};
const endpoint = {address: "127.0.0.1" as const, port: 43210, protocol: "TCP" as const};
const scope = {hostId: "host", executionId, organizationId, appContainerSid: "S-1-15-2-1-2-3-4-5-6-7"};
const limits = {policy: "WINDOWS_JOB_RESOURCE_LIMITS_V1" as const, maximumProcesses: 8, processMemoryBytes: 268435456,
  jobMemoryBytes: 536870912, userCpuSeconds: 60, cpuRatePercent: 25};
const token = {policy: "WINDOWS_APPCONTAINER_NO_NETWORK_V5" as const, desktop: "winsta0\\courseforge-worker",
  appContainerSid: scope.appContainerSid, readOnlyPaths: [resolve("readonly")], deniedPaths: [resolve("denied")],
  treeAudit: {maximumEntries: 32, maximumDepth: 8, timeoutMilliseconds: 1000}};
const tick = () => new Promise<void>(done => setImmediate(done));
function fixture(blockDeny?: Promise<void>, blockSeal?: Promise<void>) {
  const order: string[] = [];
  const client = createWindowsNetworkCommandClient({channelId: randomUUID(), operationNonce: randomUUID(), scope}, async bytes => {
    const request = JSON.parse(bytes.toString()); order.push(request.command);
    if (request.sequence === 1) await blockDeny;
    if (request.sequence === 3) await blockSeal;
    return Buffer.from(JSON.stringify({...request, receipt: {leaseId: "00000000-0000-4000-8000-000000000001",
      generation: request.sequence, planSha256: buildWindowsNetworkPlan(scope, request.sequence === 2 ? endpoint : undefined).sha256, persistent: true}}));
  });
  let spawns = 0;
  const child = Object.assign(new EventEmitter(), {stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true});
  const send = (status: string, extra = {}) => child.stdout.write(JSON.stringify({status, executionId, ...extra}) + "\n");
  child.stdin.on("data", chunk => {
    const command = JSON.parse(chunk.toString()); order.push(command.command);
    if (command.command === "START") queueMicrotask(() => send("READY", {rootIdentity: root}));
    if (command.command === "OBSERVE_ORIGINAL_LISTENER") queueMicrotask(() => send("LISTENER_OBSERVED", {
      requestId: command.requestId, port: command.port, address: endpoint.address, rootIdentity: root}));
    if (command.command === "STOP") queueMicrotask(() => {send("STOPPED", {activeProcesses: 0}); child.emit("close", 0);});
  });
  const start = createWindowsNetworkOwnedStart({powerShellPath: resolve("powershell.exe"), bridgeScriptPath: resolve("bridge.ps1"),
    resourceLimits: limits, reducedToken: token,
    prepareLaunch: () => ({executable: resolve("node.exe"), directory: workspace.directory, arguments: ["operator.mjs"]}),
    collectResult: async () => {order.push("COLLECT"); return {videoPath: "candidate"};}}, {
    executionId, organizationId, appContainerSid: scope.appContainerSid, client, serveOriginalServer: async (identity, control, signal) => {
      const authorize = createWindowsOriginalServerAuthorization(identity, control, client);
      await authorize({address: endpoint.address, port: endpoint.port, serverUrl: `http://localhost:${endpoint.port}`}, signal);
      order.push("ACK"); queueMicrotask(() => send("ROOT_EXITED", {exitCode: 0}));
    }}, {platform: "win32", spawnBridge: () => {spawns++; return child as unknown as ChildProcessWithoutNullStreams;}});
  return {start, client, order, spawns: () => spawns};
}

test("owned network cycle denies before START and withholds candidate until seal ACK after confirmed STOP", async () => {
  let release!: () => void;
  const f = fixture(undefined, new Promise<void>(done => {release = done;}));
  const handle = f.start(descriptor, workspace, new AbortController().signal);
  let published = false;
  const completion = handle.completion.then(value => {published = true; return value;});
  for (let count = 0; count < 12 && !f.order.includes("SEAL_AFTER_STOP"); count++) await tick();
  assert.equal(published, false); assert.equal(f.spawns(), 1);
  assert.ok(f.order.indexOf("DENY_BEFORE_START") < f.order.indexOf("START"));
  assert.ok(f.order.indexOf("STOP") < f.order.indexOf("SEAL_AFTER_STOP"));
  assert.ok(f.order.includes("ACK")); release();
  assert.deepEqual(await completion, {videoPath: "candidate"});
  const first = handle.stopAndConfirm(), second = handle.stopAndConfirm(); assert.equal(first, second);
  assert.deepEqual(await first, {status: "STOPPED", executionId}); assert.equal(f.client.status(), "SEALED");
  assert.equal(f.order.filter(value => value === "SEAL_AFTER_STOP").length, 1);
  assert.throws(() => f.start(descriptor, workspace, new AbortController().signal), /RECOVERY_REQUIRED/);
});

test("STOP during pending DENY quarantines the attempt and late result never starts an untracked producer", async () => {
  let release!: () => void;
  const f = fixture(new Promise<void>(done => {release = done;}));
  const handle = f.start(descriptor, workspace, new AbortController().signal);
  await tick(); const stopping = assert.rejects(handle.stopAndConfirm(), /RECOVERY_REQUIRED/);
  await assert.rejects(handle.completion, /RECOVERY_REQUIRED/); release(); await stopping; await tick();
  assert.equal(f.spawns(), 0); assert.deepEqual(f.order, ["DENY_BEFORE_START"]);
});

test("abort during pending DENY cannot create a producer after late acknowledgment", async () => {
  let release!: () => void;
  const f = fixture(new Promise<void>(done => {release = done;})), cancellation = new AbortController();
  const handle = f.start(descriptor, workspace, cancellation.signal);
  await tick(); cancellation.abort();
  await assert.rejects(handle.completion, /RECOVERY_REQUIRED/); release();
  await assert.rejects(handle.stopAndConfirm(), /RECOVERY_REQUIRED/); await tick(); assert.equal(f.spawns(), 0);
});

test("foreign organization is rejected before deny or producer creation", () => {
  const f = fixture();
  assert.throws(() => f.start({...descriptor, organizationId: randomUUID()}, workspace, new AbortController().signal), /RECOVERY_REQUIRED/);
  assert.equal(f.spawns(), 0); assert.deepEqual(f.order, []);
});

test("failed seal never publishes an already collected candidate or claims successful cleanup", async () => {
  let rejectSeal!: (error: Error) => void;
  const f = fixture(undefined, new Promise<void>((_resolve, reject) => {rejectSeal = reject;}));
  const handle = f.start(descriptor, workspace, new AbortController().signal);
  for (let count = 0; count < 12 && !f.order.includes("SEAL_AFTER_STOP"); count++) await tick();
  assert.ok(f.order.includes("COLLECT"));
  rejectSeal(new Error("private backend failure"));
  await assert.rejects(handle.completion, /RECOVERY_REQUIRED/);
  await assert.rejects(handle.stopAndConfirm(), /RECOVERY_REQUIRED/);
  assert.equal(f.client.status(), "RECOVERY_REQUIRED");
});

test("cancelled prelaunch network attempt retains executor fence despite no producer process", async () => {
  let releaseDeny!: () => void, releases = 0;
  const f = fixture(new Promise<void>(done => {releaseDeny = done;})), cancellation = new AbortController();
  const fence: ControlledExecutionFence = {acquire: async () => ({} as Awaited<ReturnType<ControlledExecutionFence["acquire"]>>),
    releaseConfirmed: async () => {releases++;}};
  const execute = createOwnedControlledOperation({start: f.start, fence});
  const completion = execute(descriptor, workspace, cancellation.signal);
  await tick(); cancellation.abort();
  await assert.rejects(completion, /TERMINATION_UNCONFIRMED/);
  assert.equal(execute.isQuarantined(), true); assert.equal(releases, 0);
  releaseDeny(); await tick(); assert.equal(f.spawns(), 0); assert.equal(releases, 0);
});
