import {createHash} from "node:crypto";
import {lstat, open, opendir} from "node:fs/promises";
import {basename, dirname, isAbsolute, resolve} from "node:path";
import {pinConformanceFile, assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";

export const MEASUREMENT_SPOOL_ADMISSION_POLICY = Object.freeze({directoryPrefix: "measurement-", maximumParentEntries: 4096});

/** Retained spool is an operator reconciliation gate, including after a worker restart.
 * Read-only, bounded enumeration: never follows children or deletes/reclaims an operation. */
export async function assertMeasurementSpoolAvailable(parent: string, signal?: AbortSignal, ownedDirectory?: string) {
  signal?.throwIfAborted();
  if (!isAbsolute(parent) || resolve(parent) !== parent
    || ownedDirectory !== undefined && (dirname(ownedDirectory) !== parent
      || !basename(ownedDirectory).startsWith(MEASUREMENT_SPOOL_ADMISSION_POLICY.directoryPrefix)))
    throw new Error("CONTROLLED_RENDER_MEASUREMENT_SPOOL_INVALID");
  try {
    let entries = 0;
    for await (const entry of await opendir(parent)) {
      signal?.throwIfAborted();
      if (++entries > MEASUREMENT_SPOOL_ADMISSION_POLICY.maximumParentEntries)
        throw new Error("CONTROLLED_RENDER_MEASUREMENT_SPOOL_SCAN_LIMIT");
      if (entry.name.toLowerCase().startsWith(MEASUREMENT_SPOOL_ADMISSION_POLICY.directoryPrefix)
        && entry.name !== (ownedDirectory === undefined ? undefined : basename(ownedDirectory)))
        throw new Error("CONTROLLED_RENDER_MEASUREMENT_SPOOL_RECONCILIATION_REQUIRED");
    }
    signal?.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    throw error instanceof Error && /^CONTROLLED_RENDER_MEASUREMENT_SPOOL_[A-Z_]+$/.test(error.message)
      ? error : new Error("CONTROLLED_RENDER_MEASUREMENT_SPOOL_SCAN_UNCONFIRMED");
  }
}

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
