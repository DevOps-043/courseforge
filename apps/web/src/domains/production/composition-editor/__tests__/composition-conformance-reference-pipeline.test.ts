import assert from "node:assert/strict";
import test from "node:test";
import { prepareAndPersistVisualConformanceReference } from "../qa/composition-conformance-reference-pipeline";
import { ConformanceStageFailure, wrapConformanceStageFailure } from "../qa/composition-conformance-stage-failure";

const identifier = "70000000-0000-4000-8000-000000000001";
const input = { supabase: {} as never, supabaseUrl: "https://example.supabase.co", organizationId: identifier,
  revisionId: identifier, outputParentDirectory: "controlled-parent" };
function fixture(failure?: "materialize" | "capture" | "persist" | "cleanup") {
  const calls: string[] = [];
  const dependencies = {
    materialize: async () => {
      calls.push("materialize"); if (failure === "materialize") throw new Error("controlled stage failure");
      return { directory: "source", cleanup: async () => { calls.push("cleanup-source"); } };
    },
    capture: async () => {
      calls.push("capture"); if (failure === "capture") throw new Error("controlled stage failure");
      return { directory: "capture", cleanup: async () => {
        calls.push("cleanup-capture"); if (failure === "cleanup") throw new Error("controlled cleanup failure");
      } };
    },
    persist: async (params: { captureDirectory: string }) => {
      calls.push("persist"); assert.equal(params.captureDirectory, "capture");
      if (failure === "persist") throw new Error("controlled stage failure");
      return { status: "VISUAL_CAPTURED_AUDIO_PENDING" };
    },
  } as unknown as NonNullable<Parameters<typeof prepareAndPersistVisualConformanceReference>[1]>;
  return { calls, dependencies };
}

test("pipeline uses capture output rather than operator files and disposes both stages after persisting", async () => {
  const fixtureState = fixture();
  assert.equal((await prepareAndPersistVisualConformanceReference(input, fixtureState.dependencies)).status, "VISUAL_CAPTURED_AUDIO_PENDING");
  assert.deepEqual(fixtureState.calls, ["materialize", "capture", "persist", "cleanup-capture", "cleanup-source"]);
});

test("cancelled materialization or capture cannot start persistence and still disposes acquired workspaces", async () => {
  for (const boundary of ["materialize", "capture", "persist"] as const) {
    const state = fixture(), cancellation = new AbortController();
    const original = state.dependencies[boundary];
    (state.dependencies as any)[boundary] = async (...args: unknown[]) => {
      const result = await (original as any)(...args); cancellation.abort("private reason"); return result;
    };
    await assert.rejects(prepareAndPersistVisualConformanceReference({...input, signal: cancellation.signal}, state.dependencies),
      /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
    assert.ok(state.calls.includes("cleanup-source"));
    if (boundary !== "materialize") assert.ok(state.calls.includes("cleanup-capture"));
    if (boundary !== "persist") assert.equal(state.calls.includes("persist"), false);
  }
});

test("text option is forwarded only for explicit true without changing default capture calls", async () => {
  for (const enabled of [undefined, false, true]) {
    const state = fixture(); const original = state.dependencies.capture;
    state.dependencies.capture = async (params) => {
      assert.equal(params.captureTextRegions, enabled === true ? true : undefined);
      assert.equal(params.captureTextPaintMasks, enabled === true ? true : undefined);
      return original(params);
    };
    await prepareAndPersistVisualConformanceReference({...input, captureTextRegions: enabled, captureTextPaintMasks: enabled}, state.dependencies);
  }
});

test("each failed stage disposes only acquired workspaces and never runs later stages", async () => {
  for (const [failure, stage, calls] of [
    ["materialize", "SOURCE_MATERIALIZATION", ["materialize"]],
    ["capture", "PREVIEW_CAPTURE", ["materialize", "capture", "cleanup-source"]],
    ["persist", "EVIDENCE_PERSISTENCE", ["materialize", "capture", "persist", "cleanup-capture", "cleanup-source"]],
  ] as const) {
    const fixtureState = fixture(failure);
    await assert.rejects(prepareAndPersistVisualConformanceReference(input, fixtureState.dependencies), (error: unknown) => {
      assert.ok(error instanceof ConformanceStageFailure);
      assert.equal(error.stage, stage);
      assert.equal(wrapConformanceStageFailure("PREVIEW_REFERENCE", error), error);
      assert.equal(error.cleanupFailed, false);
      return true;
    });
    assert.deepEqual(fixtureState.calls, calls);
  }
});

test("event partition index and the captured contract reach persistence without substituting the root", async () => {
  const state = fixture();
  const selectedContract = {controlled: "selected partition"};
  const capture = state.dependencies.capture, persist = state.dependencies.persist;
  state.dependencies.capture = async (params) => {
    assert.equal(params.eventBatchIndex, 1);
    return {...await capture(params), contract: selectedContract as never};
  };
  state.dependencies.persist = async (params) => {
    assert.equal(params.eventBatchIndex, 1); assert.deepEqual(params.eventContract, selectedContract);
    return persist(params);
  };
  await prepareAndPersistVisualConformanceReference({...input, eventBatchIndex: 1}, state.dependencies);
  assert.deepEqual(state.calls, ["materialize", "capture", "persist", "cleanup-capture", "cleanup-source"]);
});

test("cleanup failure is explicit but does not skip cleanup of the other workspace", async () => {
  const fixtureState = fixture("cleanup");
  await assert.rejects(prepareAndPersistVisualConformanceReference(input, fixtureState.dependencies), /CLEANUP_FAILED/);
  assert.ok(fixtureState.calls.includes("cleanup-source"));
});

test("persistence rejection survives a secondary cleanup failure and both workspaces are disposed", async () => {
  const state = fixture("cleanup");
  state.dependencies.persist = async () => {
    state.calls.push("persist");
    throw new Error("CONFORMANCE_JOB_REVISION_MISMATCH");
  };
  await assert.rejects(prepareAndPersistVisualConformanceReference(input, state.dependencies), (error: unknown) => {
    assert.ok(error instanceof ConformanceStageFailure);
    assert.equal(error.stage, "EVIDENCE_PERSISTENCE");
    assert.equal(error.cleanupFailed, true);
    assert.equal(error.retryable, false);
    assert.equal(error.errorCode, "CONFORMANCE_JOB_EVIDENCE_PERSISTENCE_WITH_CLEANUP_REJECTED");
    return true;
  });
  assert.deepEqual(state.calls, ["materialize", "capture", "persist", "cleanup-capture", "cleanup-source"]);
});
