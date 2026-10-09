import {createHash} from "node:crypto";
import {lstat, open} from "node:fs/promises";
import {pinConformanceFile, assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";

/** Bounded bytes and a pin for exactly those bytes; a local file, not an authenticated observation. */
export async function readOwnedMeasurementFile(path: string, maximumBytes: number, signal?: AbortSignal,
  allowEmpty = false) {
  signal?.throwIfAborted();
  if ((await lstat(path)).nlink !== 1) throw new Error("CONTROLLED_RENDER_MEASUREMENT_FILE_INVALID");
  const pin = await pinConformanceFile(path, maximumBytes, allowEmpty, signal);
  const handle = await open(path, "r");
  const chunks: Buffer[] = []; let size = 0;
  try {
    for await (const chunk of handle.createReadStream({autoClose: false})) {
      signal?.throwIfAborted();
      size += (chunk as Buffer).length;
      if (size > maximumBytes || size > pin.sizeBytes) throw new Error("CONTROLLED_RENDER_MEASUREMENT_FILE_INVALID");
      chunks.push(chunk as Buffer);
    }
  } finally {await handle.close();}
  const bytes = Buffer.concat(chunks, size);
  if (size !== pin.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== pin.sha256)
    throw new Error("CONTROLLED_RENDER_MEASUREMENT_FILE_INVALID");
  await assertConformanceFileUnchanged(path, pin, maximumBytes, allowEmpty, signal);
  return {bytes, pin};
}
