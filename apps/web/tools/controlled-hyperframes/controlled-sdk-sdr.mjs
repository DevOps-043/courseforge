import {createRequire} from "node:module";
import {copyFile} from "node:fs/promises";
import {constants as fsConstants} from "node:fs";
const appRequire = createRequire(new URL("../../package.json", import.meta.url));
const base = "./.tmp/hyperframes-tests/domains/production/composition-editor/";
const {encodeSdrCapturedFrames, SDR_FRAME_CONVERSION_POLICY} = appRequire(`${base}qa/composition-sdr-frame-encoder.js`);
const {pinConformanceFile} = appRequire(`${base}qa/composition-conformance-file-integrity.js`);
const {controlledRenderExecutionContractSchema} = appRequire(`${base}composition-render-execution-contract.js`);

/** Trusted local driver adapter. Copy is inside acquisition so cleanup drains a late write. */
export async function encodeControlledSdrCapture(input, encode = encodeSdrCapturedFrames) {
  const expected = controlledRenderExecutionContractSchema.parse(input.expectedExecution);
  if (expected.sdrConversionPolicy !== SDR_FRAME_CONVERSION_POLICY.id)
    throw new Error("CONTROLLED_RENDER_SDR_EXPECTATION_REQUIRED");
  const controller = input.controller;
  return controller.acquire("sdrEncoder", async () => {
    const encoded = await encode({profile: input.profile, framesDirectory: input.framesDirectory,
      outputParentDirectory: input.outputParentDirectory, ffmpegPath: input.ffmpegPath,
      ffmpegSha256: expected.files.encoder.sha256, ffprobePath: input.ffprobePath,
      ffprobeSha256: expected.comparisonTools.probe.sha256, signal: controller.signal,
      timeoutMilliseconds: Math.min(input.maximumEncodeMilliseconds, controller.remainingMilliseconds())});
    try {
      controller.remainingMilliseconds();
      await copyFile(encoded.videoPath, input.outputPath, fsConstants.COPYFILE_EXCL);
      const copy = await pinConformanceFile(input.outputPath, 1024 ** 3);
      if (copy.sha256 !== encoded.output.sha256 || copy.sizeBytes !== encoded.output.sizeBytes)
        throw new Error("CONTROLLED_RENDER_SDR_OUTPUT_COPY_MISMATCH");
      controller.remainingMilliseconds();
      return encoded;
    } catch (error) {
      // Failed factories do not yield an owned resource to the lifecycle; close it here.
      try {await encoded.cleanup();} catch {throw new Error("CONTROLLED_RENDER_SDR_COPY_CLEANUP_FAILED");}
      throw error;
    }
  }, encoded => encoded.cleanup());
}
