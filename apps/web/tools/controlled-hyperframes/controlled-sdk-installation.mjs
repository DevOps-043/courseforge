import {createHash} from "node:crypto";
import {lstat, open, opendir} from "node:fs/promises";
import {isAbsolute, join} from "node:path";

export const SDK_INSTALLATION_POLICY = Object.freeze({id: "LOCAL_SDK_INSTALLATION_TREE_V1",
  maximumEntries: 100_000, maximumDepth: 32, maximumFileBytes: 1024 ** 3, maximumTotalBytes: 4 * 1024 ** 3});
const fail = suffix => {throw new Error(`CONTROLLED_RENDER_INSTALLATION_${suffix}`);};
const identity = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs];
const sameIdentity = (left, right) => identity(left).every((value, index) => value === identity(right)[index]);
const safeName = name => name !== "." && name !== ".." && !/[\\/\x00-\x1f\x7f]/.test(name);

async function hashFile(path, before, checkActive) {
  const handle = await open(path, "r");
  try {
    if (!sameIdentity(before, await handle.stat())) fail("CHANGED");
    const digest = createHash("sha256"); let bytes = 0;
    for await (const chunk of handle.createReadStream({autoClose: false})) {
      checkActive(); bytes += chunk.length;
      if (bytes > before.size) fail("CHANGED");
      digest.update(chunk);
    }
    const after = await lstat(path);
    if (bytes !== before.size || !after.isFile() || after.isSymbolicLink()
      || !sameIdentity(before, after) || !sameIdentity(before, await handle.stat())) fail("CHANGED");
    return digest.digest("hex");
  } finally {await handle.close();}
}

/** Local tree inventory, not a complete module-resolution closure or an authenticated image identity. */
export async function pinControlledSdkInstallation(root, {checkActive = () => {}, limits = SDK_INSTALLATION_POLICY} = {}) {
  if (!isAbsolute(root) || typeof checkActive !== "function") fail("INVALID");
  for (const key of ["maximumEntries", "maximumDepth", "maximumFileBytes", "maximumTotalBytes"])
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > SDK_INSTALLATION_POLICY[key]) fail("LIMIT_INVALID");
  const entries = []; let sizeBytes = 0, fileCount = 0;
  const visit = async (path, relative, depth) => {
    checkActive();
    if (depth > limits.maximumDepth || entries.length >= limits.maximumEntries) fail("LIMIT_EXCEEDED");
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isDirectory() && !before.isFile()) fail("ENTRY_INVALID");
    if (before.isFile()) {
      if (before.nlink !== 1) fail("ENTRY_INVALID");
      if (before.size > limits.maximumFileBytes || sizeBytes + before.size > limits.maximumTotalBytes) fail("LIMIT_EXCEEDED");
      sizeBytes += before.size; fileCount++;
      entries.push({path: relative, kind: "FILE", sizeBytes: before.size,
        sha256: await hashFile(path, before, checkActive), identity: identity(before)});
    } else {
      entries.push({path: relative, kind: "DIRECTORY", identity: identity(before)});
      const names = [];
      const directory = await opendir(path);
      for await (const entry of directory) {
        checkActive();
        if (entries.length + names.length >= limits.maximumEntries) fail("LIMIT_EXCEEDED");
        names.push(entry.name);
      }
      names.sort();
      for (const name of names) {
        if (!safeName(name)) fail("ENTRY_INVALID");
        await visit(join(path, name), relative ? `${relative}/${name}` : name, depth + 1);
      }
      const after = await lstat(path);
      if (!after.isDirectory() || after.isSymbolicLink() || !sameIdentity(before, after)) fail("CHANGED");
    }
  };
  try {
    await visit(root, "", 0); checkActive();
    const digest = createHash("sha256");
    // Length-delimited records avoid ambiguity and preserve empty files/directories.
    for (const {identity: _localIdentity, ...entry} of entries) {
      const encoded = Buffer.from(JSON.stringify(entry));
      digest.update(`${encoded.length}:`); digest.update(encoded);
    }
    return Object.freeze({root, limits: Object.freeze({...limits}),
      entries: Object.freeze(entries.map(entry => Object.freeze({...entry, identity: Object.freeze(entry.identity)}))),
      summary: Object.freeze({policy: SDK_INSTALLATION_POLICY.id,
        scope: "LOCAL_SDK_TREE_NOT_FULL_DEPENDENCY_CLOSURE_OR_ATTESTATION",
        treeSha256: digest.digest("hex"), entryCount: entries.length, fileCount, sizeBytes})});
  } catch (error) {
    if (error instanceof Error && /^CONTROLLED_RENDER_[A-Z_]+$/.test(error.message)) throw error;
    fail("READ_FAILED");
  }
}

export async function assertControlledSdkInstallationUnchanged(pin, options = {}) {
  const after = await pinControlledSdkInstallation(pin.root, {...options, limits: pin.limits});
  if (after.summary.treeSha256 !== pin.summary.treeSha256 || JSON.stringify(after.entries) !== JSON.stringify(pin.entries))
    fail("CHANGED");
}
