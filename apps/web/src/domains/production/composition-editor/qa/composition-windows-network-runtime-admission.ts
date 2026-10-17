import {createHash} from "node:crypto";
import {lstat, opendir, realpath} from "node:fs/promises";
import {dirname, isAbsolute, join, resolve} from "node:path";
import {z} from "zod";
import {pinConformanceFile, assertConformanceFileUnchanged, type ConformanceFilePin} from "./composition-conformance-file-integrity";

export const WINDOWS_NETWORK_RUNTIME_POLICY = Object.freeze({id: "WINDOWS_NETWORK_EXACT_RUNTIME_BUNDLE_V1",
  maximumFiles: 4096, maximumDirectories: 4096, maximumDepth: 24,
  maximumFileBytes: 256 * 1024 ** 2, maximumTotalBytes: 1024 ** 3, maximumManifestBytes: 1024 ** 2});
const relativePath = z.string().min(1).max(512).refine(value => value.split("/").length <= WINDOWS_NETWORK_RUNTIME_POLICY.maximumDepth
  && value.split("/").every(part => /^[a-zA-Z0-9_@.+-]+$/.test(part) && part !== "." && part !== ".."
    && !part.endsWith(".") && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)));
const manifestSchema = z.object({policy: z.literal(WINDOWS_NETWORK_RUNTIME_POLICY.id),
  scope: z.literal("DECLARED_RUNTIME_BUNDLE_NOT_OS_OR_DYNAMIC_LOADING_PROOF"),
  node: z.object({version: z.string().regex(/^v\d+\.\d+\.\d+$/), modules: z.string().regex(/^[1-9][0-9]*$/), arch: z.literal("x64")}).strict(),
  clr: z.literal("NET_FRAMEWORK_48"),
  roles: z.object({edgeEntry: relativePath, nativeAddon: relativePath, managedAssembly: relativePath}).strict(),
  files: z.array(z.object({path: relativePath, sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().min(0).max(WINDOWS_NETWORK_RUNTIME_POLICY.maximumFileBytes)}).strict())
    .min(3).max(WINDOWS_NETWORK_RUNTIME_POLICY.maximumFiles),
}).strict();
export type WindowsNetworkRuntimeManifest = z.infer<typeof manifestSchema>;
const failure = () => new Error("CONTROLLED_RENDER_NETWORK_RUNTIME_ADMISSION_FAILED");
export function digestWindowsNetworkRuntimeManifest(input: unknown) {
  const manifest = manifestSchema.parse(input);
  const encoded = JSON.stringify({...manifest, files: [...manifest.files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)});
  if (Buffer.byteLength(encoded) > WINDOWS_NETWORK_RUNTIME_POLICY.maximumManifestBytes) throw failure();
  return createHash("sha256").update(`${WINDOWS_NETWORK_RUNTIME_POLICY.id}\n${encoded}`).digest("hex");
}

/** Operator-approved, separate bundle, never node_modules in the application. Read-only:
 * exact file/tree/ABI admission is NOT DLL loading, immutable ACL or dynamic closure proof. */
