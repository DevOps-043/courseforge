import {createHash} from "node:crypto";
import {lstat, opendir} from "node:fs/promises";
import {createReadStream} from "node:fs";
import {join, resolve} from "node:path";
import sharp from "sharp";
import {pinConformanceFile, assertConformanceFileUnchanged, type ConformanceFilePin} from "./composition-conformance-file-integrity";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";

export const SDR_FRAME_SEQUENCE_LIMITS = Object.freeze({frames: 36000, pngBytes: 20 * 1024 ** 2,
  totalBytes: 4 * 1024 ** 3, dimension: 4096});
type FrameGeometry = {width: number; height: number; frameCount: number};
type SequenceSummary = Readonly<{policy: "EXACT_OPAQUE_PNG_SEQUENCE_PINS_V1";
  scope: "LOCAL_RECHECKS_NOT_IMMUTABLE_CAPTURE_OR_COLOR_ATTESTATION";
  sha256: string; frameCount: number; totalBytes: number; width: number; height: number}>;
type OwnedSequence = {root: string; geometry: FrameGeometry; identity: string; pins: ConformanceFilePin[]};
const sequences = new WeakMap<SequenceSummary, OwnedSequence>();
const frameName = (index: number) => `frame_${String(index).padStart(6, "0")}.png`;
const directoryIdentity = (directory: Awaited<ReturnType<typeof lstat>>) => `${directory.dev}:${directory.ino}:${directory.mtimeMs}:${directory.ctimeMs}`;

function assertGeometry(geometry: FrameGeometry) {
  if (![geometry.width, geometry.height, geometry.frameCount].every(Number.isSafeInteger)
    || geometry.width <= 0 || geometry.height <= 0 || geometry.width > SDR_FRAME_SEQUENCE_LIMITS.dimension
    || geometry.height > SDR_FRAME_SEQUENCE_LIMITS.dimension || geometry.frameCount <= 0
    || geometry.frameCount > SDR_FRAME_SEQUENCE_LIMITS.frames) throw new Error("SDR_FRAME_SEQUENCE_INPUT_INVALID");
}

async function assertExactDirectory(root: string, geometry: FrameGeometry, signal?: AbortSignal) {
  assertConformanceJobActive(signal);
  const before = await lstat(root);
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error("SDR_FRAME_SEQUENCE_DIRECTORY_INVALID");
  let count = 0;
  // Streaming enumeration rejects foreign content before constructing an unbounded listing.
  for await (const entry of await opendir(root)) {
    assertConformanceJobActive(signal);
    const match = /^frame_(\d{6})\.png$/.exec(entry.name);
    if (++count > geometry.frameCount || !entry.isFile() || entry.isSymbolicLink() || !match
      || Number(match[1]) >= geometry.frameCount) throw new Error("SDR_FRAME_SEQUENCE_COVERAGE_INVALID");
  }
  const after = await lstat(root);
  if (count !== geometry.frameCount || !after.isDirectory() || after.isSymbolicLink()
    || directoryIdentity(before) !== directoryIdentity(after)) throw new Error("SDR_FRAME_SEQUENCE_COVERAGE_INVALID");
  return directoryIdentity(after);
}

/** Sequential image validation with bounded PNG bytes/pixels. Unprofiled sRGB is a
 * caller precondition; dimensions/opacity are observed, not effective capture color. */
