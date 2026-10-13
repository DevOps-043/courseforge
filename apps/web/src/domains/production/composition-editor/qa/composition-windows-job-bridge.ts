import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {randomUUID} from "node:crypto";
import {isAbsolute} from "node:path";
import {z} from "zod";
import {createControlledProcessEnvironment} from "./composition-controlled-process-environment";
import type {ControlledOwnedExecutorConfiguration} from "./composition-controlled-owned-executor";
import {requiresControlledExecutorIntervention} from "./composition-controlled-execution-fence";
import {windowsJobResourceLimitsSchema, type WindowsJobResourceLimits} from "./composition-windows-job-resource-policy";
import {windowsReducedTokenSchema, type WindowsReducedToken} from "./composition-windows-reduced-token-policy";

export const WINDOWS_JOB_BRIDGE_POLICY = {id: "WINDOWS_JOB_CONTROL_CHANNEL_V1", maximumCommandBytes: 64 * 1024,
  maximumResponseBytes: 16 * 1024, maximumLineBytes: 4096} as const;
const pathSchema = z.string().min(1).max(4096).refine(value => isAbsolute(value) && !value.includes("\0"));
const launchSchema = z.object({executable: pathSchema, directory: pathSchema,
  arguments: z.array(z.string().max(8192).refine(value => !value.includes("\0"))).max(64)}).strict();
const rootIdentitySchema = z.object({pid: z.number().int().min(1).max(0xffffffff),
  creationFileTime: z.string().regex(/^[1-9][0-9]{0,19}$/).refine(value => BigInt(value) <= 0xffffffffffffffffn)}).strict();
export type WindowsOwnedRootIdentity = z.infer<typeof rootIdentitySchema>;
export type WindowsOwnedListenerObservation = {rootIdentity: WindowsOwnedRootIdentity; port: number; address: "127.0.0.1"};
export type WindowsOwnedRootControl = {
  /** Point-in-time owned socket observation only; does not authorize HTTP or attest WFP policy. */
  observeOriginalListener: (port: number) => Promise<WindowsOwnedListenerObservation>;
};
const listenerPortSchema = z.number().int().min(1).max(65535);
const maximumListenerRequests = 8, listenerDeadlineMilliseconds = 15000;
const eventSchema = z.discriminatedUnion("status", [
  z.object({status: z.literal("READY"), executionId: z.string().uuid(), rootIdentity: rootIdentitySchema.optional()}).strict(),
  z.object({status: z.literal("ROOT_EXITED"), executionId: z.string().uuid(), exitCode: z.number().int().min(0).max(0xffffffff)}).strict(),
  z.object({status: z.literal("STOPPED"), executionId: z.string().uuid(), activeProcesses: z.literal(0)}).strict(),
  z.object({status: z.literal("FAILED"), executionId: z.string().uuid()}).strict(),
  z.object({status: z.literal("LISTENER_OBSERVED"), executionId: z.string().uuid(), requestId: z.string().uuid(),
    port: listenerPortSchema, rootIdentity: rootIdentitySchema, address: z.literal("127.0.0.1")}).strict(),
]);
type Start = ControlledOwnedExecutorConfiguration["start"];
export type WindowsOwnedLaunch = z.infer<typeof launchSchema>;
export type WindowsJobBridgeConfiguration<TResult = Awaited<ReturnType<Start>["completion"]>,
  TWorkspace extends {directory: string} = Parameters<Start>[1]> = {
  powerShellPath: string; bridgeScriptPath: string;
  resourceLimits?: WindowsJobResourceLimits;
  reducedToken?: WindowsReducedToken;
  /** V4 only: trusted operator hook while the root is owned; never a document callback.
   * Its work must drain before releasing the fence, even after the producer job stops. */
  onOwnedReady?: (descriptor: Parameters<Start>[0], workspace: TWorkspace, root: WindowsOwnedRootIdentity,
    signal: AbortSignal, control: WindowsOwnedRootControl) => Promise<void>;
  /** Operator code, not CLI arguments or a script submitted by a document/user. */
  prepareLaunch: (descriptor: Parameters<Start>[0], workspace: TWorkspace) => WindowsOwnedLaunch;
  /** Must settle only after any independently owned measurement jobs close; uncertainty must propagate. */
  collectResult: (descriptor: Parameters<Start>[0], workspace: TWorkspace, signal: AbortSignal)
    => Promise<TResult>;
};
type SpawnBridge = (binary: string, args: string[], options: Parameters<typeof spawn>[2]) => ChildProcessWithoutNullStreams;
function pending<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {resolve = accept; reject = fail;});
  void promise.catch(() => {});
  return {promise, resolve, reject};
}

