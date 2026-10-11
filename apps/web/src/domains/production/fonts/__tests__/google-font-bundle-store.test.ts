import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { googleFontBundleIdentity } from "../google-font-bundle-identity.server";
import { googleFontBundleManifestSchema, googleFontBundleStoragePath } from "../google-font-bundle.contract";
import { persistRegisteredGoogleFont } from "../google-font-bundle-store.server";
import { createGoogleFontBundleFixture, BUNDLE_OTHER_ID } from "./google-font-bundle-fixture";

test("freezes all reviewed faces and verified bytes in a non-native prepared receipt", async () => {
  const fixture = await createGoogleFontBundleFixture();
  const receipt = await persistRegisteredGoogleFont(fixture.input);
  assert.equal(receipt.status, "PREPARED"); assert.equal(receipt.renderEligible, false); assert.equal(receipt.created, true);
  assert.equal(fixture.state.commits, 1); assert.equal(fixture.state.ensured.length, 2);
  assert.equal(fixture.state.font.source, "google"); assert.equal(fixture.state.stored?.manifest_text, fixture.identity.manifestText);
  for (const stored of fixture.state.ensured) {
    assert.ok(stored.bytes); assert.equal(stored.bytes.length, stored.file.fileSizeBytes);
    assert.equal(createHash("sha256").update(stored.bytes).digest("hex"), stored.file.checksumSha256);
  }
});

test("retry reauthorizes and verifies existing objects without another Google download", async () => {
  const fixture = await createGoogleFontBundleFixture(); const first = await persistRegisteredGoogleFont(fixture.input);
  fixture.state.ensured = [];
  const replay = await persistRegisteredGoogleFont({ ...fixture.input, fetchImpl: async () => { assert.fail("must not contact Google"); } });
  assert.equal(replay.bundleId, first.bundleId); assert.equal(replay.created, false); assert.equal(fixture.state.reads, 4);
  assert.equal(fixture.state.ensured.length, 2); assert.ok(fixture.state.ensured.every(file => file.bytes === undefined));
});

test("unknown SQL outcome is resolved by the same identity, not a second bundle", async () => {
  const fixture = await createGoogleFontBundleFixture(); fixture.state.loseCommitResponse = true;
  await assert.rejects(persistRegisteredGoogleFont(fixture.input), /unknown commit outcome/);
  assert.ok(fixture.state.stored);
  const replay = await persistRegisteredGoogleFont({ ...fixture.input, fetchImpl: async () => { assert.fail("no Google retry"); } });
  assert.equal(replay.created, false); assert.equal(replay.candidateSha256, fixture.identity.candidateSha256);
});

test("a changed reviewed hash prevents every Storage write and commit", async () => {
  const fixture = await createGoogleFontBundleFixture();
  await assert.rejects(persistRegisteredGoogleFont({ ...fixture.input, expectedCandidateSha256: "f".repeat(64) }), /STALE/);
  assert.equal(fixture.state.ensured.length, 0); assert.equal(fixture.state.commits, 0);
});

test("partial Storage failure never creates a database receipt or deletes shared files", async () => {
  const fixture = await createGoogleFontBundleFixture();
  fixture.input.storage.ensureFile = async input => {
    if (fixture.state.ensured.length) throw new Error("storage failed");
    fixture.state.ensured.push(input);
  };
  await assert.rejects(persistRegisteredGoogleFont(fixture.input), /storage failed/);
  assert.equal(fixture.state.ensured.length, 1); assert.equal(fixture.state.commits, 0); assert.equal(fixture.state.stored, null);
});

test("registration revoked while files are being written blocks commit", async () => {
  const fixture = await createGoogleFontBundleFixture();
  fixture.input.storage.ensureFile = async input => { fixture.state.ensured.push(input); fixture.state.font.status = "REJECTED"; };
  await assert.rejects(persistRegisteredGoogleFont(fixture.input), /STALE/);
  assert.equal(fixture.state.commits, 0);
});

for (const [field, value] of [["organization_id", BUNDLE_OTHER_ID], ["id", BUNDLE_OTHER_ID], ["source", "uploaded"], ["status", "REJECTED"]]) {
  test(`rejects a mismatched initial registry ${field} before any Storage action`, async () => {
    const fixture = await createGoogleFontBundleFixture(); Object.assign(fixture.state.font, { [field]: value });
    await assert.rejects(persistRegisteredGoogleFont(fixture.input));
    assert.equal(fixture.state.ensured.length, 0); assert.equal(fixture.state.commits, 0);
  });
}

