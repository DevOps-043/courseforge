import assert from "node:assert/strict";
import test from "node:test";
import { prepareAndPersistVisualConformanceReference } from "../qa/composition-conformance-reference-pipeline";

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

test("text option is forwarded only for explicit true without changing default capture calls", async () => {
  for (const enabled of [undefined, false, true]) {
    const state = fixture(); const original = state.dependencies.capture;
    state.dependencies.capture = async (params) => {
      assert.equal(params.captureTextRegions, enabled === true ? true : undefined);
      return original(params);
    };
    await prepareAndPersistVisualConformanceReference({...input, captureTextRegions: enabled}, state.dependencies);
  }
});

test("each failed stage disposes only acquired workspaces and never runs later stages", async () => {
  for (const [failure, calls] of [
    ["materialize", ["materialize"]], ["capture", ["materialize", "capture", "cleanup-source"]],
    ["persist", ["materialize", "capture", "persist", "cleanup-capture", "cleanup-source"]],
  ] as const) {
    const fixtureState = fixture(failure);
    await assert.rejects(prepareAndPersistVisualConformanceReference(input, fixtureState.dependencies), /controlled stage failure/);
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
