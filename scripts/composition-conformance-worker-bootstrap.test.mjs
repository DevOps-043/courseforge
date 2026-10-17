import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {createConformanceWorkerExecutor} from "./composition-conformance-worker-bootstrap.mjs";

const input = environment => ({environment, supabase: {}, supabaseUrl: "https://project.supabase.co", integrity: {}});
test("unknown mode and ambiguous legacy configuration fail without loading a fallback executor", async () => {
  await assert.rejects(createConformanceWorkerExecutor(input({HYPERFRAMES_CONFORMANCE_EXECUTION_MODE: "unknown"})), /EXECUTION_MODE_INVALID/);
  await assert.rejects(createConformanceWorkerExecutor(input({HYPERFRAMES_CONFORMANCE_WINDOWS_CONFIG_PATH: "operator.json"})), /EXECUTION_MODE_INVALID/);
});
test("reserved Windows mode requires explicit pinned configuration, not a synthetic default", async () => {
  await assert.rejects(createConformanceWorkerExecutor(input({HYPERFRAMES_CONFORMANCE_EXECUTION_MODE: "windows-reserved-v1"})),
    /HOST_CONFIGURATION_REQUIRED_INVALID|WINDOWS_PLATFORM_UNSUPPORTED/);
});
test("worker keeps activation flag and fixed bootstrap before claims; reserved branch avoids Remotion fallback", async () => {
  const runner = await readFile(new URL("./run-composition-conformance-worker.mjs", import.meta.url), "utf8");
  const bootstrap = await readFile(new URL("./composition-conformance-worker-bootstrap.mjs", import.meta.url), "utf8");
  assert.ok(runner.indexOf("WORKER_NOT_ENABLED") < runner.indexOf("await createConformanceWorkerExecutor"));
  assert.ok(runner.indexOf("await createConformanceWorkerExecutor") < runner.indexOf("await processConformanceJob"));
  const reserved = bootstrap.slice(bootstrap.indexOf('if (mode === "windows-reserved-v1")'), bootstrap.indexOf('if (mode !== "legacy"'));
  assert.doesNotMatch(reserved, /@remotion|import\(config|require\(config/);
  assert.match(reserved, /new CompositionControlledExecutionFenceStore/);
});
