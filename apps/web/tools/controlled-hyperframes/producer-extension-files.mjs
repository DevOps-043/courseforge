import {lstat, open, readdir, realpath} from "node:fs/promises";
import {createHash} from "node:crypto";
import {isAbsolute, join, parse, resolve, sep} from "node:path";

export const EXTENSION_FILE_LIMITS = Object.freeze({files: 1024, directories: 1024,
  depth: 16, pathLength: 512, fileBytes: 64 * 1024 ** 2, totalBytes: 256 * 1024 ** 2});
export const hashBytes = bytes => createHash("sha256").update(bytes).digest("hex");
export const fileRecord = (path, bytes) => ({path, sizeBytes: bytes.length, sha256: hashBytes(bytes)});
const fail = code => {throw new Error(`CONTROLLED_PRODUCER_PACKAGE_${code}`);};

export async function assertPlainDirectory(path) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path || path.includes("\0")) fail("PATH_INVALID");
  let ancestor = parse(path).root;
  for (const part of ["", ...path.slice(ancestor.length).split(sep).filter(Boolean)]) {
    ancestor = join(ancestor, part);
    const stat = await lstat(ancestor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("DIRECTORY_INVALID");
  }
  const normalize = value => process.platform === "win32" ? value.toLowerCase() : value;
  if (normalize(await realpath(path)) !== normalize(path)) fail("DIRECTORY_ALIAS");
}

export async function readPinnedPackageFile(path, maximumBytes = EXTENSION_FILE_LIMITS.fileBytes) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximumBytes) fail("FILE_INVALID");
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) fail("FILE_CHANGED");
    const buffer = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const {bytesRead} = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat(), pathAfter = await lstat(path);
    for (const candidate of [after, pathAfter]) {
      if (!candidate.isFile() || candidate.isSymbolicLink() || candidate.nlink !== 1
        || candidate.dev !== before.dev || candidate.ino !== before.ino || candidate.size !== before.size
        || candidate.mtimeMs !== before.mtimeMs || candidate.ctimeMs !== before.ctimeMs) fail("FILE_CHANGED");
    }
    if (offset !== before.size) fail("FILE_CHANGED");
    return buffer.subarray(0, offset);
  } finally {await handle.close();}
}

/** Build-time bounded snapshot, not an OS immutability or dependency-closure proof. */
export async function snapshotProducerPackage(directory, includeBytes = false) {
  await assertPlainDirectory(directory);
  const files = [], pending = [{path: directory, suffix: "", depth: 0}];
  let directoryCount = 0, totalBytes = 0;
  const names = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (++directoryCount > EXTENSION_FILE_LIMITS.directories || current.depth > EXTENSION_FILE_LIMITS.depth) fail("TREE_LIMIT");
    const before = await lstat(current.path);
    if (!before.isDirectory() || before.isSymbolicLink()) fail("DIRECTORY_INVALID");
    for (const entry of await readdir(current.path, {withFileTypes: true})) {
      const suffix = current.suffix ? `${current.suffix}/${entry.name}` : entry.name;
      if (!/^[a-zA-Z0-9_.@+-]+$/.test(entry.name) || entry.name === "." || entry.name === ".."
        || entry.name.toLowerCase() === "node_modules" || suffix.length > EXTENSION_FILE_LIMITS.pathLength
        || entry.isSymbolicLink() || names.has(suffix.toLowerCase())) fail("ENTRY_INVALID");
      names.add(suffix.toLowerCase());
      const path = join(current.path, entry.name);
      if (entry.isDirectory()) {pending.push({path, suffix, depth: current.depth + 1}); continue;}
      if (!entry.isFile() || files.length >= EXTENSION_FILE_LIMITS.files) fail("ENTRY_INVALID");
      const bytes = await readPinnedPackageFile(path);
      totalBytes += bytes.length;
      if (totalBytes > EXTENSION_FILE_LIMITS.totalBytes) fail("TREE_LIMIT");
      files.push({...fileRecord(suffix, bytes), ...(includeBytes ? {bytes} : {})});
    }
    const after = await lstat(current.path);
    if (after.dev !== before.dev || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || after.isSymbolicLink()) fail("TREE_CHANGED");
  }
  return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
