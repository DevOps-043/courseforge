import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { admitPreparedGoogleFont, assertGoogleFontSelectorsUnambiguous, type GoogleFontAdmissionRepository } from "../google-font-admission.server";
import { googleFontBundleIdentity } from "../google-font-bundle-identity.server";
import { GOOGLE_FONT_ADMISSION_FORMAT } from "../google-font-admission.contract";
import { BUNDLE_FONT_ID, BUNDLE_ORG_ID, BUNDLE_ACTOR_ID, BUNDLE_ID, BUNDLE_OTHER_ID } from "./google-font-bundle-fixture";

function fixture() {
  const bytes = new Uint8Array(readFileSync(require.resolve("next/dist/compiled/@vercel/og/Geist-Regular.ttf")));
  const file = { checksumSha256: createHash("sha256").update(bytes).digest("hex"), fileSizeBytes: bytes.byteLength,
    mimeType: "font/ttf" as const, embeddingCheck: "ALLOWED" as const };
  const identity = googleFontBundleIdentity({ format: "courseforge-google-font-candidate-bundle-v1", source: "google", family: "Geist",
    stylesheetChecksumSha256: "a".repeat(64), files: [file], faces: [{ ...file, style: "normal", weight: { minimum: 400, maximum: 400 }, unicodeRange: null }] });
  const state = { reads: 0, commits: 0, proofText: "", row: { id: BUNDLE_FONT_ID, organization_id: BUNDLE_ORG_ID,
    source: "google", status: "READY", family: "Geist", css_url: "https://fonts.googleapis.com/css2?family=Geist" },
    bundle: { id: BUNDLE_ID, organization_id: BUNDLE_ORG_ID, font_id: BUNDLE_FONT_ID, candidate_sha256: identity.candidateSha256,
      manifest_text: identity.manifestText, registration_css_url: "https://fonts.googleapis.com/css2?family=Geist", status: "PREPARED" } };
  const repository: GoogleFontAdmissionRepository = {
    async readFont(org, id) { state.reads++; assert.equal(org, BUNDLE_ORG_ID); assert.equal(id, BUNDLE_FONT_ID); return { ...state.row }; },
    async readBundle(org, id, hash) { assert.equal(org, BUNDLE_ORG_ID); assert.equal(id, BUNDLE_FONT_ID); assert.equal(hash, identity.candidateSha256); return { ...state.bundle }; },
    async commitAdmission(input) {
      state.commits++; state.proofText = input.proofText;
      assert.equal(input.organizationId, BUNDLE_ORG_ID); assert.equal(input.actorId, BUNDLE_ACTOR_ID);
      assert.equal(input.fontId, BUNDLE_FONT_ID); assert.equal(input.bundleId, BUNDLE_ID); assert.equal(input.candidateSha256, identity.candidateSha256);
      return { admissionId: BUNDLE_OTHER_ID, bundleId: BUNDLE_ID, fontId: BUNDLE_FONT_ID, candidateSha256: identity.candidateSha256,
        status: "READY", faceIds: [BUNDLE_OTHER_ID], created: true, scope: "DECODED_FONT_FILES_NOT_RENDER_ATTESTATION" };
    },
  };
  const input = { organizationId: BUNDLE_ORG_ID, actorId: BUNDLE_ACTOR_ID, fontId: BUNDLE_FONT_ID,
    expectedCandidateSha256: identity.candidateSha256, repository, signal: new AbortController().signal,
    storage: { async readFile(request: { candidateSha256: string }) { assert.equal(request.candidateSha256, identity.candidateSha256); return bytes; } } };
  return { input, identity, state, bytes };
}

test("admits only a saved, byte-matched, fully decoded candidate; PREPARED is not rewritten", async () => {
  const f = fixture(); const result = await admitPreparedGoogleFont(f.input);
  assert.equal(result.status, "READY"); assert.equal(f.state.commits, 1); assert.equal(f.state.reads, 2);
  assert.equal(f.state.bundle.status, "PREPARED");
  const proof = JSON.parse(f.state.proofText);
  assert.equal(proof.format, GOOGLE_FONT_ADMISSION_FORMAT); assert.equal(proof.decoder, "fontkit-2.0.4");
  assert.equal(proof.files[0].metadata.family, "Geist"); assert.ok(proof.files[0].metadata.glyphCount > 100);
});

for (const mismatch of ["tenant", "bundle-hash", "revoked", "stylesheet"] as const)
  test(`rejects ${mismatch} before decoding or committing`, async () => {
    const f = fixture();
    if (mismatch === "tenant") f.state.bundle.organization_id = BUNDLE_OTHER_ID;
    if (mismatch === "bundle-hash") f.state.bundle.candidate_sha256 = "b".repeat(64);
    if (mismatch === "revoked") f.state.bundle.status = "REVOKED";
    if (mismatch === "stylesheet") f.state.bundle.registration_css_url = "https://fonts.googleapis.com/css2?family=Other";
    await assert.rejects(admitPreparedGoogleFont(f.input)); assert.equal(f.state.commits, 0);
  });

test("rejects changed file bytes and inconsistent native receipts", async () => {
  const f = fixture(); f.input.storage.readFile = async () => new Uint8Array(f.bytes.byteLength);
  await assert.rejects(admitPreparedGoogleFont(f.input), /STALE/); assert.equal(f.state.commits, 0);
  const valid = fixture(); const commit = valid.input.repository.commitAdmission;
  valid.input.repository.commitAdmission = async request => ({ ...await commit(request) as object, bundleId: BUNDLE_OTHER_ID });
  await assert.rejects(admitPreparedGoogleFont(valid.input), /RECEIPT_MISMATCH/);
});

test("revocation after decoding prevents the commit; uncertain commits require the same explicit request", async () => {
  const stale = fixture(), read = stale.input.repository.readFont;
  stale.input.repository.readFont = async (org, id, signal) => {
    if (stale.state.reads) stale.state.row.css_url = "https://fonts.googleapis.com/css2?family=Other";
    return read(org, id, signal);
  };
  await assert.rejects(admitPreparedGoogleFont(stale.input), /STALE/); assert.equal(stale.state.commits, 0);
  const uncertain = fixture(), commit = uncertain.input.repository.commitAdmission;
  let firstProof = "";
  uncertain.input.repository.commitAdmission = async request => {
    if (!firstProof) { firstProof = request.proofText; throw new Error("unknown commit outcome"); }
    assert.equal(request.proofText, firstProof); return commit(request);
  };
  await assert.rejects(admitPreparedGoogleFont(uncertain.input));
  assert.equal((await admitPreparedGoogleFont(uncertain.input)).status, "READY");
});

test("overlapping different files cannot claim the same CSS selector, while independent weights/subsets remain distinct", () => {
  const f = fixture(), original = f.identity.manifest.faces[0];
  const second = { ...original, checksumSha256: "b".repeat(64) };
  assert.throws(() => assertGoogleFontSelectorsUnambiguous({ ...f.identity.manifest, faces: [original, second] }), /SELECTOR_AMBIGUOUS/);
  assert.doesNotThrow(() => assertGoogleFontSelectorsUnambiguous({ ...f.identity.manifest,
    faces: [original, { ...second, weight: { minimum: 700, maximum: 700 } }] }));
  assert.doesNotThrow(() => assertGoogleFontSelectorsUnambiguous({ ...f.identity.manifest,
    faces: [{ ...original, unicodeRange: "U+0000-00FF" }, { ...second, unicodeRange: "U+0400-04FF" }] }));
});