/** Bridges an operator driver into OwnedRenderJob. Process control only, never a security sandbox. */
export function createWindowsJobBridgeStart<TResult, TWorkspace extends {directory: string} = Parameters<Start>[1]>(configuration: WindowsJobBridgeConfiguration<TResult, TWorkspace>,
  ports: {spawnBridge?: SpawnBridge; platform?: string} = {}): ControlledOwnedExecutorConfiguration<TResult, TWorkspace>["start"] {
  const powerShell = pathSchema.parse(configuration.powerShellPath), script = pathSchema.parse(configuration.bridgeScriptPath);
  const resourceLimits = configuration.resourceLimits === undefined ? undefined
    : windowsJobResourceLimitsSchema.parse(configuration.resourceLimits);
  const reducedToken = configuration.reducedToken === undefined ? undefined : windowsReducedTokenSchema.parse(configuration.reducedToken);
  if (reducedToken && !resourceLimits) throw new Error("CONTROLLED_RENDER_WINDOWS_RESOURCE_LIMIT_REQUIRED");
  const ownedReady = configuration.onOwnedReady;
  if (ownedReady !== undefined && (typeof ownedReady !== "function" || reducedToken?.policy !== "WINDOWS_APPCONTAINER_NO_NETWORK_V5" || !resourceLimits))
    throw new Error("CONTROLLED_RENDER_WINDOWS_ROOT_IDENTITY_CONFIGURATION_INVALID");
  return (descriptor, workspace, signal) => {
    if ((ports.platform ?? process.platform) !== "win32") throw new Error("CONTROLLED_RENDER_WINDOWS_PLATFORM_UNSUPPORTED");
    signal.throwIfAborted();
    const launch = launchSchema.parse(configuration.prepareLaunch(descriptor, workspace));
    const command = JSON.stringify({policy: ownedReady ? "WINDOWS_JOB_CONTROL_CHANNEL_V4" : reducedToken ? "WINDOWS_JOB_CONTROL_CHANNEL_V3"
      : resourceLimits ? "WINDOWS_JOB_CONTROL_CHANNEL_V2" : WINDOWS_JOB_BRIDGE_POLICY.id,
      command: "START", executionId: descriptor.executionId, ...launch, ...(resourceLimits ? {resourceLimits} : {}),
      ...(reducedToken ? {reducedToken} : {})}) + "\n";
    if (Buffer.byteLength(command) > WINDOWS_JOB_BRIDGE_POLICY.maximumCommandBytes)
      throw new Error("CONTROLLED_RENDER_WINDOWS_COMMAND_LIMIT");
    const root = pending<void>(), stopped = pending<void>();
    const child = (ports.spawnBridge ?? (spawn as SpawnBridge))(powerShell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script],
      {cwd: workspace.directory, env: createControlledProcessEnvironment(process.env, launch.directory), windowsHide: true, shell: false, stdio: "pipe"});
    let ready = false, rootExited = false, stopRequested = false, stopObserved = false, closed = false, failed = false;
    let bytesSeen = 0, buffered = "", stopPromise: Promise<unknown> | undefined;
    let collection: Promise<TResult> | undefined, collectionStop: Promise<unknown> | undefined;
    let readyWork: Promise<void> | undefined;
    let ownedIdentity: WindowsOwnedRootIdentity | undefined, listenerRequests = 0, listenerChannelFailed = false;
    let listenerRequest: {requestId: string; port: number; result: ReturnType<typeof pending<WindowsOwnedListenerObservation>>} | undefined;
    const decoder = new TextDecoder("utf-8", {fatal: true});
    const fail = () => {
      if (failed) return;
      failed = true;
      const error = new Error("CONTROLLED_RENDER_WINDOWS_BRIDGE_FAILED");
      root.reject(error); stopped.reject(error);
      listenerRequest?.result.reject(error);
      // Kill-on-close is a fallback attempt, not a STOPPED confirmation. Keep the fence on uncertainty.
      try {child.kill();} catch { /* No PID-based fallback. */ }
    };
    const control: WindowsOwnedRootControl = {observeOriginalListener: async port => {
      listenerPortSchema.parse(port); signal.throwIfAborted();
      if (!ownedReady || !ownedIdentity || !ready || rootExited || stopRequested || failed || closed
        || listenerChannelFailed || listenerRequest || listenerRequests >= maximumListenerRequests)
        throw new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED");
      const request = {requestId: randomUUID(), port, result: pending<WindowsOwnedListenerObservation>()};
      listenerRequest = request; listenerRequests++;
      const abort = () => {listenerChannelFailed = true; request.result.reject(new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED"));};
      const deadline = setTimeout(abort, listenerDeadlineMilliseconds);
      signal.addEventListener("abort", abort, {once: true});
      try {
        child.stdin.write(JSON.stringify({command: "OBSERVE_ORIGINAL_LISTENER", executionId: descriptor.executionId,
          requestId: request.requestId, port}) + "\n");
        return await request.result.promise;
      } catch {
        listenerChannelFailed = true;
        throw new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED");
      } finally {
        clearTimeout(deadline); signal.removeEventListener("abort", abort);
        if (listenerRequest === request) listenerRequest = undefined;
      }
    }};
    const receive = (line: string) => {
      if (Buffer.byteLength(line) > WINDOWS_JOB_BRIDGE_POLICY.maximumLineBytes) throw new Error();
      const event = eventSchema.parse(JSON.parse(line));
      if (event.executionId !== descriptor.executionId || failed || closed) throw new Error();
      if (event.status === "READY") {
        if (ready || rootExited || stopObserved || Boolean(event.rootIdentity) !== Boolean(ownedReady)) throw new Error(); ready = true;
        ownedIdentity = event.rootIdentity && structuredClone(event.rootIdentity);
        if (ownedReady) {
          readyWork = Promise.resolve().then(async () => {
            signal.throwIfAborted();
            await ownedReady(structuredClone(descriptor), structuredClone(workspace), structuredClone(event.rootIdentity!), signal, control);
            if (listenerChannelFailed || listenerRequest) {
              listenerChannelFailed = true;
              listenerRequest?.result.reject(new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED"));
              throw new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED");
            }
          });
          void readyWork.catch(() => root.reject(new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED")));
        }
      }
      else if (event.status === "LISTENER_OBSERVED") {
        if (!listenerRequest || !ownedIdentity || rootExited || stopRequested
          || event.requestId !== listenerRequest.requestId || event.port !== listenerRequest.port
          || event.rootIdentity.pid !== ownedIdentity.pid || event.rootIdentity.creationFileTime !== ownedIdentity.creationFileTime)
          throw new Error();
        const request = listenerRequest; listenerRequest = undefined;
        request.result.resolve({port: event.port, address: event.address, rootIdentity: structuredClone(event.rootIdentity)});
      } else if (event.status === "ROOT_EXITED") {
        if (!ready || rootExited || stopObserved) throw new Error();
        rootExited = true;
        listenerRequest?.result.reject(new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED"));
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
    const confirmProducerStop = () => {
      if (!stopPromise) {
        stopRequested = true;
        listenerRequest?.result.reject(new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED"));
        try {child.stdin.end(JSON.stringify({command: "STOP", executionId: descriptor.executionId}) + "\n");} catch {fail();}
        stopPromise = stopped.promise.then(() => ({status: "STOPPED", executionId: descriptor.executionId}));
      }
      return stopPromise;
    };
    const stopAndConfirm = () => {
      const stoppedProducer = confirmProducerStop();
      if (!collection && !readyWork) return stoppedProducer;
      // The producer's empty job does not contain independently started measurement jobs.
      // Never release the parent's fence/materialized files while their collection is outstanding.
      collectionStop ??= stoppedProducer.then(async confirmation => {
        if (readyWork) {
          try {await readyWork;}
          catch {throw new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED");}
        }
        try {await collection;}
        catch (error) {
          if (error instanceof Error && requiresControlledExecutorIntervention(error.message)) throw error;
          // A settled failure without uncertain ownership still permits confirmed cleanup.
        }
        return confirmation;
      });
      return collectionStop;
    };
    const completion = root.promise.then(async () => {
      // The root exiting does not stop descendants. Freeze their writes before collecting evidence.
      await confirmProducerStop();
      signal.throwIfAborted();
      await readyWork;
      signal.throwIfAborted();
      collection = Promise.resolve().then(() => {
        signal.throwIfAborted();
        return configuration.collectResult(structuredClone(descriptor), structuredClone(workspace), signal);
      });
      return collection;
    });
    void completion.catch(() => {});
    return {completion, stopAndConfirm};
  };
}