export async function pinSdrFrameSequence(input: FrameGeometry & {directory: string; signal?: AbortSignal}): Promise<SequenceSummary> {
  const geometry = {width: input.width, height: input.height, frameCount: input.frameCount};
  assertGeometry(geometry);
  const root = resolve(input.directory), identity = await assertExactDirectory(root, geometry, input.signal);
  const pins: ConformanceFilePin[] = []; let totalBytes = 0;
  const digest = createHash("sha256").update("exact-opaque-png-sequence-v1\n").update(JSON.stringify(geometry));
  for (let index = 0; index < geometry.frameCount; index++) {
    assertConformanceJobActive(input.signal);
    const path = join(root, frameName(index));
    const file = await lstat(path);
    if (file.nlink !== 1) throw new Error("SDR_FRAME_SEQUENCE_LINK_INVALID");
    const pin = await pinConformanceFile(path, SDR_FRAME_SEQUENCE_LIMITS.pngBytes, false, input.signal);
    totalBytes += pin.sizeBytes;
    if (totalBytes > SDR_FRAME_SEQUENCE_LIMITS.totalBytes) throw new Error("SDR_FRAME_SEQUENCE_BYTE_LIMIT");
    let readBytes = 0; const chunks: Buffer[] = [];
    for await (const chunk of createReadStream(path, {signal: input.signal})) {
      assertConformanceJobActive(input.signal);
      const bytes = chunk as Buffer; readBytes += bytes.length;
      if (readBytes > pin.sizeBytes) throw new Error("SDR_FRAME_SEQUENCE_CHANGED");
      chunks.push(bytes);
    }
    const png = Buffer.concat(chunks, readBytes);
    if (png.length !== pin.sizeBytes || createHash("sha256").update(png).digest("hex") !== pin.sha256)
      throw new Error("SDR_FRAME_SEQUENCE_CHANGED");
    const image = sharp(png, {limitInputPixels: geometry.width * geometry.height});
    const metadata = await image.metadata();
    if (metadata.format !== "png" || metadata.width !== geometry.width || metadata.height !== geometry.height
      || metadata.pages && metadata.pages !== 1 || metadata.icc || metadata.space !== "srgb"
      || metadata.depth !== "uchar" || metadata.orientation && metadata.orientation !== 1)
      throw new Error("SDR_FRAME_SEQUENCE_PROFILE_INVALID");
    if (metadata.hasAlpha && !(await image.stats()).isOpaque) throw new Error("SDR_FRAME_SEQUENCE_ALPHA_UNSUPPORTED");
    await assertConformanceFileUnchanged(path, pin, SDR_FRAME_SEQUENCE_LIMITS.pngBytes, false, input.signal);
    assertConformanceJobActive(input.signal);
    pins.push(Object.freeze(pin)); digest.update(JSON.stringify([index, pin.sha256, pin.sizeBytes]));
  }
  if (await assertExactDirectory(root, geometry, input.signal) !== identity) throw new Error("SDR_FRAME_SEQUENCE_CHANGED");
  const summary: SequenceSummary = Object.freeze({policy: "EXACT_OPAQUE_PNG_SEQUENCE_PINS_V1",
    scope: "LOCAL_RECHECKS_NOT_IMMUTABLE_CAPTURE_OR_COLOR_ATTESTATION", sha256: digest.digest("hex"), ...geometry, totalBytes});
  sequences.set(summary, {root, geometry, identity, pins});
  return summary;
}

/** Only summaries issued in this process retain private pins. JSON copies are not proof. */
export async function assertSdrFrameSequenceUnchanged(summary: SequenceSummary, signal?: AbortSignal) {
  const owned = sequences.get(summary);
  if (!owned) throw new Error("SDR_FRAME_SEQUENCE_PIN_INVALID");
  if (await assertExactDirectory(owned.root, owned.geometry, signal) !== owned.identity) throw new Error("SDR_FRAME_SEQUENCE_CHANGED");
  for (let index = 0; index < owned.pins.length; index++) {
    assertConformanceJobActive(signal);
    const path = join(owned.root, frameName(index));
    if ((await lstat(path)).nlink !== 1) throw new Error("SDR_FRAME_SEQUENCE_LINK_INVALID");
    await assertConformanceFileUnchanged(path, owned.pins[index]!, SDR_FRAME_SEQUENCE_LIMITS.pngBytes, false, signal);
  }
  if (await assertExactDirectory(owned.root, owned.geometry, signal) !== owned.identity) throw new Error("SDR_FRAME_SEQUENCE_CHANGED");
  assertConformanceJobActive(signal);
}
