import {createHash} from "node:crypto";
import {mkdir, writeFile, lstat} from "node:fs/promises";
import {isAbsolute, join} from "node:path";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {SDR_FRAME_CONVERSION_POLICY} from "../composition-sdr-conversion-policy";
import {SDR_FRAME_SEQUENCE_LIMITS, pinSdrFrameSequence, assertSdrFrameSequenceUnchanged} from "./composition-sdr-frame-sequence";
import {pinConformanceFile, assertConformanceFileUnchanged, type ConformanceFilePin} from "./composition-conformance-file-integrity";

export const ORIGINAL_FRAME_ARCHIVE_DIRECTORY = "original-forward-frames";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Backpressured original forward frames only. Private work files, not capture-color attestation. */
export function createOriginalSessionFrameArchive(input: {outputDirectory: string; contract: unknown; signal: AbortSignal;
  verifyFiles: () => Promise<void>}) {
  const contract = compositionConformanceContractSchema.parse(input.contract);
  if (contract.schemaVersion !== 4 || contract.renderExecution?.sdrConversionPolicy !== SDR_FRAME_CONVERSION_POLICY.id
    || !isAbsolute(input.outputDirectory) || input.outputDirectory.includes("\0"))
    throw new Error("CONTROLLED_RENDER_FRAME_ARCHIVE_INPUT_INVALID");
  const directory = join(input.outputDirectory, ORIGINAL_FRAME_ARCHIVE_DIRECTORY);
  const frameCount = Math.ceil(contract.canvas.durationSeconds * contract.canvas.fps);
  if (frameCount < 1 || frameCount > SDR_FRAME_SEQUENCE_LIMITS.frames)
    throw new Error("CONTROLLED_RENDER_FRAME_ARCHIVE_INPUT_INVALID");
  const pins: ConformanceFilePin[] = [];
  let totalBytes = 0, started = false, busy = false, failure: Error | undefined;
  let sequence: Awaited<ReturnType<typeof pinSdrFrameSequence>> | undefined;
  const active = () => {input.signal.throwIfAborted(); if (failure) throw failure;};
  const framePath = (index: number) => join(directory, `frame_${String(index).padStart(6, "0")}.png`);
  const recheck = async () => {
    active(); await input.verifyFiles(); active();
    for (let index = 0; index < pins.length; index++)
      await assertConformanceFileUnchanged(framePath(index), pins[index], SDR_FRAME_SEQUENCE_LIMITS.pngBytes, false, input.signal);
    if (sequence) await assertSdrFrameSequenceUnchanged(sequence, input.signal);
    active();
  };
  return {
    async captureFrame(frameIndex: number, quantizedTime: number, buffer: Buffer) {
      let ownsOperation = false;
      try {
        active();
        if (busy || sequence || frameIndex !== pins.length || frameIndex >= frameCount
          || quantizedTime !== frameIndex / contract.canvas.fps || !Buffer.isBuffer(buffer) || !buffer.length
          || buffer.length > SDR_FRAME_SEQUENCE_LIMITS.pngBytes
          || totalBytes + buffer.length > SDR_FRAME_SEQUENCE_LIMITS.totalBytes) throw new Error();
        busy = true;
        ownsOperation = true;
        const owned = Buffer.from(buffer);
        const expectedHash = digest(owned);
        if (!started) {
          const root = await lstat(input.outputDirectory);
          if (!root.isDirectory() || root.isSymbolicLink()) throw new Error();
          await mkdir(directory, {recursive: false, mode: 0o700}); started = true;
        }
        active();
        await writeFile(framePath(frameIndex), owned, {flag: "wx", mode: 0o600, signal: input.signal});
        const pin = await pinConformanceFile(framePath(frameIndex), SDR_FRAME_SEQUENCE_LIMITS.pngBytes, false, input.signal);
        if (pin.sha256 !== expectedHash || pin.sizeBytes !== owned.length) throw new Error();
        pins.push(pin); totalBytes += owned.length;
        active();
      } catch {failure ??= new Error("CONTROLLED_RENDER_FRAME_ARCHIVE_CAPTURE_FAILED"); throw failure;}
      finally {if (ownsOperation) busy = false;}
    },
    async finalize() {
      let ownsOperation = false;
      try {
        active(); if (busy || pins.length !== frameCount) throw new Error();
        busy = true;
        ownsOperation = true;
        await recheck();
        sequence ??= await pinSdrFrameSequence({directory, width: contract.canvas.width, height: contract.canvas.height,
          frameCount, signal: input.signal});
        await recheck();
        return {directory, sequence, assertUnchanged: recheck};
      } catch {failure ??= new Error("CONTROLLED_RENDER_FRAME_ARCHIVE_FINALIZATION_FAILED"); throw failure;}
      finally {if (ownsOperation) busy = false;}
    },
  };
}
