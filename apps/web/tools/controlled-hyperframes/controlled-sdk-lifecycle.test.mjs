import assert from "node:assert/strict";
import test from "node:test";
import {setTimeout as delay} from "node:timers/promises";
import {runControlledSdkWorkflow} from "./controlled-sdk-lifecycle.mjs";
import {createRequire} from "node:module";
const appRequire = createRequire(new URL("../../package.json", import.meta.url));
const {createControlledRenderDeadline} = appRequire("./.tmp/hyperframes-tests/domains/production/composition-editor/qa/composition-controlled-render-deadline.js");

test("SDK resources close in reverse ownership order before publication", async () => {
  const calls = [];
  const result = await runControlledSdkWorkflow({work: async controller => {
    for (const id of ["server", "capture", "cdp", "text"])
      await controller.acquire(id, async () => id, async resource => {calls.push(`close:${resource}`);});
    return "result";
  }, publish: async (value, cleanup) => {calls.push("publish"); assert.equal(cleanup.scope,
    "SDK_API_HANDLES_NOT_PROCESS_TREE_ATTESTATION"); return value;}});
  assert.equal(result, "result"); assert.deepEqual(calls, ["close:text", "close:cdp", "close:capture", "close:server", "publish"]);
});
test("primary errors survive cleanup failures without leaking private errors", async () => {
  const calls = [];
  await assert.rejects(runControlledSdkWorkflow({work: async controller => {
    await controller.acquire("server", async () => 1, async () => {calls.push("server");});
    await controller.acquire("capture", async () => 2, async () => {calls.push("capture"); throw new Error("private URL");});
    throw new Error("CONTROLLED_RENDER_CAPTURE_READINESS_FAILED");
  }, publish: async () => {assert.fail("must not publish");}}), error => {
    assert.equal(error.message, "CONTROLLED_RENDER_CAPTURE_READINESS_FAILED");
    assert.deepEqual(error.cleanupCodes, ["CONTROLLED_RENDER_SDK_CAPTURE_CLOSE_FAILED"]); return true;
  });
  assert.deepEqual(calls, ["capture", "server"]);
});
test("a resource acquired after abort is closed, not used or published", async () => {
  const external = new AbortController(); let closeCount = 0, continued = false;
  await assert.rejects(runControlledSdkWorkflow({signal: external.signal, work: async controller => {
    await controller.acquire("capture", async () => {external.abort("private reason"); await delay(5); return {};},
      async () => {closeCount++;}); continued = true;
  }, publish: async () => {assert.fail("must not publish");}}), /CONTROLLED_RENDER_ABORTED/);
  assert.equal(closeCount, 1); assert.equal(continued, false);
});
test("cleanup cannot hang indefinitely or skip remaining disposers", async () => {
  let serverClosed = false;
  await assert.rejects(runControlledSdkWorkflow({cleanupTimeoutMs: 10, work: async controller => {
    await controller.acquire("server", async () => 1, async () => {serverClosed = true;});
    await controller.acquire("capture", async () => 2, () => new Promise(() => {}));
  }, publish: async () => {assert.fail("must not publish");}}), error => {
    assert.equal(error.message, "CONTROLLED_RENDER_SDK_CLEANUP_FAILED");
    assert.deepEqual(error.cleanupCodes, ["CONTROLLED_RENDER_SDK_CLEANUP_TIMEOUT"]); return true;
  });
  await delay(0); assert.equal(serverClosed, true);
});
test("unknown/duplicate ownership and arbitrary workflow failures are sanitized", async () => {
  for (const duplicate of [false, true]) await assert.rejects(runControlledSdkWorkflow({work: async controller => {
    await controller.acquire("server", async () => 1, async () => {});
    await controller.acquire(duplicate ? "server" : "foreign", async () => 2, async () => {});
  }, publish: async () => {assert.fail("must not publish");}}), /SDK_RESOURCE_INVALID/);
  for (const failure of [new Error("private file path"), undefined, null, "", 0])
    await assert.rejects(runControlledSdkWorkflow({work: async () => {throw failure;},
      publish: async () => {assert.fail("must not publish");}}), error => error.message === "CONTROLLED_RENDER_SDK_WORKFLOW_FAILED");
});
test("cleanup failure alone blocks receipt publication", async () => {
  await assert.rejects(runControlledSdkWorkflow({work: async controller => {
    await controller.acquire("text", async () => 1, async () => {throw new Error("private");}); return "result";
  }, publish: async () => {assert.fail("must not publish");}}), error => {
    assert.equal(error.message, "CONTROLLED_RENDER_SDK_CLEANUP_FAILED");
    assert.deepEqual(error.cleanupCodes, ["CONTROLLED_RENDER_SDK_TEXT_CLOSE_FAILED"]); return true;
  });
});
test("abort after work cannot be erased by a successful cleanup", async () => {
  const external = new AbortController();
  await assert.rejects(runControlledSdkWorkflow({signal: external.signal, work: async controller => {
    await controller.acquire("server", async () => 1, async () => {external.abort();}); return "result";
  }, publish: async () => {assert.fail("must not publish");}}), /CONTROLLED_RENDER_ABORTED/);
});
test("invalid lifecycle budgets fail before work or ownership", async () => {
  for (const cleanupTimeoutMs of [0, 5001, NaN, 0.5])
    await assert.rejects(runControlledSdkWorkflow({cleanupTimeoutMs,
      work: async () => {assert.fail("must not work");}, publish: async () => {assert.fail("must not publish");}}), /LIFECYCLE_INVALID/);
});
test("work cannot restart during publication or after lifecycle closes", async () => {
  let workController, publisher;
  await runControlledSdkWorkflow({work: async controller => {workController = controller; return "result";},
    publish: async (_value, _cleanup, controller) => {
      publisher = controller;
      await assert.rejects(workController.step(async () => {assert.fail("late work");}), /PHASE_INVALID/);
      await controller.step(async () => {});
    }});
  await assert.rejects(workController.step(async () => {assert.fail("late work");}), /PHASE_INVALID/);
  await assert.rejects(publisher.step(async () => {assert.fail("late publish");}), /PHASE_INVALID/);
});
test("SDK steps consume one budget and expiration still cleans owned resources", async () => {
  let milliseconds = 0, closed = false;
  await assert.rejects(runControlledSdkWorkflow({timeoutMs: 1000, work: async controller => {
    await controller.acquire("server", async () => 1, async () => {closed = true;});
    await controller.step(async () => {milliseconds = 750;});
    assert.equal(controller.remainingMilliseconds(), 250);
    await controller.step(async () => {milliseconds = 1000;});
  }, publish: async () => {assert.fail("must not publish");}},
  (timeout, signal) => createControlledRenderDeadline(timeout, signal, () => milliseconds)), /DEADLINE_EXCEEDED/);
  assert.equal(closed, true);
});
test("unawaited SDK work blocks publication and is signalled to cancel", async () => {
  let cancelled = false;
  await assert.rejects(runControlledSdkWorkflow({work: async controller => {
    void controller.step(signal => new Promise(resolve => {signal.addEventListener("abort", () => {cancelled = true; resolve();}, {once: true});}));
    return "premature result";
  }, publish: async () => {assert.fail("must not publish");}}), /SDK_UNAWAITED_WORK/);
  assert.equal(cancelled, true);
});
test("publication verification failures stay sanitized after resources close", async () => {
  let closed = false;
  await assert.rejects(runControlledSdkWorkflow({work: async controller => {
    await controller.acquire("server", async () => 1, async () => {closed = true;}); return "result";
  }, publish: async () => {
    assert.equal(closed, true); throw new Error("CONFORMANCE_FILE_CHANGED");
  }}), error => {
    assert.equal(error.message, "CONFORMANCE_FILE_CHANGED"); assert.deepEqual(error.cleanupCodes, []); return true;
  });
});
test("unawaited acquisition still owns and closes the resource that appears late", async () => {
  let closed = 0;
  await assert.rejects(runControlledSdkWorkflow({work: async controller => {
    void controller.acquire("capture", async () => {await delay(5); return {};}, async () => {closed++;});
    return "premature result";
  }, publish: async () => {assert.fail("must not publish");}}), /SDK_UNAWAITED_WORK/);
  assert.equal(closed, 1);
});

test("unawaited publication is rejected and its unfinished checks receive cancellation", async () => {
  let cancelled = false;
  await assert.rejects(runControlledSdkWorkflow({work: async () => "result",
    publish: async (_value, _cleanup, publisher) => {
      void publisher.step(signal => new Promise(resolve => {
        signal.addEventListener("abort", () => {cancelled = true; resolve();}, {once: true});
      }));
      return "premature success";
    }}), /SDK_UNAWAITED_PUBLICATION/);
  assert.equal(cancelled, true);
});

test("publication failure aborts sibling verification operations and keeps the primary code", async () => {
  let cancelled = false;
  await assert.rejects(runControlledSdkWorkflow({work: async () => "result",
    publish: async (_value, _cleanup, publisher) => {
      void publisher.step(signal => new Promise(resolve => {
        signal.addEventListener("abort", () => {cancelled = true; resolve();}, {once: true});
      }));
      throw new Error("CONFORMANCE_FILE_CHANGED");
    }}), /CONFORMANCE_FILE_CHANGED/);
  assert.equal(cancelled, true);
});
