import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PINNED_RNNOISE_COMMIT = "70f1d256acd4b34a572f999a05c87bf00b67730d";
export const PINNED_MODEL_ARCHIVE_SHA256 = "0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37";

const expectedArtifacts = {
  archive: { filename: "rnnoise-data.tar.gz", maxBytes: 100 * 1024 * 1024 },
  sourceC: { filename: "rnnoise_data.c", maxBytes: 100 * 1024 * 1024 },
  header: { filename: "rnnoise_data.h", maxBytes: 10 * 1024 * 1024 },
  blob: { filename: "weights_blob.bin", maxBytes: 100 * 1024 * 1024 },
  modelLicense: { filename: "MODEL-LICENSE", maxBytes: 1024 * 1024 },
};

export async function verifyRnnoiseArtifacts(
  manifestPath,
  expected = { commit: PINNED_RNNOISE_COMMIT, archiveSha256: PINNED_MODEL_ARCHIVE_SHA256 },
) {
  const manifestFile = resolve(manifestPath);
  await assertRegularFile(manifestFile, 1024 * 1024);
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  if (manifest?.source?.commit !== expected.commit) {
    throw new Error("RNNOISE_SOURCE_COMMIT_MISMATCH");
  }
  if (manifest?.compliance?.imageRedistributionApproved !== true
    || typeof manifest?.compliance?.reviewReference !== "string"
    || manifest.compliance.reviewReference.trim().length < 8) {
    throw new Error("RNNOISE_MODEL_REDISTRIBUTION_NOT_APPROVED");
  }
  const artifactRoot = dirname(manifestFile);
  for (const [name, contract] of Object.entries(expectedArtifacts)) {
    const entry = manifest?.artifacts?.[name];
    if (entry?.path !== contract.filename || !/^[a-f0-9]{64}$/.test(entry?.sha256 || "")) {
      throw new Error(`RNNOISE_${name.toUpperCase()}_MANIFEST_INVALID`);
    }
    if (name === "archive" && entry.sha256 !== expected.archiveSha256) {
      throw new Error("RNNOISE_MODEL_ARCHIVE_VERSION_MISMATCH");
    }
    const artifactPath = join(artifactRoot, contract.filename);
    await assertRegularFile(artifactPath, contract.maxBytes);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(artifactPath)) hash.update(chunk);
    if (hash.digest("hex") !== entry.sha256) {
      throw new Error(`RNNOISE_${name.toUpperCase()}_CHECKSUM_MISMATCH`);
    }
  }
  return { commit: expected.commit, reviewReference: manifest.compliance.reviewReference.trim() };
}

async function assertRegularFile(path, maxBytes) {
  const info = await lstat(path);
  if (!info.isFile() || info.size === 0 || info.size > maxBytes) {
    throw new Error("RNNOISE_ARTIFACT_TYPE_OR_SIZE_INVALID");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifestPath = process.env.RNNOISE_MANIFEST_PATH
    || resolve(dirname(fileURLToPath(import.meta.url)), "../apps/api/third_party/rnnoise/manifest.json");
  try {
    const result = await verifyRnnoiseArtifacts(manifestPath);
    console.info(`RNNoise approved artifact manifest verified: ${result.commit.slice(0, 12)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "RNNOISE_VERIFICATION_FAILED");
    process.exitCode = 1;
  }
}
