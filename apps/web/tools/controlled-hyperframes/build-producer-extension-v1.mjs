import {mkdir, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {PRODUCER_EXTENSION_V1, transformProducerExtension} from "./producer-extension-v1.mjs";
import {assertPlainDirectory, fileRecord, hashBytes, readPinnedPackageFile,
  snapshotProducerPackage} from "./producer-extension-files.mjs";

export const PRODUCER_PACKAGE_POLICY = "COURSEFORGE_PRODUCER_EXTENSION_PACKAGE_V1";
export const PRODUCER_PACKAGE_MANIFEST = "courseforge-extension-manifest.json";
const runtimePath = "dist/courseforge-producer-observer-v1.mjs";
const fail = code => {throw new Error(`CONTROLLED_PRODUCER_PACKAGE_${code}`);};
const records = snapshot => snapshot.map(({path, sizeBytes, sha256}) => ({path, sizeBytes, sha256}));
const encoded = value => Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
const inside = (root, path) => {
  const suffix = relative(root, path);
  return !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`);
};

/** Operator build only. New exclusive destination; no import, activation, baseline admission or cleanup. */
export async function buildProducerExtensionPackage({sourceDirectory, outputDirectory, signal}) {
  if (!(signal instanceof AbortSignal)) fail("SIGNAL_REQUIRED");
  signal.throwIfAborted();
  await assertPlainDirectory(sourceDirectory);
  if (typeof outputDirectory !== "string" || !isAbsolute(outputDirectory) || resolve(outputDirectory) !== outputDirectory
    || outputDirectory.includes("\0") || outputDirectory.split(sep).some(part => part.toLowerCase() === "node_modules")
    || inside(sourceDirectory, outputDirectory) || inside(outputDirectory, sourceDirectory)) fail("DESTINATION_INVALID");
  await assertPlainDirectory(dirname(outputDirectory));
  const source = await snapshotProducerPackage(sourceDirectory, true);
  const find = path => source.find(file => file.path === path);
  if (find(runtimePath) || find(PRODUCER_PACKAGE_MANIFEST)) fail("RESERVED_FILE");
  const metadata = find("package.json"), entry = find("dist/index.js"), license = find("LICENSE");
  if (!metadata || !entry || !license || license.sizeBytes === 0) fail("SOURCE_INVALID");
  let packageInfo;
  try {packageInfo = JSON.parse(metadata.bytes.toString("utf8"));} catch {fail("SOURCE_INVALID");}
  if (packageInfo.name !== "@hyperframes/producer" || packageInfo.type !== "module") fail("SOURCE_INVALID");
  const extension = transformProducerExtension(entry.bytes, packageInfo.version);
  const runtime = await readPinnedPackageFile(new URL("./courseforge-producer-observer-v1.mjs", import.meta.url));
  const recipe = await readPinnedPackageFile(new URL("./producer-extension-v1.mjs", import.meta.url));
  const outputs = source.map(file => file.path === "dist/index.js" ? {...fileRecord(file.path, extension.output), bytes: extension.output} : file);
  outputs.push({...fileRecord(runtimePath, runtime), bytes: runtime});
  outputs.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const manifest = {policy: PRODUCER_PACKAGE_POLICY, scope: "BUILD_ARTIFACT_NOT_ADMITTED_OR_CONFORMANCE",
    extension: extension.manifest, recipeSha256: hashBytes(recipe), sourceFiles: records(source), outputFiles: records(outputs)};
  signal.throwIfAborted();
  // Existing destinations are deliberately never overwritten or deleted.
  await mkdir(outputDirectory);
  for (const file of outputs) {
    signal.throwIfAborted();
    const destination = join(outputDirectory, file.path);
    await mkdir(dirname(destination), {recursive: true});
    await writeFile(destination, file.bytes, {flag: "wx", mode: 0o600});
  }
  if (!encoded(records(source)).equals(encoded(await snapshotProducerPackage(sourceDirectory)))) fail("SOURCE_CHANGED");
  if (!encoded(records(outputs)).equals(encoded(await snapshotProducerPackage(outputDirectory)))) fail("OUTPUT_CHANGED");
  signal.throwIfAborted();
  const manifestBytes = encoded(manifest);
  // Completion marker last. Failure leaves a partial destination without this marker.
  await writeFile(join(outputDirectory, PRODUCER_PACKAGE_MANIFEST), manifestBytes, {flag: "wx", mode: 0o600});
  signal.throwIfAborted();
  return {directory: outputDirectory, entryPath: join(outputDirectory, "dist/index.js"),
    manifestSha256: hashBytes(manifestBytes), manifest};
}

/** Caller must supply a separately approved build digest; the artifact cannot approve itself. */
export async function verifyProducerExtensionPackage({directory, expectedManifestSha256, signal}) {
  if (!(signal instanceof AbortSignal) || !/^[a-f0-9]{64}$/.test(expectedManifestSha256 ?? "")) fail("ADMISSION_INPUT_INVALID");
  signal.throwIfAborted();
  await assertPlainDirectory(directory);
  const bytes = await readPinnedPackageFile(join(directory, PRODUCER_PACKAGE_MANIFEST), 1024 * 1024);
  if (hashBytes(bytes) !== expectedManifestSha256) fail("MANIFEST_MISMATCH");
  let manifest;
  try {manifest = JSON.parse(bytes.toString("utf8"));} catch {fail("MANIFEST_INVALID");}
  if (manifest.policy !== PRODUCER_PACKAGE_POLICY || manifest.extension?.id !== PRODUCER_EXTENSION_V1.id
    || manifest.extension?.sourceSha256 !== PRODUCER_EXTENSION_V1.sourceSha256
    || manifest.scope !== "BUILD_ARTIFACT_NOT_ADMITTED_OR_CONFORMANCE" || !Array.isArray(manifest.outputFiles)
    || manifest.extension.version !== PRODUCER_EXTENSION_V1.version
    || manifest.extension.bytes !== PRODUCER_EXTENSION_V1.bytes) fail("MANIFEST_INVALID");
  const entry = manifest.outputFiles.find(file => file.path === "dist/index.js");
  if (!entry || entry.sha256 !== manifest.extension.outputSha256 || entry.sizeBytes !== manifest.extension.outputBytes
    || !manifest.outputFiles.some(file => file.path === runtimePath)
    || !manifest.outputFiles.some(file => file.path === "LICENSE")) fail("MANIFEST_INVALID");
  const actual = await snapshotProducerPackage(directory);
  const declared = [...manifest.outputFiles, fileRecord(PRODUCER_PACKAGE_MANIFEST, bytes)]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (!encoded(actual).equals(encoded(declared))) fail("OUTPUT_CHANGED");
  signal.throwIfAborted();
  return {entryPath: join(directory, "dist/index.js"),
    scope: "PACKAGE_BYTES_VERIFIED_NOT_DEPENDENCY_CLOSURE_OR_SANDBOX", files: actual};
}

/** A fragment for the existing host inventory, never a new approved global baseline. */
export async function projectProducerExtensionInventory(input) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.rootId ?? "")) fail("ROOT_ID_INVALID");
  const verified = await verifyProducerExtensionPackage(input);
  return {scope: "INVENTORY_FRAGMENT_REQUIRES_HOST_ADMISSION", rootId: input.rootId,
    directory: input.directory, producer: {rootId: input.rootId, path: "dist/index.js"},
    files: verified.files.map(file => ({rootId: input.rootId, ...file}))};
}
