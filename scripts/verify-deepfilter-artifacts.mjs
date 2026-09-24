import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, lstat, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const expectedArtifacts = {
  binary: { filename: "deep-filter", maxBytes: 100 * 1024 * 1024, executable: true },
  model: { filename: "DeepFilterNet3_onnx.tar.gz", maxBytes: 100 * 1024 * 1024 },
  apacheLicense: { filename: "LICENSE-APACHE", maxBytes: 100 * 1024 },
  mitLicense: { filename: "LICENSE-MIT", maxBytes: 100 * 1024 },
  thirdPartyLicenses: { filename: "THIRD_PARTY_LICENSES.txt", maxBytes: 2 * 1024 * 1024 },
};

export async function verifyDeepfilterArtifacts(manifestPath) {
  const manifestFile = resolve(manifestPath);
  await assertRegularFile(manifestFile, 1024 * 1024);
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const releaseTag = nonEmptyString(manifest?.deepFilterNet?.releaseTag);
  const commit = manifest?.deepFilterNet?.commit;
  const reviewReference = nonEmptyString(manifest?.compliance?.reviewReference);
  const modelLicense = nonEmptyString(manifest?.compliance?.modelLicense);

  if (!releaseTag || !/^[a-f0-9]{40}$/.test(commit || "") || !reviewReference
    || manifest?.compliance?.modelRedistributionApproved !== true
    || manifest?.compliance?.codeLicense !== "Apache-2.0"
    || !modelLicense || modelLicense === "PENDING_REVIEW") {
    throw new Error("DEEPFILTER_COMPLIANCE_NOT_APPROVED");
  }

  const artifactRoot = dirname(manifestFile);
  for (const [name, contract] of Object.entries(expectedArtifacts)) {
    const entry = manifest?.artifacts?.[name];
    if (entry?.path !== contract.filename || !/^[a-f0-9]{64}$/.test(entry?.sha256 || "")) {
      throw new Error(`DEEPFILTER_${name.toUpperCase()}_MANIFEST_INVALID`);
    }
    const artifactPath = join(artifactRoot, contract.filename);
    await assertRegularFile(artifactPath, contract.maxBytes, contract.executable);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(artifactPath)) hash.update(chunk);
    if (hash.digest("hex") !== entry.sha256) {
      throw new Error(`DEEPFILTER_${name.toUpperCase()}_CHECKSUM_MISMATCH`);
    }
  }

  const apacheText = await readFile(join(artifactRoot, expectedArtifacts.apacheLicense.filename), "utf8");
  const mitText = await readFile(join(artifactRoot, expectedArtifacts.mitLicense.filename), "utf8");
  if (!apacheText.includes("Apache License") || !apacheText.includes("Version 2.0, January 2004")
    || !mitText.includes("The MIT License (MIT)")) {
    throw new Error("DEEPFILTER_LICENSE_TEXT_INVALID");
  }
  return { releaseTag, commit, reviewReference };
}

async function assertRegularFile(path, maxBytes, executable = false) {
  const info = await lstat(path);
  if (!info.isFile() || info.size === 0 || info.size > maxBytes) {
    throw new Error("DEEPFILTER_ARTIFACT_TYPE_OR_SIZE_INVALID");
  }
  if (executable) await access(path, constants.X_OK);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifestPath = process.env.DEEPFILTER_MANIFEST_PATH
    || resolve(dirname(fileURLToPath(import.meta.url)), "../apps/api/third_party/deepfilter/manifest.json");
  try {
    const result = await verifyDeepfilterArtifacts(manifestPath);
    console.info(`DeepFilterNet artifacts verified: ${result.releaseTag} (${result.commit.slice(0, 12)})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "DEEPFILTER_VERIFICATION_FAILED");
    process.exitCode = 1;
  }
}
