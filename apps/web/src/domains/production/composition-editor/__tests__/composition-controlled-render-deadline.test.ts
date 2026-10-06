import assert from "node:assert/strict";
import test from "node:test";
import {setTimeout as delay} from "node:timers/promises";
import {createControlledRenderDeadline} from "../qa/composition-controlled-render-deadline";
import {createControlledProcessEnvironment} from "../qa/composition-controlled-process-environment";

test("all stages consume one monotonic budget; returning at the deadline cannot pass", async () => {
  let milliseconds = 100;
  const deadline = createControlledRenderDeadline(1_000, undefined, () => milliseconds);
  try {
    await deadline.run(async (signal, remaining) => {assert.equal(remaining, 1_000); assert.equal(signal.aborted, false); milliseconds += 750;});
    assert.equal(deadline.remainingMilliseconds(), 250);
    await assert.rejects(deadline.run(async (_signal, remaining) => {assert.equal(remaining, 250); milliseconds += 250;}), /DEADLINE_EXCEEDED/);
    assert.equal(deadline.signal.aborted, true);
  } finally {deadline.dispose();}
});
test("caller abort reasons are sanitized and cancellation reaches active adapters", async () => {
  const external = new AbortController(); const deadline = createControlledRenderDeadline(1_000, external.signal);
  try {
    await assert.rejects(deadline.run(async signal => {
      const cancelled = new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), {once: true}));
      external.abort(new Error("private URL and credential")); await cancelled;
    }), error => error instanceof Error && error.message === "CONTROLLED_RENDER_ABORTED");
  } finally {deadline.dispose();}
});
test("late success from a non-cooperative adapter cannot emit a successful result", async () => {
  const external = new AbortController(); const deadline = createControlledRenderDeadline(1_000, external.signal);
  let finish!: (value: string) => void;
  try {
    const running = deadline.run(() => new Promise<string>(resolve => {finish = resolve;}));
    external.abort(); await assert.rejects(running, /ABORTED/);
    finish("late success"); await delay(0);
  } finally {deadline.dispose();}
});
test("invalid clocks, unsupported limits and closed deadlines fail explicitly", () => {
  for (const timeout of [0, 999, 600_001, NaN, Infinity, 1_000.5])
    assert.throws(() => createControlledRenderDeadline(timeout), /DEADLINE_INVALID/);
  assert.throws(() => createControlledRenderDeadline(1_000, undefined, () => NaN), /CLOCK_INVALID/);
  let current = 10; const deadline = createControlledRenderDeadline(1_000, undefined, () => current);
  current = 9; assert.throws(() => deadline.remainingMilliseconds(), /CLOCK_INVALID/);
  deadline.dispose(); assert.throws(() => deadline.remainingMilliseconds(), /CLOSED/);
});
test("an already aborted caller cannot start a stage", async () => {
  const external = new AbortController(); external.abort("sensitive");
  const deadline = createControlledRenderDeadline(1_000, external.signal); let called = false;
  try {await assert.rejects(deadline.run(async () => {called = true;}), /ABORTED/); assert.equal(called, false);}
  finally {deadline.dispose();}
});
test("controlled child environment excludes credentials and caller producer/Node overrides", () => {
  const source = {PATH: "os-path", TEMP: "os-temp", SUPABASE_SERVICE_ROLE_KEY: "synthetic", NODE_OPTIONS: "synthetic",
    HYPERFRAMES_FFMPEG_PATH: "untrusted-override", PRODUCER_HEADLESS_SHELL_PATH: "untrusted-override",
    HYPERFRAMES_NO_TELEMETRY: "0", NODE_ENV: "development"};
  const original = {...source};
  assert.deepEqual(createControlledProcessEnvironment(source), {NODE_ENV: "production", HYPERFRAMES_NO_TELEMETRY: "1",
    PATH: "os-path", TEMP: "os-temp"});
  assert.deepEqual(source, original);
});
