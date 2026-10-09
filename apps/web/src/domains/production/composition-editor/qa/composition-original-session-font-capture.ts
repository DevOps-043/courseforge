import {borrowProducerCdpChannel, type ProducerCdpChannel} from "./composition-borrowed-producer-cdp";
import {startControlledFontCapture} from "./composition-controlled-font-capture";
import {textCheckpointEvidenceSchema} from "./composition-text-parity-evidence";

/** Hook integration for an admitted original SDK session, called before navigation.
 * It reuses real font/text validators; does not invent repeatability or close SDK channels. */
export async function startOriginalSessionFontCapture(input: {
  cdp: ProducerCdpChannel; serverUrl: string; document: unknown; contract: unknown;
  fonts: unknown; verifyFiles: () => Promise<void>; signal: AbortSignal;
}) {
  let origin: string;
  try {
    const url = new URL(input.serverUrl);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    origin = url.origin;
  } catch {throw new Error("CONTROLLED_RENDER_ORIGINAL_FONT_ORIGIN_INVALID");}
  if (typeof input.verifyFiles !== "function") throw new Error("CONTROLLED_RENDER_ORIGINAL_FONT_FILE_VERIFIER_REQUIRED");
  const client = borrowProducerCdpChannel(input.cdp, input.signal);
  try {
    const capture = await startControlledFontCapture({...input, origin, client});
    const capturedFrames: number[] = [];
    let repeatedFrames = 0;
    const close = () => {try {capture.close();} finally {client.close();}};
    const observe = async (method: "capture" | "verifyRepeat", point: unknown) => {
      try {
        const frameIndex = textCheckpointEvidenceSchema.parse(point).frameIndex;
        if (method === "capture" && repeatedFrames !== 0
          || method === "verifyRepeat" && frameIndex !== capturedFrames[capturedFrames.length - 1 - repeatedFrames])
          throw new Error("CONTROLLED_RENDER_ORIGINAL_FONT_REPEAT_ORDER_INVALID");
        await capture[method](point);
        if (method === "capture") capturedFrames.push(frameIndex);
        else repeatedFrames++;
      }
      catch (error) {close(); throw error;}
    };
    return {capture: (point: unknown) => observe("capture", point),
      verifyRepeat: (point: unknown) => observe("verifyRepeat", point), close,
      async finish(textEvidence: unknown) {
        try {
          if (!capturedFrames.length || repeatedFrames !== capturedFrames.length)
            throw new Error("CONTROLLED_RENDER_ORIGINAL_FONT_REPEAT_COVERAGE_INCOMPLETE");
          return await capture.finish(textEvidence);
        } finally {close();}
      }};
  } catch (error) {
    client.close();
    throw error;
  }
}
