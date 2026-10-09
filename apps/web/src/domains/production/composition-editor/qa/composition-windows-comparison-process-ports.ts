import {randomUUID, createHash} from "node:crypto";
import {lstat, mkdtemp, open, realpath, rmdir, unlink, writeFile} from "node:fs/promises";
import {dirname, join, resolve, isAbsolute} from "node:path";
import {createWindowsJobBridgeStart} from "./composition-windows-job-bridge";
import {createOwnedControlledOperation} from "./composition-controlled-owned-executor";
import {createControlledRenderDeadline} from "./composition-controlled-render-deadline";
import {requiresControlledExecutorIntervention, type ControlledExecutionFence} from "./composition-controlled-execution-fence";
import {admitControlledDependencyInventory, type ControlledDependencyInventoryConfiguration} from "./composition-controlled-dependency-inventory";
import {pinConformanceFile, assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";
import {readOwnedMeasurementFile} from "./composition-owned-measurement-files";
import {OWNED_MEASUREMENT_POLICY as policy, ownedMeasurementRequestSchema, ownedMeasurementReceiptSchema,
  encodeOwnedMeasurementReference, type OwnedMeasurementRequest} from "./composition-owned-measurement-contract";
import type {ControlledMaterializedExecutor} from "./composition-materialized-supervisor-renderer";
import type {ComparisonProcessPorts} from "./composition-comparison-process-ports";
import {controlledRenderExecutionContractSchema} from "../composition-render-execution-contract";
import type {WindowsJobResourceLimits} from "./composition-windows-job-resource-policy";
import type {WindowsReducedToken} from "./composition-windows-reduced-token-policy";

type Context = {descriptor: Parameters<ControlledMaterializedExecutor>[0];
  /** Compatibility only. Never read or copied; each measurement owns its own spool directory. */
  workspace?: Parameters<ControlledMaterializedExecutor>[1]};
type Configuration = Context & {dependencyInventory: ControlledDependencyInventoryConfiguration;
  /** Dedicated measurement slot, not the producer fence still held while collecting its result. */
  measurementFence: ControlledExecutionFence; outputParentDirectory: string; powerShellPath: string; bridgeScriptPath: string;
  resourceLimits?: WindowsJobResourceLimits; reducedToken?: WindowsReducedToken};
type BridgePorts = Parameters<typeof createWindowsJobBridgeStart>[1];
const failure = () => new Error("CONTROLLED_RENDER_MEASUREMENT_FAILED");
type MeasurementPins = {stdout: Awaited<ReturnType<typeof pinConformanceFile>>; stderr: Awaited<ReturnType<typeof pinConformanceFile>>};

/** Explicit operator composition, no auto-activation. Each decoder gets its own job and durable host fence.
 * Job membership is process ownership, not restricted-token/filesystem/network isolation. */
export function createWindowsComparisonProcessPorts(raw: Configuration, bridgePorts: BridgePorts = {}):
  ComparisonProcessPorts & {isQuarantined: () => boolean} {
  if ((bridgePorts.platform ?? process.platform) !== "win32") throw new Error("CONTROLLED_RENDER_WINDOWS_PLATFORM_UNSUPPORTED");
  const executionFence = raw.measurementFence;
  if (!executionFence || typeof executionFence.acquire !== "function" || typeof executionFence.releaseConfirmed !== "function")
    throw new Error("CONTROLLED_RENDER_MEASUREMENT_FENCE_REQUIRED");
  const {descriptor, dependencyInventory: inventory, outputParentDirectory, powerShellPath, bridgeScriptPath, resourceLimits, reducedToken} =
    structuredClone({descriptor: raw.descriptor, dependencyInventory: raw.dependencyInventory,
      outputParentDirectory: raw.outputParentDirectory, powerShellPath: raw.powerShellPath, bridgeScriptPath: raw.bridgeScriptPath,
      resourceLimits: raw.resourceLimits, reducedToken: raw.reducedToken});
  const execution = controlledRenderExecutionContractSchema.parse(
    descriptor.contract.schemaVersion === 4 ? descriptor.contract.renderExecution : undefined);
  if (!execution?.comparisonTools || !inventory.manifest.comparisonTools || !isAbsolute(outputParentDirectory)
    || resolve(outputParentDirectory) !== outputParentDirectory) throw failure();
  const tools = dirname(dirname(bridgeScriptPath));
  const driver = join(tools, "run-owned-measurement.mjs");
  const compiled = resolve(tools, "../../dist/composition-worker/domains/production/composition-editor/qa");
  const declared = new Map(inventory.manifest.files.map(file => [resolve(inventory.roots[file.rootId], file.path), file]));
  for (const path of [powerShellPath, bridgeScriptPath, join(dirname(bridgeScriptPath), "OwnedRenderJob.cs"),
    join(dirname(bridgeScriptPath), "OwnedRenderAccess.cs"), join(dirname(bridgeScriptPath), "OwnedRenderAppContainer.cs"), driver,
    ...["composition-owned-measurement-contract.js", "composition-owned-measurement-files.js",
      "composition-conformance-file-integrity.js", "composition-controlled-process-environment.js"].map(file => join(compiled, file))]) {
    if (!declared.has(path)) throw new Error("CONTROLLED_RENDER_MEASUREMENT_INVENTORY_REQUIRED");
  }
  const locate = (reference: {rootId: string; path: string}) => resolve(inventory.roots[reference.rootId], reference.path);
  const node = locate(inventory.manifest.roles.node);
  const pixelDecoderPath = locate(inventory.manifest.comparisonTools.pixelDecoder);
  const probePath = locate(inventory.manifest.comparisonTools.probe);
  let quarantined = false, busy = false;
  let installation: Awaited<ReturnType<typeof admitControlledDependencyInventory>> | undefined;
  const active = (signal?: AbortSignal) => {signal?.throwIfAborted(); if (quarantined)
    throw new Error("CONTROLLED_RENDER_EXECUTOR_TERMINATION_UNCONFIRMED");};

  async function withOutput<T>(binary: string, arguments_: string[], options: Pick<OwnedMeasurementRequest,
    "mode" | "maximumStdoutBytes" | "maximumStderrBytes" | "timeoutMilliseconds">,
    signal: AbortSignal | undefined, consume: (directory: string, request: OwnedMeasurementRequest,
      pins: MeasurementPins,
      operationSignal: AbortSignal) => Promise<T>) {
    active(signal);
    if (busy) throw new Error("CONTROLLED_RENDER_MEASUREMENT_BUSY");
    if (binary !== pixelDecoderPath && binary !== probePath) throw new Error("CONTROLLED_RENDER_MEASUREMENT_BINARY_UNAUTHORIZED");
    const request = ownedMeasurementRequestSchema.parse({policy: policy.id, executionId: descriptor.executionId,
      operationId: randomUUID(), binary, binarySha256: declared.get(binary)?.sha256, arguments: arguments_, ...options});
    const deadline = createControlledRenderDeadline(request.timeoutMilliseconds, signal);
    signal = deadline.signal;
    busy = true;
    let execute: {isQuarantined: () => boolean} | undefined;
    try {
      const parent = await lstat(outputParentDirectory);
      if (!parent.isDirectory() || parent.isSymbolicLink() || await realpath(outputParentDirectory) !== outputParentDirectory) throw failure();
      const directory = await mkdtemp(join(outputParentDirectory, "measurement-"));
      const directoryIdentity = await lstat(directory);
      const verifyDirectory = async () => {
        const [currentParent, currentDirectory] = await Promise.all([lstat(outputParentDirectory), lstat(directory)]);
        if (!currentParent.isDirectory() || currentParent.isSymbolicLink() || currentParent.dev !== parent.dev || currentParent.ino !== parent.ino
          || !currentDirectory.isDirectory() || currentDirectory.isSymbolicLink()
          || currentDirectory.dev !== directoryIdentity.dev || currentDirectory.ino !== directoryIdentity.ino
          || await realpath(directory) !== directory) throw new Error("CONTROLLED_RENDER_MEASUREMENT_DIRECTORY_CHANGED");
      };
      await verifyDirectory();
      const path = join(directory, policy.requestFile);
      const bytes = JSON.stringify(request);
      if (Buffer.byteLength(bytes) > policy.maximumRequestBytes) throw failure();
      await writeFile(path, bytes, {flag: "wx", mode: 0o600});
      const requestPin = await pinConformanceFile(path, policy.maximumRequestBytes, false, signal);
      const reference = encodeOwnedMeasurementReference({path, sha256: requestPin.sha256, sizeBytes: requestPin.sizeBytes});
      const start = createWindowsJobBridgeStart<MeasurementPins, {directory: string}>({powerShellPath, bridgeScriptPath, resourceLimits, reducedToken,
        prepareLaunch: () => ({executable: node, directory, arguments: [driver, "--measurement-request", reference]}),
        collectResult: async (_descriptor, _workspace, ownedSignal) => {
          await assertConformanceFileUnchanged(path, requestPin, policy.maximumRequestBytes, false, ownedSignal);
          const encoded = await readOwnedMeasurementFile(join(directory, policy.receiptFile), policy.maximumReceiptBytes, ownedSignal);
          const receipt = ownedMeasurementReceiptSchema.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(encoded.bytes)));
          if (receipt.executionId !== request.executionId || receipt.operationId !== request.operationId
            || receipt.requestSha256 !== requestPin.sha256) throw failure();
          const stdout = await pinConformanceFile(join(directory, policy.stdoutFile), request.maximumStdoutBytes, true, ownedSignal);
          const stderr = await pinConformanceFile(join(directory, policy.stderrFile), request.maximumStderrBytes, true, ownedSignal);
          for (const [pin, expected] of [[stdout, receipt.stdout], [stderr, receipt.stderr]])
            if (pin.sha256 !== expected.sha256 || pin.sizeBytes !== expected.sizeBytes) throw failure();
          return {stdout, stderr};
        }}, bridgePorts);
      deadline.remainingMilliseconds();
      // The outer signal enforces the budget including preparation; do not restart that budget here.
      const ownedExecute = createOwnedControlledOperation({start, fence: executionFence, timeoutMilliseconds: request.timeoutMilliseconds});
      execute = ownedExecute;
      const pins = await ownedExecute(descriptor, {directory}, signal, {
        verifyMeasurementFiles: async () => {
          await verifyDirectory();
          installation ??= await admitControlledDependencyInventory(inventory, execution, signal);
          await installation.assertUnchanged();
          await assertConformanceFileUnchanged(path, requestPin, policy.maximumRequestBytes, false, signal);
        },
      });
      active(signal);
      const result = await deadline.run(() => consume(directory, request, pins, signal!));
      active(signal); await installation!.assertUnchanged(); await verifyDirectory(); active(signal);
      for (const file of [policy.requestFile, policy.receiptFile, policy.stdoutFile, policy.stderrFile]) await unlink(join(directory, file));
      await rmdir(directory);
      return result;
    } catch (error) {
      if (execute?.isQuarantined() || error instanceof Error && requiresControlledExecutorIntervention(error.message)) quarantined = true;
      if (quarantined) throw new Error("CONTROLLED_RENDER_EXECUTOR_TERMINATION_UNCONFIRMED");
      active(signal);
      // Failures retain bounded spool files. No recursive cleanup, PID fallback or automatic fence reclaim.
      throw error instanceof Error && /^CONTROLLED_RENDER_[A-Z_]+$/.test(error.message) ? error : failure();
    } finally {deadline.dispose(); busy = false;}
  }

  return {pixelDecoderPath, probePath, isQuarantined: () => quarantined,
    execute: async (binary, arguments_, options) => {
      if (options.encoding !== "utf8" || options.windowsHide !== true) throw failure();
      // Never forward the supplied environment. The bridge/driver use the fixed host allowlist.
      return withOutput(binary, arguments_, {mode: "UTF8", maximumStdoutBytes: options.maxBuffer,
        maximumStderrBytes: options.maxBuffer, timeoutMilliseconds: options.timeout}, options.signal, async (directory, request, pins, operationSignal) => {
        const stdout = await readOwnedMeasurementFile(join(directory, policy.stdoutFile), request.maximumStdoutBytes, operationSignal, true);
        const stderr = await readOwnedMeasurementFile(join(directory, policy.stderrFile), request.maximumStderrBytes, operationSignal, true);
        if (stdout.pin.sha256 !== pins.stdout.sha256 || stderr.pin.sha256 !== pins.stderr.sha256) throw failure();
        const decode = (bytes: Buffer) => new TextDecoder("utf-8", {fatal: true}).decode(bytes);
        return {stdout: decode(stdout.bytes), stderr: decode(stderr.bytes)};
      });
    },
    consumePcm: async (params, launch) => {
      if (launch !== undefined) throw new Error("CONTROLLED_RENDER_MEASUREMENT_BINARY_UNAUTHORIZED");
      return withOutput(params.binary, params.arguments, {mode: "PCM", maximumStdoutBytes: params.maximumBytes,
        maximumStderrBytes: policy.maximumStderrBytes, timeoutMilliseconds: params.timeoutMilliseconds}, params.signal,
      async (directory, request, pins, operationSignal) => {
        if (pins.stdout.sizeBytes === 0) throw failure();
        const path = join(directory, policy.stdoutFile);
        if ((await lstat(path)).nlink !== 1) throw failure();
        const handle = await open(path, "r"); let count = 0; const digest = createHash("sha256");
        try {
          for await (const chunk of handle.createReadStream({autoClose: false})) {
            active(operationSignal); count += (chunk as Buffer).length;
            if (count > request.maximumStdoutBytes || count > pins.stdout.sizeBytes) throw failure();
            digest.update(chunk as Buffer);
            await params.consume(chunk as Buffer); active(operationSignal);
          }
        } finally {await handle.close();}
        if (count !== pins.stdout.sizeBytes || digest.digest("hex") !== pins.stdout.sha256) throw failure();
        await assertConformanceFileUnchanged(path, pins.stdout, request.maximumStdoutBytes, false, operationSignal);
      });
    },
  };
}
