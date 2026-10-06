import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, writeFile, rm, rmdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pinComparisonTools} from "../qa/composition-comparison-tool-integrity";

async function withTools(run: (input: {pixelDecoderPath: string; probePath: string}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "courseforge-tool-pins-"));
  const input = {pixelDecoderPath: join(directory, "pixel-decoder.fixture"), probePath: join(directory, "probe.fixture")};
  try {
    await writeFile(input.pixelDecoderPath, "pixel decoding bytes");
    await writeFile(input.probePath, "probe bytes");
    await run(input);
  } finally {
    // Remove only the two owned fixtures, never recursively delete unknown contents.
    await rm(input.pixelDecoderPath, {force: true});
    await rm(input.probePath, {force: true});
    await rmdir(directory);
  }
}

test("locally pinned comparator tools bind SHA and size; no paths leak into observations", async () => {
  await withTools(async input => {
    const baseline = await pinComparisonTools(input);
    const pinned = await pinComparisonTools({...input, expected: baseline.observed});
    assert.deepEqual(pinned.observed, baseline.observed);
    assert.equal(pinned.observed.policy, "EXPLICIT_PIXEL_DECODER_AND_PROBE_V1");
    assert.notEqual(pinned.observed.pixelDecoder.sha256, pinned.observed.probe.sha256);
    assert.equal(JSON.stringify(pinned.observed).includes(input.pixelDecoderPath), false);
    await pinned.assertUnchanged();
    pinned.observed.pixelDecoder.sha256 = "a".repeat(64);
    await pinned.assertUnchanged(); // Public summary cannot change the private filesystem pins.
  });
});

test("frozen mismatch rejects either role and either identity field before measurement", async () => {
  await withTools(async input => {
    const baseline = await pinComparisonTools(input);
    for (const [role, code] of [["pixelDecoder", /PIXEL_DECODER_IDENTITY_MISMATCH/], ["probe", /PROBE_IDENTITY_MISMATCH/]] as const) {
      for (const field of ["sha256", "sizeBytes"] as const) {
        const expected = structuredClone(baseline.observed);
        if (field === "sha256") expected[role].sha256 = "a".repeat(64);
        else expected[role].sizeBytes++;
        await assert.rejects(pinComparisonTools({...input, expected}), code);
      }
    }
  });
});

test("replacement of either measurement tool prevents releasing a report", async () => {
  for (const role of ["pixelDecoderPath", "probePath"] as const) {
    await withTools(async input => {
      const pinned = await pinComparisonTools(input);
      await writeFile(input[role], "changed executable bytes");
      await assert.rejects(pinned.assertUnchanged(), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
    });
  }
});

test("legacy contract still gets local tool rechecks without claiming a frozen binding", async () => {
  await withTools(async input => {
    const pinned = await pinComparisonTools(input);
    await writeFile(input.probePath, "changed probe bytes");
    await assert.rejects(pinned.assertUnchanged(), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
  });
});

test("abort before pinning or after measurement uses canonical cancellation", async () => {
  await withTools(async input => {
    const controller = new AbortController();
    const pinned = await pinComparisonTools({...input, signal: controller.signal});
    controller.abort(new Error("private cancellation context"));
    await assert.rejects(pinned.assertUnchanged(), /^Error: CONFORMANCE_JOB_EXECUTION_CANCELLED$/);
    await assert.rejects(pinComparisonTools({...input, signal: controller.signal}), /^Error: CONFORMANCE_JOB_EXECUTION_CANCELLED$/);
  });
});

test("invalid policy and relative executable paths are rejected", async () => {
  await withTools(async input => {
    await assert.rejects(pinComparisonTools({...input, pixelDecoderPath: "relative.fixture"}), /TOOL_PATH_INVALID/);
    const pinned = await pinComparisonTools(input);
    await assert.rejects(pinComparisonTools({...input, expected: {...pinned.observed, policy: "AUTODETECT"} as never}));
  });
});
