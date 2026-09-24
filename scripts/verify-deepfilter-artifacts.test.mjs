import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyDeepfilterArtifacts } from "./verify-deepfilter-artifacts.mjs";

const filenames = {
  binary: "deep-filter",
  model: "DeepFilterNet3_onnx.tar.gz",
  apacheLicense: "LICENSE-APACHE",
  mitLicense: "LICENSE-MIT",
  thirdPartyLicenses: "THIRD_PARTY_LICENSES.txt",
};

test("accepts a reviewed model with matching license notices", async () => {
  await withFixture(async ({ manifestPath, manifest }) => {
    const result = await verifyDeepfilterArtifacts(manifestPath);
    assert.equal(result.commit, manifest.deepFilterNet.commit);
  });
});

test("rejects a bundle with a modified Apache notice", async () => {
  await withFixture(async ({ directory, manifestPath }) => {
    await writeFile(join(directory, filenames.apacheLicense), "unrelated license");
    await assert.rejects(verifyDeepfilterArtifacts(manifestPath), /DEEPFILTER_APACHELICENSE_CHECKSUM_MISMATCH/);
  });
});

test("rejects a manifest without an explicit code license selection", async () => {
  await withFixture(async ({ manifestPath, manifest }) => {
    delete manifest.compliance.codeLicense;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(verifyDeepfilterArtifacts(manifestPath), /DEEPFILTER_COMPLIANCE_NOT_APPROVED/);
  });
});

test("rejects a manifest without model review", async () => {
  await withFixture(async ({ manifestPath, manifest }) => {
    manifest.compliance.modelRedistributionApproved = false;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(verifyDeepfilterArtifacts(manifestPath), /DEEPFILTER_COMPLIANCE_NOT_APPROVED/);
  });
});

test("rejects a placeholder model license even when review is marked approved", async () => {
  await withFixture(async ({ manifestPath, manifest }) => {
    manifest.compliance.modelLicense = "PENDING_REVIEW";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(verifyDeepfilterArtifacts(manifestPath), /DEEPFILTER_COMPLIANCE_NOT_APPROVED/);
  });
});

async function withFixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "courseforge-deepfilter-verification-"));
  const manifestPath = join(directory, "manifest.json");
  try {
    const artifacts = {};
    for (const [name, filename] of Object.entries(filenames)) {
      const content = name === "apacheLicense"
        ? Buffer.from("Apache License\nVersion 2.0, January 2004")
        : name === "mitLicense"
          ? Buffer.from("The MIT License (MIT)")
          : Buffer.from(`${name} fixture`);
      await writeFile(join(directory, filename), content, { mode: name === "binary" ? 0o755 : 0o644 });
      artifacts[name] = { path: filename, sha256: createHash("sha256").update(content).digest("hex") };
    }
    const manifest = {
      deepFilterNet: { releaseTag: "v0.5.7", commit: "a".repeat(40) },
      artifacts,
      compliance: { codeLicense: "Apache-2.0", modelLicense: "LicenseRef-reviewed-model", modelRedistributionApproved: true, reviewReference: "legal-review-1234" },
    };
    await writeFile(manifestPath, JSON.stringify(manifest));
    await run({ directory, manifestPath, manifest });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
