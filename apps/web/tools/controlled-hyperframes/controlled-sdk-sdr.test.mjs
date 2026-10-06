import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdtemp, writeFile, readFile, rm, rmdir} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {setTimeout as delay} from "node:timers/promises";
import {encodeControlledSdrCapture} from "./controlled-sdk-sdr.mjs";
import {runControlledSdkWorkflow} from "./controlled-sdk-lifecycle.mjs";

const digest = "c".repeat(64), file = {sha256: digest, sizeBytes: 10};
const browser = {protocolVersion: "1.3", product: "test", revision: "test", userAgent: "test", jsVersion: "test"};
const expectedExecution = {policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1", backend: "CONTROLLED", sdkVersion: "0.7.106",
  expectedBrowser: browser, files: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"].map(role => [role, file])),
  comparisonTools: {policy: "EXPLICIT_PIXEL_DECODER_AND_PROBE_V1", pixelDecoder: file, probe: file},
  sdrConversionPolicy: "DECLARED_SRGB_PNG_TO_REC709_LIMITED_V1"};

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "controlled-sdr-adapter-"));
  const stagedPath = join(directory, "staged.mp4"), outputPath = join(directory, "final.mp4");
  const bytes = "placeholder, not an MP4 and never executed";
  let closes = 0;
  const input = {expectedExecution, outputPath, outputParentDirectory: directory, framesDirectory: directory,
    ffmpegPath: join(directory, "never-executed-encoder"), ffprobePath: join(directory, "never-executed-probe"),
    profile: {captureProfile: "OPAQUE_SRGB_RGB_PNG", width: 16, height: 16, fps: 25, frameCount: 2},
    maximumEncodeMilliseconds: 1000};
  const encode = async options => {
    assert.equal(options.ffmpegSha256, digest); assert.equal(options.ffprobeSha256, digest);
    assert.ok(options.timeoutMilliseconds > 0 && options.timeoutMilliseconds <= 1000);
    await writeFile(stagedPath, bytes, {flag: "wx"});
    return {videoPath: stagedPath, output: {sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: Buffer.byteLength(bytes)},
      cleanup: async () => {closes++; await rm(stagedPath, {force: true});}};
  };
  try {await run({input, encode, stagedPath, bytes, closes: () => closes});}
  finally {
    await rm(stagedPath, {force: true}); await rm(outputPath, {force: true}); await rmdir(directory);
  }
}

test("SDK SDR adapter owns and closes its staged video before publishing the verified copy", async () => {
  await fixture(async ({input, encode, stagedPath, bytes, closes}) => {
    const result = await runControlledSdkWorkflow({work: controller => encodeControlledSdrCapture({...input, controller}, encode),
      publish: async (_value, cleanup) => {
        assert.equal(closes(), 1);
        assert.deepEqual(cleanup.resourceIds, ["sdrEncoder"]);
        await assert.rejects(readFile(stagedPath), {code: "ENOENT"});
        assert.equal(await readFile(input.outputPath, "utf8"), bytes);
        return "local copy, not conformance approval";
      }});
    assert.equal(result, "local copy, not conformance approval");
  });
});

test("SDR copy never overwrites an existing output and closes an unsuccessful factory", async () => {
  await fixture(async ({input, encode, closes}) => {
    await writeFile(input.outputPath, "existing output");
    await assert.rejects(runControlledSdkWorkflow({work: controller => encodeControlledSdrCapture({...input, controller}, encode),
      publish: async () => assert.fail("must not publish")}), /SDK_WORKFLOW_FAILED/);
    assert.equal(closes(), 1); assert.equal(await readFile(input.outputPath, "utf8"), "existing output");
  });
});

test("changed staged bytes fail the copy pin and never publish", async () => {
  await fixture(async ({input, encode, stagedPath, closes}) => {
    await assert.rejects(runControlledSdkWorkflow({work: controller => encodeControlledSdrCapture({...input, controller}, async options => {
      const value = await encode(options); await writeFile(stagedPath, "changed bytes"); return value;
    }), publish: async () => assert.fail("must not publish")}), /SDR_OUTPUT_COPY_MISMATCH/);
    assert.equal(closes(), 1);
  });
});

test("late encoder acquisition after abort is drained and closed without copying or publishing", async () => {
  await fixture(async ({input, encode, closes}) => {
    const abort = new AbortController();
    await assert.rejects(runControlledSdkWorkflow({signal: abort.signal,
      work: controller => encodeControlledSdrCapture({...input, controller}, async options => {
        const value = await encode(options); abort.abort("private reason"); await delay(10); return value;
      }), publish: async () => assert.fail("must not publish")}), /CONTROLLED_RENDER_ABORTED/);
    assert.equal(closes(), 1);
    await assert.rejects(readFile(input.outputPath), {code: "ENOENT"});
  });
});

test("omitted frozen policy or pre-abort cannot start an encoder", async () => {
  await fixture(async ({input}) => {
    let called = false;
    const encode = async () => {called = true; assert.fail("must not encode");};
    const legacy = {...expectedExecution}; delete legacy.sdrConversionPolicy;
    await assert.rejects(runControlledSdkWorkflow({work: controller => encodeControlledSdrCapture({...input, controller,
      expectedExecution: legacy}, encode), publish: async () => assert.fail("must not publish")}), /SDR_EXPECTATION_REQUIRED/);
    const abort = new AbortController(); abort.abort("private reason");
    await assert.rejects(runControlledSdkWorkflow({signal: abort.signal,
      work: controller => encodeControlledSdrCapture({...input, controller}, encode), publish: async () => assert.fail("must not publish")}), /CONTROLLED_RENDER_ABORTED/);
    assert.equal(called, false);
  });
});
