import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configureManagedDeepFilterRuntime } from "../deepfilter-runtime-config";

const binaryHash = "a".repeat(64);
const modelHash = "b".repeat(64);
const managedEnvironmentNames = [
  "DEEPFILTERNET_ENABLED",
  "DEEPFILTER_MANIFEST_PATH",
  "DEEPFILTER_BINARY_PATH",
  "DEEPFILTER_BINARY_SHA256",
  "DEEPFILTER_MODEL_PATH",
  "DEEPFILTER_MODEL_SHA256",
] as const;

test("does nothing when neural enhancement is disabled", async () => {
  await withCleanManagedEnvironment(async () => {
    await configureManagedDeepFilterRuntime();
    assert.equal(process.env.DEEPFILTER_BINARY_PATH, undefined);
  });
});

test("derives immutable runtime values from the approved manifest", async () => {
  await withCleanManagedEnvironment(async () => {
    await withManifest({}, async (manifestPath) => {
      process.env.DEEPFILTERNET_ENABLED = "true";
      process.env.DEEPFILTER_MANIFEST_PATH = manifestPath;

      await configureManagedDeepFilterRuntime();

      assert.equal(process.env.DEEPFILTER_BINARY_PATH, "/opt/deepfilter/deep-filter");
      assert.equal(process.env.DEEPFILTER_BINARY_SHA256, binaryHash);
      assert.equal(process.env.DEEPFILTER_MODEL_PATH, "/opt/deepfilter/DeepFilterNet3_onnx.tar.gz");
      assert.equal(process.env.DEEPFILTER_MODEL_SHA256, modelHash);
    });
  });
});

test("rejects deployment values that disagree with the approved manifest", async () => {
  await withCleanManagedEnvironment(async () => {
    await withManifest({}, async (manifestPath) => {
      process.env.DEEPFILTERNET_ENABLED = "true";
      process.env.DEEPFILTER_MANIFEST_PATH = manifestPath;
      process.env.DEEPFILTER_MODEL_SHA256 = "c".repeat(64);

      await assert.rejects(configureManagedDeepFilterRuntime(), /DEEPFILTER_RUNTIME_DEEPFILTER_MODEL_SHA256_MISMATCH/);
    });
  });
});

test("rejects a manifest that changes the fixed model filename", async () => {
  await withCleanManagedEnvironment(async () => {
    await withManifest({ modelPath: "unapproved-model.onnx" }, async (manifestPath) => {
      process.env.DEEPFILTERNET_ENABLED = "true";
      process.env.DEEPFILTER_MANIFEST_PATH = manifestPath;

      await assert.rejects(configureManagedDeepFilterRuntime(), /DEEPFILTER_MANIFEST_MODEL_INVALID/);
    });
  });
});

async function withManifest(overrides: { modelPath?: string }, run: (manifestPath: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "courseforge-deepfilter-test-"));
  const manifestPath = join(directory, "manifest.json");
  try {
    await writeFile(manifestPath, JSON.stringify({
      artifacts: {
        binary: { path: "deep-filter", sha256: binaryHash },
        model: { path: overrides.modelPath ?? "DeepFilterNet3_onnx.tar.gz", sha256: modelHash },
      },
    }));
    await run(manifestPath);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function withCleanManagedEnvironment(run: () => Promise<void>) {
  const previous = new Map(managedEnvironmentNames.map((name) => [name, process.env[name]]));
  try {
    for (const name of managedEnvironmentNames) delete process.env[name];
    await run();
  } finally {
    for (const name of managedEnvironmentNames) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
