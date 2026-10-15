import assert from "node:assert/strict";
import {mkdir, mkdtemp, readdir, rm, rmdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {assertMeasurementSpoolAvailable, MEASUREMENT_SPOOL_ADMISSION_POLICY} from "../qa/composition-owned-measurement-files";

test("spool admission permits only the current operation and preserves retained entries", async () => {
  const parent = await mkdtemp(join(tmpdir(), "measurement-spool-admission-"));
  const current = join(parent, "measurement-current"), retained = join(parent, "Measurement-retained");
  try {
    await assertMeasurementSpoolAvailable(parent);
    await mkdir(current);
    await assertMeasurementSpoolAvailable(parent, undefined, current);
    await assert.rejects(assertMeasurementSpoolAvailable(parent), /RECONCILIATION_REQUIRED/);
    // A file masquerading as a spool is also rejected; children are never traversed.
    await writeFile(retained, "preserve");
    await assert.rejects(assertMeasurementSpoolAvailable(parent, undefined, current), /RECONCILIATION_REQUIRED/);
    assert.deepEqual((await readdir(parent)).sort(), ["Measurement-retained", "measurement-current"]);
    await assert.rejects(assertMeasurementSpoolAvailable(parent, undefined, join(parent, "..", "measurement-foreign")), /SPOOL_INVALID/);
    const cancelled = new AbortController(); cancelled.abort(new Error("cancelled"));
    await assert.rejects(assertMeasurementSpoolAvailable(parent, cancelled.signal), /cancelled/);
  } finally {await rm(retained, {force: true}); await rmdir(current); await rmdir(parent);}
});

test("spool admission bounds even unrelated parent entries without deleting them", async () => {
  const parent = await mkdtemp(join(tmpdir(), "measurement-spool-limit-"));
  const paths: string[] = [];
  try {
    for (let index = 0; index <= MEASUREMENT_SPOOL_ADMISSION_POLICY.maximumParentEntries; index++) {
      const path = join(parent, `unrelated-${index}`); paths.push(path); await writeFile(path, "");
    }
    await assert.rejects(assertMeasurementSpoolAvailable(parent), /SPOOL_SCAN_LIMIT/);
    assert.equal((await readdir(parent)).length, paths.length);
  } finally {for (const path of paths) await rm(path, {force: true}); await rmdir(parent);}
});
