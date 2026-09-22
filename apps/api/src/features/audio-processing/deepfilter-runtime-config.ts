import { readFile } from "node:fs/promises";

interface DeepFilterManifest {
  artifacts?: {
    binary?: { path?: string; sha256?: string };
    model?: { path?: string; sha256?: string };
  };
}

interface VerifiedArtifact {
  path: string;
  sha256: string;
}

/**
 * Supplies immutable in-image DeepFilterNet locations and checksums. Runtime
 * values are rejected when they differ from the approved manifest so a deploy
 * cannot silently point the neural worker at a different model.
 */
export async function configureManagedDeepFilterRuntime(): Promise<void> {
  if (process.env.DEEPFILTERNET_ENABLED !== "true") return;

  const manifestPath = process.env.DEEPFILTER_MANIFEST_PATH?.trim();
  if (!manifestPath) throw new Error("DEEPFILTER_MANIFEST_PATH_MISSING");

  let manifest: DeepFilterManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as DeepFilterManifest;
  } catch {
    throw new Error("DEEPFILTER_MANIFEST_UNREADABLE");
  }

  const binary = requiredArtifact(manifest.artifacts?.binary, "BINARY", "deep-filter");
  const model = requiredArtifact(manifest.artifacts?.model, "MODEL", "DeepFilterNet3_onnx.tar.gz");
  applyImmutableEnvironment("DEEPFILTER_BINARY_PATH", `/opt/deepfilter/${binary.path}`);
  applyImmutableEnvironment("DEEPFILTER_BINARY_SHA256", binary.sha256);
  applyImmutableEnvironment("DEEPFILTER_MODEL_PATH", `/opt/deepfilter/${model.path}`);
  applyImmutableEnvironment("DEEPFILTER_MODEL_SHA256", model.sha256);
}

function requiredArtifact(
  artifact: { path?: string; sha256?: string } | undefined,
  name: string,
  expectedPath: string,
): VerifiedArtifact {
  const path = artifact?.path?.trim();
  const sha256 = artifact?.sha256?.trim().toLowerCase();
  if (path !== expectedPath || !sha256 || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`DEEPFILTER_MANIFEST_${name}_INVALID`);
  }
  return { path, sha256 };
}

function applyImmutableEnvironment(name: string, expectedValue: string) {
  const configuredValue = process.env[name]?.trim();
  if (configuredValue && configuredValue !== expectedValue) {
    throw new Error(`DEEPFILTER_RUNTIME_${name}_MISMATCH`);
  }
  process.env[name] = expectedValue;
}
