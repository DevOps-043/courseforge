import {test} from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {executeClosedStageFile} from "./closed-stage-executor.mjs";

test("early execFile abort callback cannot settle until the direct child closes", async () => {
  const child = new EventEmitter(); child.pid = 123;
  let callback, settled = false;
  const pending = executeClosedStageFile("fixture", [], {}, (_binary, _args, _options, done) => {callback = done; return child;});
  const observed = pending.then(() => {settled = true;}, () => {settled = true;});
  callback(new Error("private abort diagnostics"), "", "");
  child.emit("error", new Error("abort"));
  await Promise.resolve(); assert.equal(settled, false);
  child.emit("close", null, "SIGTERM");
  await assert.rejects(pending, {message: "CONTROLLED_RENDER_STAGE_PROCESS_FAILED"}); await observed;
});

test("successful execution waits for close and returns only buffered output", async () => {
  const child = new EventEmitter(); child.pid = 123;
  let callback;
  const pending = executeClosedStageFile("fixture", [], {}, (_binary, _args, options, done) => {
    assert.equal(options.encoding, "utf8"); callback = done; return child;});
  callback(null, "stdout", "stderr"); child.emit("close", 0, null);
  assert.deepEqual(await pending, {stdout: "stdout", stderr: "stderr"});
});

test("spawn failure rejects sanitized without requiring a nonexistent live process", async () => {
  const child = new EventEmitter(); let callback;
  const pending = executeClosedStageFile("fixture", [], {}, (_binary, _args, _options, done) => {callback = done; return child;});
  callback(new Error("private path")); child.emit("error", new Error("ENOENT"));
  await assert.rejects(pending, {message: "CONTROLLED_RENDER_STAGE_PROCESS_FAILED"});
});
