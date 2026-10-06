import assert from "node:assert/strict";
import {mkdtemp, writeFile, rm, rmdir, link} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import sharp from "sharp";
import test from "node:test";
import {pinSdrFrameSequence, assertSdrFrameSequenceUnchanged} from "../qa/composition-sdr-frame-sequence";

const geometry = {width: 16, height: 16, frameCount: 2};
const image = (width = 16, alpha = 1) => sharp({create: {width, height: 16, channels: 4,
  background: {r: 20, g: 30, b: 40, alpha}}}).png().toBuffer();
async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "sdr-sequence-test-"));
  const png = await image();
  for (const name of ["frame_000000.png", "frame_000001.png"]) await writeFile(join(directory, name), png);
  try {await run(directory);}
  finally {
    for (const name of ["frame_000000.png", "frame_000001.png", "frame_000002.png", "foreign.txt", "alias.png"])
      await rm(join(directory, name), {force: true});
    await rmdir(directory);
  }
}
test("exact opaque RGBA sequence produces frozen path-free summary and same-process private recheck", async () => {
  await fixture(async directory => {
    const sequence = await pinSdrFrameSequence({...geometry, directory});
    assert.equal(sequence.frameCount, 2); assert.ok(sequence.totalBytes > 0);
    assert.match(sequence.sha256, /^[a-f0-9]{64}$/); assert.ok(Object.isFrozen(sequence));
    assert.ok(!JSON.stringify(sequence).includes(directory));
    await assertSdrFrameSequenceUnchanged(sequence);
    await assert.rejects(assertSdrFrameSequenceUnchanged({...sequence}), /PIN_INVALID/);
  });
});
test("missing frames, extra frames and foreign files reject exact coverage", async () => {
  await fixture(async directory => {
    await rm(join(directory, "frame_000001.png"));
    await assert.rejects(pinSdrFrameSequence({...geometry, directory}), /COVERAGE_INVALID/);
    await writeFile(join(directory, "frame_000001.png"), await image());
    for (const name of ["frame_000002.png", "foreign.txt"]) {
      await writeFile(join(directory, name), await image());
      await assert.rejects(pinSdrFrameSequence({...geometry, directory}), /COVERAGE_INVALID/);
      await rm(join(directory, name));
    }
  });
});
test("wrong dimensions, transparency and corrupt PNG cannot become a captured sRGB sequence", async () => {
  await fixture(async directory => {
    for (const png of [await image(18), await image(16, 0.5), Buffer.from("corrupt png")]) {
      await writeFile(join(directory, "frame_000000.png"), png);
      await assert.rejects(pinSdrFrameSequence({...geometry, directory}));
    }
  });
});
test("modification and additions after pin invalidate the whole sequence", async () => {
  await fixture(async directory => {
    const sequence = await pinSdrFrameSequence({...geometry, directory});
    await writeFile(join(directory, "frame_000002.png"), await image());
    await assert.rejects(assertSdrFrameSequenceUnchanged(sequence), /COVERAGE_INVALID|CHANGED/);
    await rm(join(directory, "frame_000002.png"));
    // Repin after directory change, then change only an existing member's content.
    const updated = await pinSdrFrameSequence({...geometry, directory});
    await writeFile(join(directory, "frame_000000.png"), await image(16, 0.5));
    await assert.rejects(assertSdrFrameSequenceUnchanged(updated), /INTEGRITY_MISMATCH|CHANGED/);
  });
});
test("pre-aborted sequence does not enumerate paths; invalid geometry is bounded", async () => {
  const abort = new AbortController(); abort.abort("private reason");
  await assert.rejects(pinSdrFrameSequence({...geometry, directory: "unused", signal: abort.signal}), /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
  for (const patch of [{width: 0}, {height: 4097}, {frameCount: 36001}, {frameCount: 1.5}])
    await assert.rejects(pinSdrFrameSequence({...geometry, ...patch, directory: "unused"}), /INPUT_INVALID/);
});
test("hardlinked frames are rejected before decoding their contents", async () => {
  await fixture(async directory => {
    await rm(join(directory, "frame_000001.png"));
    await link(join(directory, "frame_000000.png"), join(directory, "frame_000001.png"));
    await assert.rejects(pinSdrFrameSequence({...geometry, directory}), /LINK_INVALID/);
  });
});
