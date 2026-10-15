import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertConformanceFileUnchanged, pinConformanceFile } from "../qa/composition-conformance-file-integrity";

test("file pin rejects same-size content changes and path replacement before report release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "conformance-file-pin-"));
  const path = join(directory, "video.mp4"), replacement = join(directory, "replacement.mp4");
  const bytes = Buffer.from("controlled file bytes; not codec evidence");
  try {
    await writeFile(path, bytes);
    const pin = await pinConformanceFile(path, bytes.length);
    assert.equal(pin.sha256, createHash("sha256").update(bytes).digest("hex"));
    await assertConformanceFileUnchanged(path, pin, bytes.length);
    await writeFile(path, Buffer.alloc(bytes.length));
    await assert.rejects(assertConformanceFileUnchanged(path, pin, bytes.length), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
    await writeFile(path, bytes);
    const restored = await pinConformanceFile(path, bytes.length);
    await writeFile(replacement, bytes);
    await rm(path); await rename(replacement, path);
    await assert.rejects(assertConformanceFileUnchanged(path, restored, bytes.length), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
    await assert.rejects(pinConformanceFile(path, bytes.length - 1), /CONFORMANCE_FILE_INVALID/);
    await assert.rejects(pinConformanceFile(directory, 1024), /CONFORMANCE_FILE_INVALID/);
  } finally {
    await rm(path, {force: true}); await rm(replacement, {force: true}); await rmdir(directory);
  }
});
