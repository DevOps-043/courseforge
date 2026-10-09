import assert from "node:assert/strict";
import test from "node:test";
import { prepareLegacyHtmlEditingPilot, HTML_LEGACY_INSTRUMENTATION_POLICY } from "./html-editing-legacy-instrumentation.server";
import { verifyLegacyHtmlEditingPilotPackage, HTML_LEGACY_PILOT_REVIEW_POLICY } from "./html-editing-legacy-pilot-verification.server";
import { HTML_EDITING_COMPILATION_PROFILE } from "./html-editing-compilation-profile";

const uuid = "11111111-1111-4111-8111-111111111111";
const inputs = () => ({ sourceHtml: '<section><h1>Original</h1></section>', templateId: "pilot_intro", templateVersion: 1,
  authoritativeAnchor: { organizationId: uuid, documentId: uuid, revisionId: uuid, documentSha256: "a".repeat(64), clipId: "intro" },
  grantedAssetIds: [] as string[], imageSources: new Map<string, string>() });

test("package provenance binds original, candidate, target map, compiler and native anchor", () => {
  const authoritativeInputs = inputs(), pilot = prepareLegacyHtmlEditingPilot(authoritativeInputs);
  assert.deepEqual(pilot.provenance.compilationProfile, HTML_EDITING_COMPILATION_PROFILE);
  assert.deepEqual(pilot.provenance.nativeAnchor, authoritativeInputs.authoritativeAnchor);
  assert.notEqual(pilot.provenance.nativeAnchor, authoritativeInputs.authoritativeAnchor);
  assert.equal(pilot.provenance.originalSourceSha256, pilot.original.sha256);
  assert.equal(pilot.provenance.candidateSourceSha256, pilot.candidate.sha256);
  assert.equal(pilot.provenance.compiledSha256, pilot.candidate.compiledSha256);
  const verified = verifyLegacyHtmlEditingPilotPackage({ authoritativeInputs,
    encodedPilot: JSON.stringify(pilot, null, 2), expectedProvenanceSha256: pilot.provenanceSha256 });
  assert.deepEqual(verified, pilot); assert.notEqual(verified, pilot);
  assert.equal(verified.status, "REVIEW_REQUIRED");
  assert.deepEqual(verified.requiredReviews, ["VISUAL_COMPARISON", "MANIFEST_AND_ACCESSIBILITY", "AUTHORIZED_INSTALLATION"]);
  assert.doesNotMatch(JSON.stringify(pilot.provenance), /grantedAssetIds|imageSources|https:/);
});

test("every substituted package component is rejected without changing authoritative inputs", () => {
  const authoritativeInputs = inputs(), pilot = prepareLegacyHtmlEditingPilot(authoritativeInputs);
  const before = JSON.stringify(authoritativeInputs);
  for (const change of ["original", "candidate", "targets", "template", "profile", "anchor", "reviews", "extra", "digest"]) {
    const altered = JSON.parse(JSON.stringify(pilot));
    if (change === "original") altered.original.sourceHtml += " ";
    if (change === "candidate") altered.candidate.sourceHtml += " ";
    if (change === "targets") altered.candidate.targets[0].semanticPath = [];
    if (change === "template") altered.candidate.template.templateVersion++;
    if (change === "profile") altered.provenance.compilationProfile.geometryVersion = "prior-version";
    if (change === "anchor") altered.provenance.nativeAnchor.clipId = "foreign";
    if (change === "reviews") altered.requiredReviews = [];
    if (change === "extra") altered.approved = true;
    if (change === "digest") altered.provenanceSha256 = "f".repeat(64);
    assert.throws(() => verifyLegacyHtmlEditingPilotPackage({ authoritativeInputs,
      encodedPilot: JSON.stringify(altered), expectedProvenanceSha256: pilot.provenanceSha256 }), /INVALID_SOURCE/);
  }
  assert.equal(JSON.stringify(authoritativeInputs), before);
});

test("independent source, template version and each native identity cannot drift during review", () => {
  const originalInputs = inputs(), pilot = prepareLegacyHtmlEditingPilot(originalInputs);
  for (const key of ["organizationId", "documentId", "revisionId", "documentSha256", "clipId"] as const) {
    const authoritativeInputs = inputs();
    authoritativeInputs.authoritativeAnchor[key] = key === "documentSha256" ? "b".repeat(64)
      : key === "clipId" ? "other" : "22222222-2222-4222-8222-222222222222";
    assert.throws(() => verifyLegacyHtmlEditingPilotPackage({ authoritativeInputs,
      encodedPilot: JSON.stringify(pilot), expectedProvenanceSha256: pilot.provenanceSha256 }), /INVALID_SOURCE/);
  }
  for (const change of [{ sourceHtml: originalInputs.sourceHtml + " " }, { templateVersion: 2 }]) {
    assert.throws(() => verifyLegacyHtmlEditingPilotPackage({ authoritativeInputs: { ...inputs(), ...change },
      encodedPilot: JSON.stringify(pilot), expectedProvenanceSha256: pilot.provenanceSha256 }), /INVALID_SOURCE/);
  }
});

test("current resource grants are independently rechecked even for an unchanged package", () => {
  const authoritativeInputs = { ...inputs(), sourceHtml: `<p>Image</p><img src="conformance-media/${uuid}" alt="Original">`,
    grantedAssetIds: [uuid], imageSources: new Map([[uuid, `conformance-media/${uuid}`]]) };
  const pilot = prepareLegacyHtmlEditingPilot(authoritativeInputs);
  assert.throws(() => verifyLegacyHtmlEditingPilotPackage({ authoritativeInputs: { ...authoritativeInputs, grantedAssetIds: [] },
    encodedPilot: JSON.stringify(pilot), expectedProvenanceSha256: pilot.provenanceSha256 }), /INVALID_SOURCE/);
});

test("invalid JSON, oversized package and foreign provenance pin fail without content disclosure", () => {
  const authoritativeInputs = inputs(), pilot = prepareLegacyHtmlEditingPilot(authoritativeInputs);
  for (const request of [{ encodedPilot: "{" }, { encodedPilot: "x".repeat(HTML_LEGACY_PILOT_REVIEW_POLICY.maximumBytes + 1) },
    { expectedProvenanceSha256: "f".repeat(64) }, { expectedProvenanceSha256: "bad" }]) {
    assert.throws(() => verifyLegacyHtmlEditingPilotPackage({ authoritativeInputs, encodedPilot: JSON.stringify(pilot),
      expectedProvenanceSha256: pilot.provenanceSha256, ...request }), /HTML_EDITING_/);
  }
});

test("semantic ancestor IDs cannot amplify the pilot package beyond independent map budgets", () => {
  assert.throws(() => prepareLegacyHtmlEditingPilot({ ...inputs(), sourceHtml:
    `<section id="${"a".repeat(HTML_LEGACY_INSTRUMENTATION_POLICY.maximumSemanticPathBytes)}"><h1>Original</h1></section>` }), /PAYLOAD_LIMIT/);
  assert.throws(() => prepareLegacyHtmlEditingPilot({ ...inputs(), sourceHtml:
    `<section id="${"a".repeat(6000)}">${"<p>Original</p>".repeat(100)}</section>` }), /PAYLOAD_LIMIT/);
});
