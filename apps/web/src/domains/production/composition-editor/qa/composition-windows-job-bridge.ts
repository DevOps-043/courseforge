import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {isAbsolute} from "node:path";
import {z} from "zod";
import {createControlledProcessEnvironment} from "./composition-controlled-process-environment";
import type {ControlledOwnedExecutorConfiguration} from "./composition-controlled-owned-executor";

export const WINDOWS_JOB_BRIDGE_POLICY = {id: "WINDOWS_JOB_CONTROL_CHANNEL_V1", maximumCommandBytes: 64 * 1024,
  maximumResponseBytes: 16 * 1024, maximumLineBytes: 4096} as const;
const pathSchema = z.string().min(1).max(4096).refine(value => isAbsolute(value) && !value.includes("\0"));
const launchSchema = z.object({executable: pathSchema, directory: pathSchema,
  arguments: z.array(z.string().max(8192).refine(value => !value.includes("\0"))).max(64)}).strict();
const eventSchema = z.discriminatedUnion("status", [
  z.object({status: z.literal("READY"), executionId: z.string().uuid()}).strict(),
  z.object({status: z.literal("ROOT_EXITED"), executionId: z.string().uuid(), exitCode: z.number().int().min(0).max(0xffffffff)}).strict(),
  z.object({status: z.literal("STOPPED"), executionId: z.string().uuid(), activeProcesses: z.literal(0)}).strict(),
  z.object({status: z.literal("FAILED"), executionId: z.string().uuid()}).strict(),
]);
type Start = ControlledOwnedExecutorConfiguration["start"];
export type WindowsOwnedLaunch = z.infer<typeof launchSchema>;
export type WindowsJobBridgeConfiguration = {
  powerShellPath: string; bridgeScriptPath: string;
  /** Operator code, not CLI arguments or a script submitted by a document/user. */
  prepareLaunch: (descriptor: Parameters<Start>[0], workspace: Parameters<Start>[1]) => WindowsOwnedLaunch;
  collectResult: (descriptor: Parameters<Start>[0], workspace: Parameters<Start>[1], signal: AbortSignal)
    => ReturnType<Start>["completion"];
};
type SpawnBridge = (binary: string, args: string[], options: Parameters<typeof spawn>[2]) => ChildProcessWithoutNullStreams;
function pending<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {resolve = accept; reject = fail;});
  void promise.catch(() => {});
  return {promise, resolve, reject};
}

/** Bridges an operator driver into OwnedRenderJob. Process control only, never a security sandbox. */
export function createWindowsJobBridgeStart(configuration: WindowsJobBridgeConfiguration,
  ports: {spawnBridge?: SpawnBridge; platform?: string} = {}): Start {
  const powerShell = pathSchema.parse(configuration.powerShellPath), script = pathSchema.parse(configuration.bridgeScriptPath);
  return (descriptor, workspace, signal) => {
    if ((ports.platform ?? process.platform) !== "win32") throw new Error("CONTROLLED_RENDER_WINDOWS_PLATFORM_UNSUPPORTED");
    signal.throwIfAborted();
    const launch = launchSchema.parse(configuration.prepareLaunch(descriptor, workspace));
    const command = JSON.stringify({policy: WINDOWS_JOB_BRIDGE_POLICY.id, command: "START", executionId: descriptor.executionId, ...launch}) + "\n";
    if (Buffer.byteLength(command) > WINDOWS_JOB_BRIDGE_POLICY.maximumCommandBytes)
      throw new Error("CONTROLLED_RENDER_WINDOWS_COMMAND_LIMIT");
    const root = pending<void>(), stopped = pending<void>();
    const child = (ports.spawnBridge ?? (spawn as SpawnBridge))(powerShell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script],
      {cwd: workspace.directory, env: createControlledProcessEnvironment(), windowsHide: true, shell: false, stdio: "pipe"});
    let ready = false, rootExited = false, stopRequested = false, stopObserved = false, closed = false, failed = false;
    let bytesSeen = 0, buffered = "", stopPromise: Promise<unknown> | undefined;
    const decoder = new TextDecoder("utf-8", {fatal: true});
    const fail = () => {
      if (failed) return;
      failed = true;
      const error = new Error("CONTROLLED_RENDER_WINDOWS_BRIDGE_FAILED");
      root.reject(error); stopped.reject(error);
      // Kill-on-close is a fallback attempt, not a STOPPED confirmation. Keep the fence on uncertainty.
      try {child.kill();} catch { /* No PID-based fallback. */ }
    };
    const receive = (line: string) => {
      if (Buffer.byteLength(line) > WINDOWS_JOB_BRIDGE_POLICY.maximumLineBytes) throw new Error();
      const event = eventSchema.parse(JSON.parse(line));
      if (event.executionId !== descriptor.executionId || failed || closed) throw new Error();
      if (event.status === "READY") {if (ready || rootExited || stopObserved) throw new Error(); ready = true;}
      else if (event.status === "ROOT_EXITED") {
        if (!ready || rootExited || stopObserved) throw new Error();
        rootExited = true;
        if (event.exitCode === 0) root.resolve(); else root.reject(new Error("CONTROLLED_RENDER_WINDOWS_ROOT_FAILED"));
      } else if (event.status === "STOPPED") {
        if (!ready || !stopRequested || stopObserved) throw new Error();
        stopObserved = true;
        if (!rootExited) root.reject(new Error("CONTROLLED_RENDER_ABORTED"));
      } else fail();
    };
    child.stdout.on("data", (chunk: Buffer) => {
      try {
        bytesSeen += chunk.length;
        if (bytesSeen > WINDOWS_JOB_BRIDGE_POLICY.maximumResponseBytes) throw new Error();
        buffered += decoder.decode(chunk, {stream: true});
        let boundary: number;
        while ((boundary = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, boundary).replace(/\r$/, ""); buffered = buffered.slice(boundary + 1);
          receive(line);
        }
        if (Buffer.byteLength(buffered) > WINDOWS_JOB_BRIDGE_POLICY.maximumLineBytes) throw new Error();
      } catch {fail();}
    });
    // stderr is bounded but never emitted, logged, or used as evidence.
    child.stderr.on("data", (chunk: Buffer) => {bytesSeen += chunk.length; if (bytesSeen > WINDOWS_JOB_BRIDGE_POLICY.maximumResponseBytes) fail();});
    child.once("error", fail); child.stdin.on("error", fail);
    child.once("close", (code: number | null) => {
      try {buffered += decoder.decode(); if (buffered || code !== 0 || !stopObserved || failed) throw new Error();}
      catch {fail(); return;}
      closed = true; stopped.resolve();
    });
    try {child.stdin.write(command);} catch {fail();}
    const stopAndConfirm = () => {
      if (!stopPromise) {
        stopRequested = true;
        try {child.stdin.end(JSON.stringify({command: "STOP", executionId: descriptor.executionId}) + "\n");} catch {fail();}
        stopPromise = stopped.promise.then(() => ({status: "STOPPED", executionId: descriptor.executionId}));
      }
      return stopPromise;
    };
    const completion = root.promise.then(async () => {
      // The root exiting does not stop descendants. Freeze their writes before collecting evidence.
      await stopAndConfirm();
      signal.throwIfAborted();
      return configuration.collectResult(structuredClone(descriptor), structuredClone(workspace), signal);
    });
    void completion.catch(() => {});
    return {completion, stopAndConfirm};
  };
}
