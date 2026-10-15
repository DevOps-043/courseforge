import {prepareControlledSdkText} from "./controlled-sdk-text.mjs";

/** Own all pre-initialization collectors; no batch is silently omitted after a failed acquisition. */
export async function prepareControlledSdkTextBatches(input, prepare = prepareControlledSdkText) {
  const collectors = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    let failed = false;
    for (const collector of [...collectors].reverse()) try {collector.close();} catch {failed = true;}
    if (failed) throw new Error("CONTROLLED_RENDER_TEXT_BATCH_CLEANUP_FAILED");
  };
  if (!Array.isArray(input.contracts) || !input.contracts.length) throw new Error("CONTROLLED_RENDER_TEXT_BATCH_INVALID");
  try {
    for (const contract of input.contracts) collectors.push(await prepare({...input, contract}));
    return {close,
      async loadDeclaredFonts() {
        if (closed) throw new Error("CONTROLLED_RENDER_TEXT_BATCH_CLOSED");
        try {for (const collector of collectors) await collector.loadDeclaredFonts();} catch (error) {close(); throw error;}
      },
      async observeCapture(batchIndex, frameIndex, timeSeconds) {
        if (closed || !Number.isSafeInteger(batchIndex) || !collectors[batchIndex]) throw new Error("CONTROLLED_RENDER_TEXT_BATCH_INVALID");
        await collectors[batchIndex].observeCapture(frameIndex, timeSeconds);
      },
      async finish() {
        if (closed) throw new Error("CONTROLLED_RENDER_TEXT_BATCH_CLOSED");
        try {const evidence = []; for (const collector of collectors) evidence.push(await collector.finish()); return evidence;}
        finally {close();}
      }};
  } catch (error) {close(); throw error;}
}
