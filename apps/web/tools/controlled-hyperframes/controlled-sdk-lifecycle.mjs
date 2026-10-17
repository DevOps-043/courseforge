import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {SDK_LIFECYCLE_POLICY} from "./controlled-sdk-policy.mjs";
export {SDK_LIFECYCLE_POLICY} from "./controlled-sdk-policy.mjs";
const appRequire = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"));
const {createControlledRenderDeadline, CONTROLLED_RENDER_DEADLINE_POLICY} = appRequire(
  "./.tmp/hyperframes-tests/domains/production/composition-editor/qa/composition-controlled-render-deadline.js");

const safeCode = error => error instanceof Error && /^(CONTROLLED_RENDER|CONFORMANCE_FILE|CONFORMANCE_BROWSER)_[A-Z_]+$/.test(error.message)
  ? error.message : "CONTROLLED_RENDER_SDK_WORKFLOW_FAILED";
export class ControlledSdkLifecycleError extends Error {
  constructor(code, cleanupCodes) {super(code); this.cleanupCodes = Object.freeze([...cleanupCodes]);}
}

/** SDK API ownership only. A closed handle is not kernel process-tree containment. */
export async function runControlledSdkWorkflow({work, publish, timeoutMs = CONTROLLED_RENDER_DEADLINE_POLICY.maximumMilliseconds,
  cleanupTimeoutMs = SDK_LIFECYCLE_POLICY.maximumCleanupMs, signal}, createDeadline = createControlledRenderDeadline) {
  if (typeof work !== "function" || typeof publish !== "function" || !Number.isSafeInteger(cleanupTimeoutMs)
    || cleanupTimeoutMs < 1 || cleanupTimeoutMs > SDK_LIFECYCLE_POLICY.maximumCleanupMs)
    throw new Error("CONTROLLED_RENDER_SDK_LIFECYCLE_INVALID");
  const deadline = createDeadline(timeoutMs, signal);
  const owned = [];
  const pendingSteps = new Set();
  let phase = "WORK";
  const step = operation => deadline.run(operation);
  const trackedStep = operation => {
    const running = step(operation);
    pendingSteps.add(running);
    void running.then(() => pendingSteps.delete(running), () => pendingSteps.delete(running));
    return running;
  };
  const controller = {signal: deadline.signal, step: operation => {
    if (phase !== "WORK") return Promise.reject(new Error("CONTROLLED_RENDER_SDK_RESOURCE_PHASE_INVALID"));
    return trackedStep(operation);
  }, remainingMilliseconds: deadline.remainingMilliseconds,
    acquire(id, factory, dispose) {
      deadline.remainingMilliseconds();
      if (phase !== "WORK" || !SDK_LIFECYCLE_POLICY.resourceIds.includes(id) || owned.some(entry => entry.id === id)
        || typeof factory !== "function" || typeof dispose !== "function")
        throw new Error("CONTROLLED_RENDER_SDK_RESOURCE_INVALID");
      const entry = {id, dispose, closePromise: undefined};
      owned.push(entry);
      // Reserve ownership before awaiting: a resource produced after abort still has a disposer.
      entry.ready = Promise.resolve().then(() => {
        deadline.remainingMilliseconds();
        if (phase !== "WORK") throw new Error("CONTROLLED_RENDER_SDK_RESOURCE_PHASE_INVALID");
        return factory();
      });
      return controller.step(() => entry.ready);
    }};
  const close = entry => {
    if (!entry.closePromise) entry.closePromise = entry.ready.then(resource => entry.dispose(resource), () => undefined);
    return entry.closePromise;
  };
  let value, primaryError, hasPrimaryError = false;
  const cleanupCodes = [];
  try {
    try {value = await step(() => work(controller));} catch (error) {primaryError = error; hasPrimaryError = true;}
    if (!hasPrimaryError && pendingSteps.size) {
      primaryError = new Error("CONTROLLED_RENDER_SDK_UNAWAITED_WORK"); hasPrimaryError = true;
    }
    if (hasPrimaryError) deadline.cancel();
    phase = "CLEANUP";
    let timer;
    try {
      // One cleanup allowance for all known handles, not one timeout per handle.
      await Promise.race([
        (async () => {
          for (const entry of [...owned].reverse()) {
            try {await close(entry);} catch {cleanupCodes.push(`CONTROLLED_RENDER_SDK_${entry.id.toUpperCase()}_CLOSE_FAILED`);}
          }
        })(),
        new Promise((_, reject) => {timer = setTimeout(() => reject(new Error("CONTROLLED_RENDER_SDK_CLEANUP_TIMEOUT")), cleanupTimeoutMs);}),
      ]);
    } catch {cleanupCodes.push("CONTROLLED_RENDER_SDK_CLEANUP_TIMEOUT");}
    finally {clearTimeout(timer);}
    // Attempt every remaining disposer even if an earlier one never settles. No unhandled rejections.
    for (const entry of owned) void close(entry).catch(() => {});
    if (hasPrimaryError) throw new ControlledSdkLifecycleError(safeCode(primaryError), cleanupCodes);
    if (cleanupCodes.length) throw new ControlledSdkLifecycleError("CONTROLLED_RENDER_SDK_CLEANUP_FAILED", cleanupCodes);
    const cleanup = {policy: SDK_LIFECYCLE_POLICY.id, scope: "SDK_API_HANDLES_NOT_PROCESS_TREE_ATTESTATION",
      status: "API_CLOSE_COMPLETED", resourceIds: owned.map(entry => entry.id),
      cleanupBudgetMs: cleanupTimeoutMs};
    // Publication happens after cleanup; expiration still invalidates its result.
    phase = "PUBLISH";
    pendingSteps.clear();
    const publisher = {signal: deadline.signal, remainingMilliseconds: deadline.remainingMilliseconds,
      step: operation => {
        if (phase !== "PUBLISH") return Promise.reject(new Error("CONTROLLED_RENDER_SDK_RESOURCE_PHASE_INVALID"));
        return trackedStep(operation);
      }};
    try {
      const published = await step(() => publish(value, cleanup, publisher));
      if (pendingSteps.size) throw new Error("CONTROLLED_RENDER_SDK_UNAWAITED_PUBLICATION");
      return published;
    } catch (error) {
      deadline.cancel();
      throw new ControlledSdkLifecycleError(safeCode(error), cleanupCodes);
    }
  } finally {phase = "CLOSED"; deadline.dispose();}
}
