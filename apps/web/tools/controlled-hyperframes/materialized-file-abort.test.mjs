import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"));
const {pinConformanceFile, assertConformanceFileUnchanged} = require(
  "./dist/composition-worker/domains/production/composition-editor/qa/composition-conformance-file-integrity.js");

test("pre-abort rejects before opening even an absent file", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(pinConformanceFile(join(tmpdir(), "absent-aborted-file"), 1024, false, controller.signal), {name: "AbortError"});
});

test("abort at the stream checkpoint rejects hashing and recheck and releases its handle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cf-file-abort-"));
  const path = join(directory, "fixture.bin"), maximumBytes = 256 * 1024;
  try {
    await writeFile(path, Buffer.alloc(maximumBytes, 7));
    const pin = await pinConformanceFile(path, maximumBytes);
    for (const recheck of [false, true]) {
      const controller = new AbortController();
      const check = controller.signal.throwIfAborted.bind(controller.signal);
      let checkpoints = 0;
      // Deterministically cancel at the first streamed chunk, not on a timer.
      controller.signal.throwIfAborted = () => {if (++checkpoints === 3) controller.abort(); check();};
      await assert.rejects(recheck
        ? assertConformanceFileUnchanged(path, pin, maximumBytes, false, controller.signal)
        : pinConformanceFile(path, maximumBytes, false, controller.signal), {name: "AbortError"});
      assert.ok(checkpoints >= 3);
      await assertConformanceFileUnchanged(path, pin, maximumBytes);
    }
  } finally {await rm(directory, {recursive: true, force: true});}
});
