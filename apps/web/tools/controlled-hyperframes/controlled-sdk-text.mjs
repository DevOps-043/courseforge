import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {dirname, resolve, join} from "node:path";
import {isDeepStrictEqual} from "node:util";

/** Called before SDK initializeSession; observe only after actual SDK captures, never by preview seek. */
export async function prepareControlledSdkText({client, document, contract, fonts, origin, verifyFiles, signal, api}) {
  const assertActive = () => {if (signal?.aborted) throw new Error("CONTROLLED_RENDER_TEXT_CANCELLED");};
  assertActive();
  const web = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const require = createRequire(join(web, "package.json"));
  const compiled = join(web, ".tmp/hyperframes-tests/domains/production/composition-editor/qa");
  const source = api ?? {
    ...require(join(compiled, "composition-controlled-font-capture.js")),
    ...require(join(compiled, "composition-text-checkpoint-capture.js")),
    ...require(join(compiled, "composition-text-parity-evidence.js")),
    ...require(join(compiled, "composition-font-loading-capture.js")),
  };
  const collector = await source.startControlledFontCapture({client, document, contract, fonts, origin, verifyFiles, signal});
  if (signal?.aborted) {collector.close(); assertActive();}
  const checkpoints = contract.checkpoints;
  const observations = [];
  let calls = 0, closed = false, loaded = false;
  const close = () => {if (!closed) {closed = true; collector.close();}};
  return {close, async loadDeclaredFonts() {
    assertActive();
    if (closed || loaded || calls !== 0) throw new Error("CONTROLLED_RENDER_TEXT_SEQUENCE_INVALID");
    try {await source.verifyConformanceFontLoading(client, fonts, true); assertActive(); loaded = true;}
    catch {close(); assertActive(); throw new Error("CONTROLLED_RENDER_TEXT_FONT_LOADING_FAILED");}
  }, async observeCapture(frameIndex, timeSeconds) {
    assertActive();
    if (closed || !loaded || calls >= checkpoints.length * 2) throw new Error("CONTROLLED_RENDER_TEXT_SEQUENCE_INVALID");
    const reverse = calls >= checkpoints.length;
    const expected = checkpoints[reverse ? checkpoints.length * 2 - calls - 1 : calls];
    if (frameIndex !== expected.frameIndex || timeSeconds !== expected.timeSeconds) {
      close(); throw new Error("CONTROLLED_RENDER_TEXT_SEQUENCE_INVALID");
    }
    try {
      const point = await source.captureTextParityCheckpoint(client, document, timeSeconds, contract.textParity.visibilityPolicy ?? false);
      assertActive();
      if (reverse) {
        const previous = observations.find(entry => entry.frameIndex === frameIndex);
        if (!isDeepStrictEqual(previous, point)) throw new Error("CONTROLLED_RENDER_TEXT_REVERSE_MISMATCH");
        await collector.verifyRepeat(point);
      } else {await collector.capture(point); observations.push(point);}
      calls++;
      assertActive();
    } catch {close(); assertActive(); throw new Error("CONTROLLED_RENDER_TEXT_CAPTURE_FAILED");}
  }, async finish() {
    assertActive();
    if (closed || calls !== checkpoints.length * 2) throw new Error("CONTROLLED_RENDER_TEXT_SEQUENCE_INCOMPLETE");
    try {
      const textEvidence = {schemaVersion: 1, policy: contract.textParity.policy,
        repeatability: source.TEXT_PARITY_REPEATABILITY, checkpoints: observations};
      const fontEvidence = await collector.finish(textEvidence);
      assertActive();
      return {scope: "SDK_SESSION_NATIVE_TEXT_AND_CUSTOM_GLYPHS_NOT_PREVIEW_PARITY", textEvidence, fontEvidence};
    } finally {close();}
  }};
}
