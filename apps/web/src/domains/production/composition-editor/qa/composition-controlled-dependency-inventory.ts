import {createHash} from "node:crypto";
import {lstat, opendir} from "node:fs/promises";
import {isAbsolute, join, parse, resolve, sep} from "node:path";
import {z} from "zod";
import {controlledExecutionFilesSchema, controlledComparisonToolsSchema, CONTROLLED_COMPARISON_TOOLS_POLICY,
  controlledRenderExecutionContractSchema, type ControlledRenderExecutionContract} from "../composition-render-execution-contract";
import {assertConformanceFileUnchanged, pinConformanceFile, type ConformanceFilePin} from "./composition-conformance-file-integrity";

export const CONTROLLED_DEPENDENCY_INVENTORY_POLICY = {
  id: "EXACT_DECLARED_DEPENDENCY_TREES_V1",
  maximumRoots: 16, maximumFiles: 20_000, maximumDirectories: 20_000,
  maximumDepth: 32, maximumPathLength: 512, maximumManifestBytes: 4 * 1024 * 1024,
  maximumFileBytes: 1024 ** 3, maximumTotalBytes: 16 * 1024 ** 3,
} as const;
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const relativeFile = z.string().min(1).max(CONTROLLED_DEPENDENCY_INVENTORY_POLICY.maximumPathLength)
  .refine(value => value.split("/").every(part => /^[a-zA-Z0-9_.@+-]+$/.test(part) && part !== "." && part !== "..")
    && value.split("/").length <= CONTROLLED_DEPENDENCY_INVENTORY_POLICY.maximumDepth);
const location = z.object({rootId: identifier, path: relativeFile}).strict();
const identity = z.object({sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().nonnegative().max(CONTROLLED_DEPENDENCY_INVENTORY_POLICY.maximumFileBytes)}).strict();
const roleNames = Object.keys(controlledExecutionFilesSchema.shape) as Array<keyof ControlledRenderExecutionContract["files"]>;
const manifestSchema = z.object({policy: z.literal(CONTROLLED_DEPENDENCY_INVENTORY_POLICY.id),
  roots: z.array(identifier).min(1).max(CONTROLLED_DEPENDENCY_INVENTORY_POLICY.maximumRoots),
  files: z.array(location.extend(identity.shape)).min(1).max(CONTROLLED_DEPENDENCY_INVENTORY_POLICY.maximumFiles),
  roles: z.object({node: location, producer: location, engine: location, runtime: location,
    browser: location, encoder: location, decoder: location}).strict(),
  comparisonTools: z.object({pixelDecoder: location, probe: location}).strict().optional(),
}).strict();
export type ControlledDependencyManifest = z.infer<typeof manifestSchema>;
export const controlledDependencyManifestSchema = manifestSchema;
/** Host-owned configuration; never accept roots or manifests from a composition/upload/job payload. */
export type ControlledDependencyInventoryConfiguration = {
  manifest: ControlledDependencyManifest; expectedManifestSha256: string; roots: Record<string, string>;
};
const fileKey = (file: {rootId: string; path: string}) => `${file.rootId}/${file.path}`;

/** Stable encoding shared by the operator pin and admission; array order is not semantic. */
export function digestControlledDependencyManifest(raw: unknown) {
  const manifest = manifestSchema.parse(raw);
  const canonical = {...manifest, roots: [...manifest.roots].sort(),
    files: [...manifest.files].sort((left, right) => fileKey(left) < fileKey(right) ? -1 : fileKey(left) > fileKey(right) ? 1 : 0)};
  const encoded = JSON.stringify(canonical);
  if (Buffer.byteLength(encoded) > CONTROLLED_DEPENDENCY_INVENTORY_POLICY.maximumManifestBytes)
    throw new Error("CONTROLLED_RENDER_DEPENDENCY_MANIFEST_LIMIT");
  return createHash("sha256").update(`${CONTROLLED_DEPENDENCY_INVENTORY_POLICY.id}\n${encoded}`).digest("hex");
}

type DirectoryPin = {device: number; inode: number};
const directoryPin = (stat: Awaited<ReturnType<typeof lstat>>): DirectoryPin => ({device: Number(stat.dev), inode: Number(stat.ino)});

