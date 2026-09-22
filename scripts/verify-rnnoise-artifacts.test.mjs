import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PINNED_RNNOISE_COMMIT, verifyRnnoiseArtifacts } from "./verify-rnnoise-artifacts.mjs";

const filenames = {
  archive: "rnnoise-data.tar.gz",
  sourceC: "rnnoise_data.c",
  header: "rnnoise_data.h",
  blob: "weights_blob.bin",
  modelLicense: "MODEL-LICENSE",
};

test("accepts only a complete approved manifest with matching file hashes", async () => {
  await withFixture(async ({ manifestPath, manifest, archiveSha256 }) => {
    const result = await verifyRnnoiseArtifacts(manifestPath, {
      commit: PINNED_RNNOISE_COMMIT,
      archiveSha256,
    });
    assert.equal(result.reviewReference, manifest.compliance.reviewReference);
  });
});

test("rejects a manifest without model redistribution approval", async () => {
  await withFixture(async ({ manifestPath, manifest, archiveSha256 }) => {
    manifest.compliance.imageRedistributionApproved = false;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      verifyRnnoiseArtifacts(manifestPath, { commit: PINNED_RNNOISE_COMMIT, archiveSha256 }),
      /RNNOISE_MODEL_REDISTRIBUTION_NOT_APPROVED/,
    );
  });
});

test("rejects a modified blob even when its manifest still has the approved hash", async () => {
  await withFixture(async ({ directory, manifestPath, archiveSha256 }) => {
    await writeFile(join(directory, filenames.blob), "modified blob");
    await assert.rejects(
      verifyRnnoiseArtifacts(manifestPath, { commit: PINNED_RNNOISE_COMMIT, archiveSha256 }),
      /RNNOISE_BLOB_CHECKSUM_MISMATCH/,
    );
  });
});

test("rejects a source commit different from the pinned checkout", async () => {
  await withFixture(async ({ manifestPath, manifest, archiveSha256 }) => {
    manifest.source.commit = "0".repeat(40);
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      verifyRnnoiseArtifacts(manifestPath, { commit: PINNED_RNNOISE_COMMIT, archiveSha256 }),
      /RNNOISE_SOURCE_COMMIT_MISMATCH/,
    );
  });
});

test("rejects an archive hash that differs from the approved model version", async () => {
  await withFixture(async ({ manifestPath }) => {
    await assert.rejects(
      verifyRnnoiseArtifacts(manifestPath, {
        commit: PINNED_RNNOISE_COMMIT,
        archiveSha256: "0".repeat(64),
      }),
      /RNNOISE_MODEL_ARCHIVE_VERSION_MISMATCH/,
    );
  });
});

async function withFixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "courseforge-rnnoise-verification-"));
  const manifestPath = join(directory, "manifest.json");
  try {
    const artifacts = {};
    for (const [name, filename] of Object.entries(filenames)) {
      const content = Buffer.from(`${name} fixture`);
      await writeFile(join(directory, filename), content);
      artifacts[name] = { path: filename, sha256: sha256(content) };
    }
    const manifest = {
      source: { commit: PINNED_RNNOISE_COMMIT },
      artifacts,
      compliance: { imageRedistributionApproved: true, reviewReference: "legal-review-1234" },
    };
    await writeFile(manifestPath, JSON.stringify(manifest));
    await run({ directory, manifestPath, manifest, archiveSha256: artifacts.archive.sha256 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