export async function admitWindowsNetworkRuntime(input: {directory: string; manifest: unknown; expectedManifestSha256: string}, signal: AbortSignal) {
  try {
    signal.throwIfAborted();
    const directory = input.directory, manifest = manifestSchema.parse(input.manifest);
    const digest = digestWindowsNetworkRuntimeManifest(manifest);
    if (typeof directory !== "string" || directory.length > 4096 || !isAbsolute(directory) || resolve(directory) !== directory
      || directory.startsWith("\\\\") || directory.includes("\0") || !/^[a-f0-9]{64}$/.test(input.expectedManifestSha256)
      || digest !== input.expectedManifestSha256 || manifest.node.version !== process.version
      || manifest.node.modules !== process.versions.modules || manifest.node.arch !== process.arch) throw failure();
    const paths = new Map(manifest.files.map(file => [file.path.toLowerCase(), file]));
    if (paths.size !== manifest.files.length || manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0) > WINDOWS_NETWORK_RUNTIME_POLICY.maximumTotalBytes
      || new Set(Object.values(manifest.roles).map(path => path.toLowerCase())).size !== 3
      || !/\.(?:js|cjs)$/.test(manifest.roles.edgeEntry) || !manifest.roles.nativeAddon.endsWith(".node")
      || !manifest.roles.managedAssembly.endsWith(".dll")) throw failure();
    for (const path of Object.values(manifest.roles)) {
      const file = paths.get(path.toLowerCase());
      if (!file || file.path !== path || file.sizeBytes < 1) throw failure();
    }
    const directories = new Map<string, {device: number; inode: number}>();
    const files = new Map<string, ConformanceFilePin>();
    let failed = false;
    const checkDirectory = async (path: string, initial: boolean) => {
      signal.throwIfAborted(); const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw failure();
      const previous = directories.get(path);
      if (!initial && (!previous || previous.device !== stat.dev || previous.inode !== stat.ino)) throw failure();
      if (initial) directories.set(path, {device: stat.dev, inode: stat.ino});
    };
    const scan = async (initial: boolean, ownedSignal: AbortSignal) => {
      ownedSignal.throwIfAborted(); signal.throwIfAborted();
      let ancestorCount = 0;
      for (let ancestor = directory;;) {
        if (++ancestorCount > 64) throw failure();
        await checkDirectory(ancestor, initial); const parent = dirname(ancestor);
        if (parent === ancestor) break; ancestor = parent;
      }
      const pending = [{path: directory, prefix: "", depth: 0}], observed = new Set<string>();
      let directoryCount = 0;
      while (pending.length) {
        const current = pending.pop()!;
        if (++directoryCount > WINDOWS_NETWORK_RUNTIME_POLICY.maximumDirectories || current.depth > WINDOWS_NETWORK_RUNTIME_POLICY.maximumDepth) throw failure();
        await checkDirectory(current.path, initial);
        for await (const entry of await opendir(current.path)) {
          ownedSignal.throwIfAborted(); signal.throwIfAborted();
          const relative = current.prefix ? `${current.prefix}/${entry.name}` : entry.name;
          relativePath.parse(relative); const path = join(current.path, entry.name);
          if (entry.isSymbolicLink()) throw failure();
          if (entry.isDirectory()) {
            if (pending.length + directoryCount >= WINDOWS_NETWORK_RUNTIME_POLICY.maximumDirectories) throw failure();
            pending.push({path, prefix: relative, depth: current.depth + 1}); continue;
          }
          const expected = paths.get(relative.toLowerCase()), stat = await lstat(path);
          if (!entry.isFile() || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
            || !expected || expected.path !== relative || observed.has(relative)) throw failure();
          observed.add(relative);
          if (initial) {
            const pin = await pinConformanceFile(path, WINDOWS_NETWORK_RUNTIME_POLICY.maximumFileBytes, true, ownedSignal);
            if (pin.sha256 !== expected.sha256 || pin.sizeBytes !== expected.sizeBytes) throw failure();
            files.set(relative, pin);
          } else await assertConformanceFileUnchanged(path, files.get(relative)!, WINDOWS_NETWORK_RUNTIME_POLICY.maximumFileBytes, true, ownedSignal);
        }
        await checkDirectory(current.path, false);
      }
      if (observed.size !== paths.size) throw failure();
      for (const path of directories.keys()) await checkDirectory(path, false);
      ownedSignal.throwIfAborted(); signal.throwIfAborted();
    };
    await scan(true, signal);
    const assertUnchanged = async (ownedSignal: AbortSignal) => {
      try {if (failed) throw failure(); await scan(false, ownedSignal);}
      catch {failed = true; throw failure();}
    };
    await assertUnchanged(signal);
    return Object.freeze({assertUnchanged, paths: Object.freeze(Object.fromEntries(Object.entries(manifest.roles)
      .map(([role, path]) => [role, join(directory, path)])) as Record<keyof typeof manifest.roles, string>),
      receipt: Object.freeze({policy: manifest.policy, scope: manifest.scope, manifestSha256: digest, fileCount: files.size,
        totalBytes: manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0)})});
  } catch {throw failure();}
}
