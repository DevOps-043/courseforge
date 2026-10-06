import {z} from "zod";
import {createControlledRenderDeadline, CONTROLLED_RENDER_DEADLINE_POLICY} from "./composition-controlled-render-deadline";
import type {ControlledMaterializedExecutor} from "./composition-materialized-supervisor-renderer";
import {requiresControlledExecutorIntervention, type ControlledExecutionFence, type ControlledExecutionFenceLease} from "./composition-controlled-execution-fence";

export const CONTROLLED_EXECUTOR_OWNERSHIP_POLICY = {
  id: "HOST_OWNED_EXECUTION_AND_CONFIRMED_STOP_V1",
  maximumStopMilliseconds: 5_000,
  terminationUnconfirmedCode: "CONTROLLED_RENDER_EXECUTOR_TERMINATION_UNCONFIRMED",
} as const;
const stopSchema = z.object({status: z.literal("STOPPED"), executionId: z.string().uuid()}).strict();
type Descriptor = Parameters<ControlledMaterializedExecutor>[0];
type Workspace = Parameters<ControlledMaterializedExecutor>[1];
type Result = Awaited<ReturnType<ControlledMaterializedExecutor>>;

/** The host must own the process tree before returning this synchronous handle.
 * A STOPPED response is a port obligation, not independently authenticated OS evidence. */
export type ControlledOwnedExecution = {
  completion: Promise<Result>;
  stopAndConfirm: () => Promise<unknown>;
};
export type ControlledOwnedExecutorConfiguration = {
  fence?: ControlledExecutionFence;
  start: (descriptor: Descriptor, workspace: Workspace, signal: AbortSignal) => ControlledOwnedExecution;
  timeoutMilliseconds?: number;
  stopMilliseconds?: number;
};

/** Never publish an output or release ownership merely because its root promise settled. */
export function createOwnedControlledExecutor(configuration: ControlledOwnedExecutorConfiguration):
  ControlledMaterializedExecutor & {isQuarantined: () => boolean} {
  const timeout = configuration.timeoutMilliseconds ?? CONTROLLED_RENDER_DEADLINE_POLICY.maximumMilliseconds;
  const stopMilliseconds = configuration.stopMilliseconds ?? CONTROLLED_EXECUTOR_OWNERSHIP_POLICY.maximumStopMilliseconds;
  if (typeof configuration.start !== "function" || !Number.isSafeInteger(stopMilliseconds)
    || stopMilliseconds < 1 || stopMilliseconds > CONTROLLED_EXECUTOR_OWNERSHIP_POLICY.maximumStopMilliseconds
    || !Number.isSafeInteger(timeout) || timeout < CONTROLLED_RENDER_DEADLINE_POLICY.minimumMilliseconds
    || timeout > CONTROLLED_RENDER_DEADLINE_POLICY.maximumMilliseconds)
    throw new Error("CONTROLLED_RENDER_EXECUTOR_CONFIGURATION_INVALID");
  let quarantined = false;
  const execute: ControlledMaterializedExecutor = async (descriptor, workspace, signal) => {
    if (quarantined) throw new Error(CONTROLLED_EXECUTOR_OWNERSHIP_POLICY.terminationUnconfirmedCode);
    const deadline = createControlledRenderDeadline(timeout, signal);
    let execution: ControlledOwnedExecution | undefined;
    let result: Result | undefined;
    let workError: unknown;
    let failed = false;
    let startAttempted = false;
    let fenceLease: ControlledExecutionFenceLease | undefined;
    try {
      deadline.remainingMilliseconds();
      if (configuration.fence) {
        try {fenceLease = await configuration.fence.acquire(descriptor);}
        catch (error) {
          if (error instanceof Error && error.message.startsWith("CONTROLLED_RENDER_EXECUTION_FENCE_")) throw error;
          throw new Error("CONTROLLED_RENDER_EXECUTION_FENCE_ACQUIRE_UNCONFIRMED");
        }
      }
      deadline.remainingMilliseconds();
      // Reserve ownership synchronously. An async start could yield a handle after cancellation.
      startAttempted = true;
      execution = configuration.start(structuredClone(descriptor), structuredClone(workspace), deadline.signal);
      // Observe a rejection even if an invalid handle subsequently requires quarantine.
      if (execution?.completion instanceof Promise) void execution.completion.catch(() => {});
      if (!execution || typeof execution.stopAndConfirm !== "function")
        throw new Error(CONTROLLED_EXECUTOR_OWNERSHIP_POLICY.terminationUnconfirmedCode);
      try {
        if (!(execution.completion instanceof Promise)) throw new Error("CONTROLLED_RENDER_EXECUTOR_HANDLE_INVALID");
        result = await deadline.run(() => execution!.completion);
      } catch (error) {failed = true; workError = error;}
      if (failed) deadline.cancel();
      await confirmStop(execution, descriptor.executionId, stopMilliseconds);
      if (fenceLease) {
        await releaseFence(configuration.fence!, fenceLease);
        fenceLease = undefined;
      }
      // Cancellation while waiting for confirmed stop still prevents publication.
      if (signal?.aborted) throw new Error("CONTROLLED_RENDER_ABORTED");
      if (failed) throw safeWorkError(workError);
      deadline.remainingMilliseconds();
      if (!result) throw new Error("CONTROLLED_RENDER_EXECUTOR_RESULT_INVALID");
      return result;
    } catch (error) {
      // A cancelled acquisition that completed before start may safely release its own fence.
      if (!startAttempted && fenceLease) {
        try {await releaseFence(configuration.fence!, fenceLease);}
        catch {quarantined = true; throw new Error("CONTROLLED_RENDER_EXECUTION_FENCE_RELEASE_UNCONFIRMED");}
      }
      // A start failure cannot prove whether processes were created before it threw.
      if (!execution && startAttempted) {
        quarantined = true;
        throw new Error(CONTROLLED_EXECUTOR_OWNERSHIP_POLICY.terminationUnconfirmedCode);
      }
      if (error instanceof Error && requiresControlledExecutorIntervention(error.message))
        quarantined = true;
      throw safeWorkError(error);
    } finally {deadline.dispose();}
  };
  // No automatic reset: an operator must reconcile the process tree before recreating the host.
  return Object.assign(execute, {isQuarantined: () => quarantined});
}

async function confirmStop(execution: ControlledOwnedExecution, executionId: string, timeout: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const stopped = await Promise.race([
      Promise.resolve().then(() => execution.stopAndConfirm()),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("STOP_TIMEOUT")), timeout);
      }),
    ]);
    const confirmation = stopSchema.safeParse(stopped);
    if (!confirmation.success || confirmation.data.executionId !== executionId)
      throw new Error("STOP_NOT_CONFIRMED");
  } catch {throw new Error(CONTROLLED_EXECUTOR_OWNERSHIP_POLICY.terminationUnconfirmedCode);}
  finally {if (timer) clearTimeout(timer);}
}

function safeWorkError(error: unknown) {
  return error instanceof Error && /^CONTROLLED_RENDER_[A-Z_]+$/.test(error.message)
    ? error : new Error("CONTROLLED_RENDER_EXECUTOR_FAILED");
}

async function releaseFence(fence: ControlledExecutionFence, lease: ControlledExecutionFenceLease) {
  try {await fence.releaseConfirmed(lease);}
  catch {throw new Error("CONTROLLED_RENDER_EXECUTION_FENCE_RELEASE_UNCONFIRMED");}
}
