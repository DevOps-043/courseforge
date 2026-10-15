import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import type { Stats } from "node:fs";

export type ConformanceFilePin = {
  sha256: string; sizeBytes: number; device: number; inode: number; modifiedAt: number; changedAt: number;
};

function identity(file: Stats) {
  return {sizeBytes: file.size, device: file.dev, inode: file.ino, modifiedAt: file.mtimeMs, changedAt: file.ctimeMs};
}

function sameIdentity(left: ReturnType<typeof identity>, right: ReturnType<typeof identity>) {
  return (["sizeBytes", "device", "inode", "modifiedAt", "changedAt"] as const).every((key) => left[key] === right[key]);
}

/** Hashes a bounded regular file through one handle and rejects replacement or mutation during reading. */
export async function pinConformanceFile(path: string, maximumBytes: number, allowEmpty = false, signal?: AbortSignal): Promise<ConformanceFilePin> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || typeof allowEmpty !== "boolean") throw new Error("CONFORMANCE_FILE_LIMIT_INVALID");
  signal?.throwIfAborted();
  try {return await readRegularFilePin(path, maximumBytes, allowEmpty, signal);}
  catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && /^CONFORMANCE_FILE_[A-Z_]+$/.test(error.message)) throw error;
    throw new Error("CONFORMANCE_FILE_READ_FAILED");
  }
}

async function readRegularFilePin(path: string, maximumBytes: number, allowEmpty: boolean, signal?: AbortSignal): Promise<ConformanceFilePin> {
  signal?.throwIfAborted();
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size < (allowEmpty ? 0 : 1) || before.size > maximumBytes)
    throw new Error("CONFORMANCE_FILE_INVALID");
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(identity(before), identity(opened))) throw new Error("CONFORMANCE_FILE_INTEGRITY_MISMATCH");
    let sizeBytes = 0; const digest = createHash("sha256");
    for await (const chunk of handle.createReadStream({autoClose: false})) {
      signal?.throwIfAborted();
      sizeBytes += (chunk as Buffer).length;
      if (sizeBytes > before.size || sizeBytes > maximumBytes) throw new Error("CONFORMANCE_FILE_INTEGRITY_MISMATCH");
      digest.update(chunk as Buffer);
    }
    const [handleAfter, pathAfter] = await Promise.all([handle.stat(), lstat(path)]);
    signal?.throwIfAborted();
    if (sizeBytes !== before.size || !pathAfter.isFile() || pathAfter.isSymbolicLink()
      || !sameIdentity(identity(before), identity(handleAfter)) || !sameIdentity(identity(before), identity(pathAfter)))
      throw new Error("CONFORMANCE_FILE_INTEGRITY_MISMATCH");
    return {sha256: digest.digest("hex"), ...identity(before)};
  } finally {await handle.close();}
}

/** Must be called after all measurements and before releasing a report bound to this file. */
export async function assertConformanceFileUnchanged(path: string, pin: ConformanceFilePin, maximumBytes: number, allowEmpty = false, signal?: AbortSignal) {
  const after = await pinConformanceFile(path, maximumBytes, allowEmpty, signal);
  if (after.sha256 !== pin.sha256 || !sameIdentity(pin, after)) throw new Error("CONFORMANCE_FILE_INTEGRITY_MISMATCH");
}
