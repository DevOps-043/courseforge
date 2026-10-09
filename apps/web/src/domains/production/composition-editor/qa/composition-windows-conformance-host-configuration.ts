import {isAbsolute, resolve} from "node:path";
import {lstat, realpath} from "node:fs/promises";
import {z} from "zod";
import {controlledDependencyManifestSchema, digestControlledDependencyManifest} from "./composition-controlled-dependency-inventory";
import {readOwnedMeasurementFile} from "./composition-owned-measurement-files";
import {windowsJobResourceLimitsSchema} from "./composition-windows-job-resource-policy";
import {windowsReducedTokenSchema} from "./composition-windows-reduced-token-policy";

export const WINDOWS_CONFORMANCE_HOST_CONFIGURATION_POLICY = Object.freeze({
  id: "WINDOWS_RESERVED_CONFORMANCE_HOST_V1", maximumBytes: 5 * 1024 ** 2,
});
const path = z.string().min(1).max(4096).refine(value => isAbsolute(value) && !value.includes("\0") && resolve(value) === value);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const configurationSchema = z.object({policy: z.literal(WINDOWS_CONFORMANCE_HOST_CONFIGURATION_POLICY.id),
  dependencyInventory: z.object({manifest: controlledDependencyManifestSchema,
    expectedManifestSha256: hash, roots: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), path)}).strict(),
  outputParentDirectory: path, powerShellPath: path, bridgeScriptPath: path,
  measurementFence: z.object({directory: path, hostId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)}).strict(),
  enableSilentDurableReports: z.boolean().default(false),
  resourceLimits: windowsJobResourceLimitsSchema.optional(),
  reducedToken: windowsReducedTokenSchema.optional(),
}).strict().refine(config => !config.reducedToken || Boolean(config.resourceLimits));

/** Operator file only. No activation, directory creation, dynamic module or process launch. */
export async function loadWindowsConformanceHostConfiguration(input: {path: string; sha256: string}, signal?: AbortSignal) {
  try {
    path.parse(input.path); hash.parse(input.sha256);
    const file = await readOwnedMeasurementFile(input.path, WINDOWS_CONFORMANCE_HOST_CONFIGURATION_POLICY.maximumBytes, signal);
    if (file.pin.sha256 !== input.sha256) throw new Error("CONFORMANCE_JOB_HOST_CONFIGURATION_PIN_MISMATCH");
    const configuration = configurationSchema.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(file.bytes)));
    const {manifest, roots, expectedManifestSha256} = configuration.dependencyInventory;
    if (digestControlledDependencyManifest(manifest) !== expectedManifestSha256
      || new Set(manifest.roots).size !== manifest.roots.length
      || Object.keys(roots).sort().join("\n") !== [...manifest.roots].sort().join("\n")
      || !manifest.comparisonTools)
      throw new Error("CONFORMANCE_JOB_HOST_CONFIGURATION_INVENTORY_INVALID");
    const declared = new Set(manifest.files.map(file => resolve(roots[file.rootId] ?? "", file.path)));
    const locate = (reference: {rootId: string; path: string}) => {
      if (!roots[reference.rootId]) throw new Error("CONFORMANCE_JOB_HOST_CONFIGURATION_INVENTORY_INVALID");
      const candidate = resolve(roots[reference.rootId], reference.path);
      if (!declared.has(candidate)) throw new Error("CONFORMANCE_JOB_HOST_CONFIGURATION_INVENTORY_INVALID");
      return candidate;
    };
    if (manifest.files.some(file => !roots[file.rootId]) || new Set(manifest.files.map(file => `${file.rootId}/${file.path}`)).size !== manifest.files.length
      || !declared.has(configuration.powerShellPath) || !declared.has(configuration.bridgeScriptPath))
      throw new Error("CONFORMANCE_JOB_HOST_CONFIGURATION_INVENTORY_INVALID");
    for (const directory of [configuration.outputParentDirectory, configuration.measurementFence.directory, ...Object.values(roots)]) {
      signal?.throwIfAborted();
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== directory)
        throw new Error("CONFORMANCE_JOB_HOST_CONFIGURATION_DIRECTORY_INVALID");
    }
    // Actual files/driver closure and contract-specific identities are admitted by the native ports.
    for (const reference of Object.values(manifest.roles)) locate(reference);
    locate(manifest.comparisonTools.probe);
    return {configuration, ffmpegPath: locate(manifest.comparisonTools.pixelDecoder)};
  } catch (error) {
    if (signal?.aborted) throw new Error("CONFORMANCE_JOB_EXECUTION_CANCELLED");
    throw error instanceof Error && /^CONFORMANCE_JOB_[A-Z_]+$/.test(error.message)
      ? error : new Error("CONFORMANCE_JOB_HOST_CONFIGURATION_INVALID");
  }
}