/** Exact declared trees only: does not prove OS immutability, dynamic loading closure, or isolation. */
export async function admitControlledDependencyInventory(configuration: ControlledDependencyInventoryConfiguration,
  execution: ControlledRenderExecutionContract, signal?: AbortSignal) {
  try {
    signal?.throwIfAborted();
    execution = controlledRenderExecutionContractSchema.parse(execution);
    const manifest = manifestSchema.parse(configuration.manifest);
    const digest = digestControlledDependencyManifest(manifest);
    if (configuration.expectedManifestSha256 !== digest) throw new Error("CONTROLLED_RENDER_DEPENDENCY_MANIFEST_MISMATCH");
    const roots = {...configuration.roots};
    if (new Set(manifest.roots).size !== manifest.roots.length
      || Object.keys(roots).sort().join("\n") !== [...manifest.roots].sort().join("\n"))
      throw new Error("CONTROLLED_RENDER_DEPENDENCY_ROOTS_INVALID");
    const declared = new Map(manifest.files.map(file => [fileKey(file), file]));
    if (declared.size !== manifest.files.length || manifest.files.some(file => !manifest.roots.includes(file.rootId))
      || manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0) > CONTROLLED_DEPENDENCY_INVENTORY_POLICY.maximumTotalBytes)
      throw new Error("CONTROLLED_RENDER_DEPENDENCY_MANIFEST_INVALID");
    for (const role of roleNames) assertRole(manifest.roles[role], execution.files[role]);
    if (Boolean(manifest.comparisonTools) !== Boolean(execution.comparisonTools))
      throw new Error("CONTROLLED_RENDER_DEPENDENCY_ROLE_MISMATCH");
    if (manifest.comparisonTools && execution.comparisonTools) {
      assertRole(manifest.comparisonTools.pixelDecoder, execution.comparisonTools.pixelDecoder);
      assertRole(manifest.comparisonTools.probe, execution.comparisonTools.probe);
    }
    function assertRole(reference: z.infer<typeof location>, expected: z.infer<typeof identity>) {
      const file = declared.get(fileKey(reference));
      if (!file || file.sha256 !== expected.sha256 || file.sizeBytes !== expected.sizeBytes)
        throw new Error("CONTROLLED_RENDER_DEPENDENCY_ROLE_MISMATCH");
    }
    const directories = new Map<string, DirectoryPin>();
    const pins = new Map<string, ConformanceFilePin>();
    const rememberDirectory = async (path: string, initial: boolean) => {
      signal?.throwIfAborted();
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("CONTROLLED_RENDER_DEPENDENCY_DIRECTORY_INVALID");
      const current = directoryPin(stat), previous = directories.get(path);
      if (!initial && (!previous || previous.device !== current.device || previous.inode !== current.inode))
        throw new Error("CONTROLLED_RENDER_DEPENDENCY_TREE_CHANGED");
      if (initial) directories.set(path, current);
    };
    const scan = async (initial: boolean) => {
      const observed = new Set<string>();
      let directoryCount = 0;
      for (const rootId of manifest.roots) {
        const root = roots[rootId];
        if (typeof root !== "string" || !isAbsolute(root) || root.includes("\0") || resolve(root) !== root)
          throw new Error("CONTROLLED_RENDER_DEPENDENCY_ROOTS_INVALID");
        // Reject links in ancestors as well as inside the declared tree.
        const volume = parse(root).root;
        let ancestor = volume;
        await rememberDirectory(ancestor, initial);
        for (const part of root.slice(volume.length).split(sep).filter(Boolean)) {
          ancestor = join(ancestor, part);
          await rememberDirectory(ancestor, initial);
        }
        const pending = [{path: root, relativePath: "", depth: 0}];
        while (pending.length) {
          const directory = pending.pop()!;
          if (++directoryCount > CONTROLLED_DEPENDENCY_INVENTORY_POLICY.maximumDirectories
            || directory.depth > CONTROLLED_DEPENDENCY_INVENTORY_POLICY.maximumDepth)
            throw new Error("CONTROLLED_RENDER_DEPENDENCY_TREE_LIMIT");
          await rememberDirectory(directory.path, initial);
          const handle = await opendir(directory.path);
          for await (const entry of handle) {
            signal?.throwIfAborted();
            const relativePath = directory.relativePath ? `${directory.relativePath}/${entry.name}` : entry.name;
            if (!relativeFile.safeParse(relativePath).success || entry.isSymbolicLink())
              throw new Error("CONTROLLED_RENDER_DEPENDENCY_ENTRY_INVALID");
            const absolutePath = join(directory.path, entry.name);
            if (entry.isDirectory()) {
              if (pending.length + directoryCount >= CONTROLLED_DEPENDENCY_INVENTORY_POLICY.maximumDirectories)
                throw new Error("CONTROLLED_RENDER_DEPENDENCY_TREE_LIMIT");
              pending.push({path: absolutePath, relativePath, depth: directory.depth + 1}); continue;
            }
            if (!entry.isFile()) throw new Error("CONTROLLED_RENDER_DEPENDENCY_ENTRY_INVALID");
            const stat = await lstat(absolutePath);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
              throw new Error("CONTROLLED_RENDER_DEPENDENCY_ENTRY_INVALID");
            const key = fileKey({rootId, path: relativePath}), expected = declared.get(key);
            if (!expected || observed.has(key)) throw new Error("CONTROLLED_RENDER_DEPENDENCY_FILE_SET_MISMATCH");
            observed.add(key);
            if (initial) {
              const pin = await pinConformanceFile(absolutePath, CONTROLLED_DEPENDENCY_INVENTORY_POLICY.maximumFileBytes, true, signal);
              if (pin.sha256 !== expected.sha256 || pin.sizeBytes !== expected.sizeBytes)
                throw new Error("CONTROLLED_RENDER_DEPENDENCY_FILE_MISMATCH");
              pins.set(key, pin);
            } else await assertConformanceFileUnchanged(absolutePath, pins.get(key)!, CONTROLLED_DEPENDENCY_INVENTORY_POLICY.maximumFileBytes, true, signal);
          }
          await rememberDirectory(directory.path, false);
        }
      }
      if (observed.size !== declared.size) throw new Error("CONTROLLED_RENDER_DEPENDENCY_FILE_SET_MISMATCH");
      for (const path of directories.keys()) await rememberDirectory(path, false);
      signal?.throwIfAborted();
    };
    await scan(true);
    const assertUnchanged = async () => {
      try {await scan(false);} catch (error) {throw safeFailure(error, signal);}
    };
    // Re-enumerate after acquisition: mutations during a scan must not become its baseline.
    await assertUnchanged();
    const readFileObservations = async () => {
      await assertUnchanged();
      const observed = (reference: z.infer<typeof location>) => {
        const pin = pins.get(fileKey(reference));
        if (!pin) throw new Error("CONTROLLED_RENDER_DEPENDENCY_ROLE_MISMATCH");
        return {sha256: pin.sha256, sizeBytes: pin.sizeBytes};
      };
      // Source values are measured pins, never the expected contract or manifest identities.
      const files = controlledExecutionFilesSchema.parse(Object.fromEntries(roleNames.map(role => [role, observed(manifest.roles[role])])));
      const comparisonTools = manifest.comparisonTools ? controlledComparisonToolsSchema.parse({
        policy: CONTROLLED_COMPARISON_TOOLS_POLICY, pixelDecoder: observed(manifest.comparisonTools.pixelDecoder),
        probe: observed(manifest.comparisonTools.probe),
      }) : undefined;
      return {scope: "DECLARED_TREES_NOT_OS_IMAGE_OR_DYNAMIC_DEPENDENCY_PROOF" as const,
        files, ...(comparisonTools ? {comparisonTools} : {})};
    };
    return {assertUnchanged, readFileObservations, receipt: {scope: "DECLARED_TREES_NOT_OS_IMAGE_OR_DYNAMIC_DEPENDENCY_PROOF" as const,
      policy: manifest.policy, manifestSha256: digest, fileCount: declared.size,
      totalBytes: manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0)}};
  } catch (error) {throw safeFailure(error, signal);}
}

function safeFailure(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return new Error("CONTROLLED_RENDER_DEPENDENCY_ABORTED");
  if (error instanceof Error && /^(CONTROLLED_RENDER_DEPENDENCY|CONFORMANCE_FILE)_[A-Z_]+$/.test(error.message)) return error;
  return new Error("CONTROLLED_RENDER_DEPENDENCY_ADMISSION_FAILED");
}