for (const [field, value] of [["organization_id", BUNDLE_OTHER_ID], ["font_id", BUNDLE_OTHER_ID], ["registration_css_url", "https://evil.test"], ["status", "REVOKED"]]) {
  test(`rejects mismatched/revoked durable ${field} without reacquiring bytes`, async () => {
    const fixture = await createGoogleFontBundleFixture(); await persistRegisteredGoogleFont(fixture.input); fixture.state.ensured = [];
    Object.assign(fixture.state.stored!, { [field]: value });
    await assert.rejects(persistRegisteredGoogleFont({ ...fixture.input, fetchImpl: async () => { assert.fail("must not fetch"); } }));
    assert.equal(fixture.state.ensured.length, 0); assert.equal(fixture.state.commits, 1);
  });
}

test("rejects an unbound durable manifest instead of silently repairing it", async () => {
  const fixture = await createGoogleFontBundleFixture(); await persistRegisteredGoogleFont(fixture.input);
  fixture.state.stored!.manifest_text = JSON.stringify({ ...fixture.identity.manifest, family: "Other" });
  fixture.state.ensured = [];
  await assert.rejects(persistRegisteredGoogleFont(fixture.input)); assert.equal(fixture.state.ensured.length, 0);
});

test("canonical bundle hash is stable under input file/face ordering", async () => {
  const fixture = await createGoogleFontBundleFixture();
  const reordered = googleFontBundleIdentity({ ...fixture.identity.manifest, files: [...fixture.identity.manifest.files].reverse(),
    faces: [...fixture.identity.manifest.faces].reverse() });
  assert.equal(reordered.candidateSha256, fixture.identity.candidateSha256);
  assert.equal(reordered.manifestText, fixture.identity.manifestText);
});

test("rejects missing, duplicate or descriptor-mismatched file bindings", async () => {
  const fixture = await createGoogleFontBundleFixture(), manifest = fixture.identity.manifest;
  for (const altered of [
    { ...manifest, files: [] }, { ...manifest, files: [...manifest.files, manifest.files[0]] },
    { ...manifest, faces: [manifest.faces[0]] }, { ...manifest, faces: [...manifest.faces, manifest.faces[0]] },
    { ...manifest, faces: [{ ...manifest.faces[0], fileSizeBytes: 999 }, manifest.faces[1]] },
    { ...manifest, faces: [{ ...manifest.faces[0], unicodeRange: "U+110000" }, manifest.faces[1]] },
    { ...manifest, files: [{ ...manifest.files[0], storagePath: "untrusted" }, manifest.files[1]] },
  ]) assert.equal(googleFontBundleManifestSchema.safeParse(altered).success, false);
});

test("Storage paths derive only from validated tenant/hash/MIME identity", async () => {
  const fixture = await createGoogleFontBundleFixture();
  assert.match(googleFontBundleStoragePath(fixture.input.organizationId, fixture.identity.candidateSha256, fixture.identity.manifest.files[0]),
    /^[a-f0-9-]+\/google-candidates\/[a-f0-9]{64}\/[a-f0-9]{64}\.woff2$/);
  assert.throws(() => googleFontBundleStoragePath("../evil", fixture.identity.candidateSha256, fixture.identity.manifest.files[0]));
});

test("an aborted materialization never contacts a repository", async () => {
  const fixture = await createGoogleFontBundleFixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(persistRegisteredGoogleFont({ ...fixture.input, signal: controller.signal }));
  assert.equal(fixture.state.reads, 0); assert.equal(fixture.state.commits, 0);
});

test("rejects receipt identity substitution", async () => {
  const fixture = await createGoogleFontBundleFixture();
  fixture.input.repository.commitBundle = async () => ({ bundleId: BUNDLE_OTHER_ID, candidateSha256: "f".repeat(64), status: "PREPARED", renderEligible: false, created: true });
  await assert.rejects(persistRegisteredGoogleFont(fixture.input), /RECEIPT_MISMATCH/);
});
