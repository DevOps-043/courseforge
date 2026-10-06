import assert from "node:assert/strict";
import test from "node:test";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {resolve} from "node:path";
import type {ChildProcessWithoutNullStreams} from "node:child_process";
import {createWindowsJobBridgeStart} from "../qa/composition-windows-job-bridge";
import {createOwnedControlledExecutor} from "../qa/composition-controlled-owned-executor";
import {createWindowsControlledRenderWorkerHost} from "../qa/composition-windows-render-worker-host";
import type {ControlledOwnedExecutorConfiguration} from "../qa/composition-controlled-owned-executor";
const executionId = "00000000-0000-4000-8000-000000000001";
type Start = ControlledOwnedExecutorConfiguration["start"];
const descriptor = {executionId} as Parameters<Start>[0];
const workspace = {directory: resolve("apps/web/.tmp")} as Parameters<Start>[1];
const result = {videoPath: "operator output"} as Awaited<ReturnType<Start>["completion"]>;
function fixture() {
  const child = Object.assign(new EventEmitter(), {stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: () => {kills++; return true;}});
  let kills = 0, calls = 0, collections = 0;
  const commands: string[] = [];
  child.stdin.on("data", (chunk: Buffer) => commands.push(chunk.toString("utf8")));
  const configuration = {powerShellPath: resolve("powershell.exe"), bridgeScriptPath: resolve("owned-job-bridge.ps1"),
    prepareLaunch: () => ({executable: resolve("node.exe"), directory: workspace.directory, arguments: ["operator-driver.mjs"]}),
    collectResult: async () => {collections++; return result;}};
  const spawnBridge = (binary: string, args: string[], options: Parameters<typeof import("node:child_process").spawn>[2]) => {
    calls++; assert.equal(binary, configuration.powerShellPath);
    assert.deepEqual(args, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", configuration.bridgeScriptPath]);
    assert.equal(options?.shell, false); assert.equal(options?.windowsHide, true);
    assert.equal(options?.env?.SUPABASE_SERVICE_ROLE_KEY, undefined);
    return child as unknown as ChildProcessWithoutNullStreams;
  };
  const start = createWindowsJobBridgeStart(configuration, {spawnBridge, platform: "win32"});
  return {child, start, configuration, spawnBridge, commands, counts: () => ({kills, calls, collections}),
    send: (status: string, extra = {}) => child.stdout.write(Buffer.from(JSON.stringify({status, executionId, ...extra}) + "\n"))};
}

test("bridge keeps command in stdin and requires stop metadata plus clean bridge exit", async () => {
  const f = fixture(), handle = f.start(descriptor, workspace, new AbortController().signal);
  assert.equal(JSON.parse(f.commands[0]).executionId, executionId);
  f.send("READY"); f.send("ROOT_EXITED", {exitCode: 0});
  await Promise.resolve();
  assert.equal(f.counts().collections, 0);
  let confirmed = false;
  const stopping = handle.stopAndConfirm().then(value => {confirmed = true; return value;});
  assert.equal(f.commands.length, 2);
  f.send("STOPPED", {activeProcesses: 0}); await Promise.resolve(); assert.equal(confirmed, false);
  assert.equal(f.counts().collections, 0);
  f.child.emit("close", 0);
  assert.deepEqual(await stopping, {status: "STOPPED", executionId});
  assert.equal(await handle.completion, result);
  assert.equal(f.counts().collections, 1);
  assert.equal(f.counts().kills, 0);
});

test("duplicate stop calls write one command and share one confirmation", async () => {
  const f = fixture(), handle = f.start(descriptor, workspace, new AbortController().signal);
  f.send("READY"); f.send("ROOT_EXITED", {exitCode: 0}); await Promise.resolve();
  const first = handle.stopAndConfirm(), second = handle.stopAndConfirm();
  assert.equal(first, second); assert.equal(f.commands.length, 2);
  f.send("STOPPED", {activeProcesses: 0}); f.child.emit("close", 0); await first;
  await handle.completion;
});

test("nonzero root never collects artifacts but still permits confirmed job termination", async () => {
  const f = fixture(), handle = f.start(descriptor, workspace, new AbortController().signal);
  f.send("READY"); f.send("ROOT_EXITED", {exitCode: 2});
  await assert.rejects(handle.completion, /WINDOWS_ROOT_FAILED/);
  const stopping = handle.stopAndConfirm(); f.send("STOPPED", {activeProcesses: 0}); f.child.emit("close", 0);
  await stopping; assert.equal(f.counts().collections, 0);
});

test("foreign, extra, duplicated and out-of-order protocol states fail closed", async () => {
  for (const invalid of ["foreign", "extra", "duplicate", "order", "unsolicited-stop"]) {
    const f = fixture(), handle = f.start(descriptor, workspace, new AbortController().signal);
    if (invalid === "foreign") f.send("READY", {executionId: "00000000-0000-4000-8000-000000000002"});
    if (invalid === "extra") f.send("READY", {extra: true});
    if (invalid === "duplicate") {f.send("READY"); f.send("READY");}
    if (invalid === "order") f.send("ROOT_EXITED", {exitCode: 0});
    if (invalid === "unsolicited-stop") {f.send("READY"); f.send("STOPPED", {activeProcesses: 0});}
    await assert.rejects(handle.completion, /WINDOWS_BRIDGE_FAILED/);
    await assert.rejects(handle.stopAndConfirm(), /WINDOWS_BRIDGE_FAILED/);
    assert.equal(f.counts().kills, 1);
  }
});

test("invalid UTF8, oversized channel and truncated output never become confirmation", async () => {
  for (const invalid of ["utf8", "oversize", "truncated", "stderr"]) {
    const f = fixture(), handle = f.start(descriptor, workspace, new AbortController().signal);
    if (invalid === "utf8") f.child.stdout.write(Buffer.from([0xff]));
    if (invalid === "oversize") f.child.stdout.write(Buffer.alloc(17000, 65));
    if (invalid === "truncated") {f.child.stdout.write(Buffer.from('{"status":')); f.child.emit("close", 0);}
    if (invalid === "stderr") f.child.stderr.write(Buffer.alloc(17000, 65));
    await assert.rejects(handle.completion, {message: "CONTROLLED_RENDER_WINDOWS_BRIDGE_FAILED"});
    await assert.rejects(handle.stopAndConfirm(), /WINDOWS_BRIDGE_FAILED/);
  }
});

test("STOPPED cannot grant success if bridge exits with failure or without acknowledgment", async () => {
  for (const acknowledged of [true, false]) {
    const f = fixture(), handle = f.start(descriptor, workspace, new AbortController().signal);
    f.send("READY"); f.send("ROOT_EXITED", {exitCode: 0}); await Promise.resolve();
    const stopping = handle.stopAndConfirm();
    if (acknowledged) f.send("STOPPED", {activeProcesses: 0});
    f.child.emit("close", acknowledged ? 1 : 0);
    await assert.rejects(stopping, /WINDOWS_BRIDGE_FAILED/);
    await assert.rejects(handle.completion, /WINDOWS_BRIDGE_FAILED/);
    assert.equal(f.counts().collections, 0);
  }
});

test("abort after root exit and before confirmed closure never collects evidence", async () => {
  const f = fixture(), controller = new AbortController();
  const handle = f.start(descriptor, workspace, controller.signal);
  f.send("READY"); f.send("ROOT_EXITED", {exitCode: 0});
  await Promise.resolve();
  assert.equal(JSON.parse(f.commands[1]).command, "STOP");
  controller.abort();
  f.send("STOPPED", {activeProcesses: 0}); f.child.emit("close", 0);
  await assert.rejects(handle.completion);
  await handle.stopAndConfirm();
  assert.equal(f.counts().collections, 0);
});

test("owned lifecycle completes without circular wait and collects only after bridge closure", async () => {
  const f = fixture();
  const execute = createOwnedControlledExecutor({start: f.start});
  const running = execute(descriptor, workspace, new AbortController().signal);
  f.send("READY"); f.send("ROOT_EXITED", {exitCode: 0});
  await new Promise<void>(finish => setImmediate(finish));
  assert.equal(f.commands.length, 2);
  assert.equal(f.counts().collections, 0);
  f.send("STOPPED", {activeProcesses: 0}); f.child.emit("close", 0);
  assert.equal(await running, result);
  assert.equal(f.counts().collections, 1);
  assert.equal(f.commands.length, 2);
});

test("shared lifecycle abort requests STOP and requires bridge exit before rejecting", async () => {
  const f = fixture(), controller = new AbortController();
  const execute = createOwnedControlledExecutor({start: f.start});
  const running = execute(descriptor, workspace, controller.signal);
  const rejection = assert.rejects(running, /CONTROLLED_RENDER_ABORTED/);
  f.send("READY"); controller.abort();
  await new Promise<void>(finish => setImmediate(finish));
  assert.equal(JSON.parse(f.commands[1]).command, "STOP");
  f.send("STOPPED", {activeProcesses: 0}); f.child.emit("close", 0);
  await rejection; assert.equal(f.counts().collections, 0);
});

test("platform, pre-abort and oversized commands prevent bridge spawn", () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  assert.throws(() => f.start(descriptor, workspace, controller.signal));
  const otherPlatform = createWindowsJobBridgeStart(f.configuration, {platform: "linux", spawnBridge: f.spawnBridge});
  assert.throws(() => otherPlatform(descriptor, workspace, new AbortController().signal), /PLATFORM_UNSUPPORTED/);
  const oversized = createWindowsJobBridgeStart({...f.configuration,
    prepareLaunch: () => ({executable: resolve("node.exe"), directory: workspace.directory, arguments: Array(20).fill("a".repeat(8192))})},
  {platform: "win32", spawnBridge: f.spawnBridge});
  assert.throws(() => oversized(descriptor, workspace, new AbortController().signal), /COMMAND_LIMIT/);
  assert.equal(f.counts().calls, 0);
});

test("Windows host factory rejects a bridge outside declared inventory without acquiring keys or spawning", () => {
  const f = fixture();
  assert.throws(() => createWindowsControlledRenderWorkerHost({dependencyInventory: {manifest: {files: []}, roots: {}},
    jobBridge: f.configuration} as never), process.platform === "win32" ? /BRIDGE_INVENTORY_REQUIRED/ : /PLATFORM_UNSUPPORTED/);
  assert.equal(f.counts().calls, 0);
});
