import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES } from "../hyperframes/hyperframes.types";

const filenameSchema = z.enum(["candidate.zip", "artifact.json", "handoff.json", "operation.json", "creation-intent.json", "review-intent.json"]);
type Filename = z.infer<typeof filenameSchema>;

/** Shared filesystem mechanism only, no envelope/seal/approval semantics.
 * Pre-existing root must have exclusive OS access (restricted Windows ACL).
 * Privileged/same-user writers are outside this boundary. No arbitrary JSON
 * paths, overwrite, cleanup, adoption or resume of partial directories. */
export function createHtmlPrivateHandoffFiles(rootDirectory: string) {
  if (!isAbsolute(rootDirectory)) throw new Error("HTML_PRIVATE_HANDOFF_CONFIGURATION_INVALID");
  async function root() {
    const stat = await lstat(rootDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
    return realpath(rootDirectory);
  }
  async function directory(candidateId: string) {
    const base = await root(), path = join(base, z.string().uuid().parse(candidateId)), stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw new Error();
    return path;
  }
  return {
    async create(candidateId: string, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const path = join(await root(), z.string().uuid().parse(candidateId));
      signal?.throwIfAborted(); await mkdir(path, {mode: 0o700});
    },
    async write(candidateId: string, filename: Filename, bytes: Uint8Array, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const path = join(await directory(candidateId), filenameSchema.parse(filename));
      const file = await open(path, "wx", 0o600);
      try {await file.writeFile(bytes); await file.sync(); signal?.throwIfAborted();}
      finally {await file.close();}
    },
    async read(candidateId: string, filename: Filename, maximumBytes: number, signal?: AbortSignal) {
      signal?.throwIfAborted();
      if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || maximumBytes > HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES) throw new Error();
      const path = join(await directory(candidateId), filenameSchema.parse(filename));
      if ((await lstat(path)).isSymbolicLink()) throw new Error();
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size <= 0 || stat.size > maximumBytes) throw new Error();
        const bytes = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
          signal?.throwIfAborted();
          const chunk = await file.read(bytes, offset, bytes.length - offset, offset);
          if (!chunk.bytesRead) throw new Error(); offset += chunk.bytesRead;
        }
        const after = await file.stat();
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error();
        signal?.throwIfAborted(); return bytes;
      } finally {await file.close();}
    },
  };
}
