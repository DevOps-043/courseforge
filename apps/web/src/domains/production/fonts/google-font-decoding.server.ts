import { Worker } from "node:worker_threads";
import { z } from "zod";
import { validateOrganizationFontBinary, type OrganizationFontExtension } from "./organization-font-upload-policy.service";
import { GOOGLE_FONT_DECODING_POLICY } from "./google-font-decoding-policy";
import { GOOGLE_FONT_DECODER_WORKER_SOURCE } from "./google-font-decoder.worker-source.server";
import type { GoogleFontBundleManifest } from "./google-font-bundle.contract";
import { googleFontUnicodeIntervals } from "./google-font-face-selectors";
export { googleFontUnicodeIntervals } from "./google-font-face-selectors";

const codePoint = z.number().int().min(0).max(0x10ffff);
export const decodedGoogleFontSchema = z.object({
  family: z.string().min(1).max(120), style: z.enum(["normal", "italic"]), weight: z.number().int().min(1).max(1000),
  axes: z.record(z.string().regex(/^[a-zA-Z0-9]{4}$/), z.object({ name: z.string().max(256),
    min: z.number().finite(), default: z.number().finite(), max: z.number().finite() }).strict()
    .refine(axis => axis.min <= axis.default && axis.default <= axis.max)),
  glyphCount: z.number().int().min(1).max(GOOGLE_FONT_DECODING_POLICY.maximumGlyphs),
  coverage: z.array(z.tuple([codePoint, codePoint])).min(1).max(GOOGLE_FONT_DECODING_POLICY.maximumCoverageRanges)
    .refine(ranges => ranges.every((range, index) => range[0] <= range[1]
      && (range[1] < 0xd800 || range[0] > 0xdfff) && (!index || ranges[index - 1][1] < range[0]))),
  decodedBytes: z.number().int().positive().max(GOOGLE_FONT_DECODING_POLICY.maximumDecodedBytes),
  embedding: z.literal("EDITABLE_TABLE_FLAGS"),
}).strict();
export type DecodedGoogleFont = z.infer<typeof decodedGoogleFontSchema>;

/** Bounded CPU/heap and termination. Decode failures never become PREPARED/READY
 * evidence and arbitrary worker errors never reach logs or the browser. */
export async function decodeGoogleFont(bytes: Uint8Array, mimeType: string, signal: AbortSignal): Promise<DecodedGoogleFont> {
  signal.throwIfAborted();
  validateOrganizationFontBinary(bytes, mimeType.slice(5) as OrganizationFontExtension);
  const copy = new Uint8Array(bytes);
  const worker = new Worker(GOOGLE_FONT_DECODER_WORKER_SOURCE, { eval: true,
    workerData: { modulePath: require.resolve("fontkit"), bytes: copy, policy: GOOGLE_FONT_DECODING_POLICY },
    transferList: [copy.buffer], resourceLimits: { maxOldGenerationSizeMb: GOOGLE_FONT_DECODING_POLICY.workerHeapMb, stackSizeMb: 4 },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<DecodedGoogleFont>((resolve, reject) => {
      const fail = () => reject(new Error("GOOGLE_FONT_DECODING_UNAVAILABLE"));
      abort = fail;
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(fail, GOOGLE_FONT_DECODING_POLICY.timeoutMs);
      worker.once("error", fail);
      worker.once("exit", fail);
      worker.once("message", (message: unknown) => {
        if (signal.aborted) { fail(); return; }
        const parsed = z.object({ ok: z.literal(true), metadata: decodedGoogleFontSchema }).strict().safeParse(message);
        if (parsed.success) resolve(parsed.data.metadata); else fail();
      });
      if (signal.aborted) fail();
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
    await worker.terminate();
  }
}

/** CSS descriptors are checked against decoded metadata, not merely repeated.
 * Coverage describes the file; actual text selection remains a separate gate. */
export function assertGoogleFontFaceMetadata(family: string, face: GoogleFontBundleManifest["faces"][number], rawMetadata: unknown) {
  const metadata = decodedGoogleFontSchema.parse(rawMetadata);
  if (metadata.family.normalize("NFC") !== family.normalize("NFC") || metadata.style !== face.style) throw new Error("GOOGLE_FONT_FACE_METADATA_MISMATCH");
  const axis = metadata.axes.wght;
  if (axis ? face.weight.minimum < axis.min || face.weight.maximum > axis.max
    : face.weight.minimum !== metadata.weight || face.weight.maximum !== metadata.weight) throw new Error("GOOGLE_FONT_FACE_METADATA_MISMATCH");
  const intervals = googleFontUnicodeIntervals(face.unicodeRange);
  if (!metadata.coverage.some(([first, last]) => intervals.some(range => first <= range[1] && last >= range[0]))) throw new Error("GOOGLE_FONT_FACE_COVERAGE_EMPTY");
  return metadata;
}
