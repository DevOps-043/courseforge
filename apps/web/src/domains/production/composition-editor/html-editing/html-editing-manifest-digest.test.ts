import assert from "node:assert/strict";
import { test } from "node:test";
import type { HtmlEditableManifest, HtmlEditingBinding } from "./html-editing.contract";
import { HTML_EDITING_LIMITS } from "./html-editing.contract";
import { HtmlEditingValidationError } from "./html-editing-validation";
import {
  computeHtmlEditableManifestSha256, createHtmlEditableManifestDigestPreimage,
  validateContentVerifiedHtmlEditingCommand, verifyHtmlEditableManifestContent,
} from "./html-editing-manifest-digest.server";

const uuid = "11111111-1111-4111-8111-111111111111";
const otherUuid = "22222222-2222-4222-8222-222222222222";
const binding: HtmlEditingBinding = {
  organizationId: uuid, documentId: uuid, revisionId: uuid, documentSha256: "a".repeat(64),
  clipId: "intro", templateId: "intro", templateVersion: 1,
  sourceSha256: "b".repeat(64), manifestSha256: "0".repeat(64),
};
const manifest: HtmlEditableManifest = {
  format: "courseforge-html-editable-manifest-v1", binding,
  elements: [{ kind: "TEXT", elementId: "title", label: "Title", maxCharacters: 12, multiline: false }],
};
// Explicit independent wire vector: not built by the production canonicalizer.
// SHA-256 was also calculated with .NET SHA256 over UTF-8 bytes independently.
const goldenPreimage = "courseforge-html-editable-manifest-digest-v1\n"
  + '{"binding":{"clipId":"intro","documentId":"11111111-1111-4111-8111-111111111111","documentSha256":"'
  + "a".repeat(64)
  + '","organizationId":"11111111-1111-4111-8111-111111111111","revisionId":"11111111-1111-4111-8111-111111111111","sourceSha256":"'
  + "b".repeat(64)
  + '","templateId":"intro","templateVersion":1},"elements":[{"elementId":"title","kind":"TEXT","label":"Title","maxCharacters":12,"multiline":false}],"format":"courseforge-html-editable-manifest-v1"}';
const goldenSha256 = "d692471f8369905826d9f5ef13cec1678a11d5f81c0ad6dba872276c2d0028ae";
const authoritativeBinding = { ...binding, manifestSha256: goldenSha256 };
const authoritativeManifest = { ...manifest, binding: authoritativeBinding };
const hash = (value: HtmlEditableManifest) => computeHtmlEditableManifestSha256(JSON.stringify(value), value.binding);
function rejects(run: () => unknown, code: HtmlEditingValidationError["code"]) {
  assert.throws(run, (error: unknown) => error instanceof HtmlEditingValidationError && error.code === code);
}

test("matches independent versioned UTF-8 golden preimage and SHA-256 vector", () => {
  assert.equal(createHtmlEditableManifestDigestPreimage(JSON.stringify(manifest), binding), goldenPreimage);
  assert.equal(hash(manifest), goldenSha256);
  assert.deepEqual(verifyHtmlEditableManifestContent(JSON.stringify(authoritativeManifest), authoritativeBinding), authoritativeManifest);
});

test("object key order and JSON formatting do not change semantic digest", () => {
  const reordered = {
    elements: [{ multiline: false, maxCharacters: 12, label: "Title", kind: "TEXT", elementId: "title" }],
    binding: Object.fromEntries(Object.entries(binding).reverse()), format: manifest.format,
  };
  assert.equal(computeHtmlEditableManifestSha256(JSON.stringify(reordered, null, 2), binding), goldenSha256);
});

test("excludes exactly the self-digest slot without accepting a client-asserted digest", () => {
  const falseClaim = { ...manifest, binding: { ...binding, manifestSha256: "f".repeat(64) } };
  assert.equal(hash(falseClaim), goldenSha256);
  rejects(() => verifyHtmlEditableManifestContent(JSON.stringify(falseClaim), falseClaim.binding), "MANIFEST_DIGEST_MISMATCH");
  rejects(() => verifyHtmlEditableManifestContent(JSON.stringify(falseClaim), authoritativeBinding), "STALE_BINDING");
});

test("covers every other binding field in the digest", () => {
  for (const key of Object.keys(binding) as (keyof HtmlEditingBinding)[]) {
    if (key === "manifestSha256") continue;
    const replacement = typeof binding[key] === "number" ? 2
      : key.endsWith("Sha256") ? "d".repeat(64)
      : ["organizationId", "documentId", "revisionId"].includes(key) ? otherUuid : "changed";
    const changed = { ...manifest, binding: { ...binding, [key]: replacement } };
    assert.notEqual(hash(changed), goldenSha256, key);
  }
});

test("rejects content tampering even when all claimed binding hashes remain unchanged", () => {
  for (const alteration of [
    { label: "Different" }, { elementId: "another" }, { maxCharacters: 13 }, { multiline: true },
  ]) {
    const altered = { ...authoritativeManifest, elements: [{ ...manifest.elements[0], ...alteration }] };
    rejects(() => verifyHtmlEditableManifestContent(JSON.stringify(altered), authoritativeBinding), "MANIFEST_DIGEST_MISMATCH");
  }
});

test("preserves array ordering and covers image/theme permissions", () => {
  const extended: HtmlEditableManifest = { ...manifest, elements: [
    ...manifest.elements,
    { kind: "IMAGE", elementId: "photo", label: "Photo", allowedAssetIds: [uuid, otherUuid], allowedFits: ["CONTAIN", "COVER"] },
    { kind: "THEME", elementId: "theme", label: "Theme", tokenId: "palette", allowedChoiceIds: ["light", "dark"] },
  ] };
  const reference = hash(extended);
  assert.notEqual(hash({ ...extended, elements: [...extended.elements].reverse() }), reference);
  const image = extended.elements[1]!;
  const theme = extended.elements[2]!;
  assert.ok(image.kind === "IMAGE" && theme.kind === "THEME");
  for (const replacement of [
    { ...image, allowedAssetIds: [...image.allowedAssetIds].reverse() },
    { ...image, allowedFits: [...image.allowedFits].reverse() },
    { ...image, allowedAssetIds: [uuid] },
  ]) assert.notEqual(hash({ ...extended, elements: [extended.elements[0]!, replacement, theme] }), reference);
  for (const replacement of [
    { ...theme, tokenId: "different" },
    { ...theme, allowedChoiceIds: [...theme.allowedChoiceIds].reverse() },
    { ...theme, allowedChoiceIds: ["light"] },
  ]) assert.notEqual(hash({ ...extended, elements: [extended.elements[0]!, image, replacement] }), reference);
});

test("retains strict schema, version, unknown-field and byte limits before hashing", () => {
  rejects(() => computeHtmlEditableManifestSha256("{", binding), "INVALID_JSON");
  rejects(() => computeHtmlEditableManifestSha256("é".repeat(HTML_EDITING_LIMITS.manifestBytes / 2 + 1), binding), "PAYLOAD_LIMIT");
  for (const changed of [
    { ...manifest, format: "courseforge-html-editable-manifest-v2" },
    { ...manifest, script: "PRIVATE_PAYLOAD" },
    { ...manifest, binding: { ...binding, uri: "https://evil.invalid" } },
    { ...manifest, elements: [{ ...manifest.elements[0], style: "color:red" }] },
    { ...manifest, elements: Array(201).fill(manifest.elements[0]) },
  ]) rejects(() => computeHtmlEditableManifestSha256(JSON.stringify(changed), binding), "INVALID_MANIFEST");
});

test("verified command wrapper rechecks content and still enforces command preflight", () => {
  const encodedCommand = JSON.stringify({
    format: "courseforge-html-editable-command-v1", binding: authoritativeBinding,
    overrides: [{ operation: "SET_TEXT", elementId: "title", value: "Correction" }],
  });
  const params = { encodedManifest: JSON.stringify(authoritativeManifest), encodedCommand, authoritativeBinding, grantedAssetIds: [] };
  assert.equal(validateContentVerifiedHtmlEditingCommand(params).overrides.length, 1);
  rejects(() => validateContentVerifiedHtmlEditingCommand({ ...params,
    encodedManifest: JSON.stringify({ ...authoritativeManifest, elements: [{ ...manifest.elements[0], maxCharacters: 100 }] }),
  }), "MANIFEST_DIGEST_MISMATCH");
  rejects(() => validateContentVerifiedHtmlEditingCommand({ ...params,
    encodedCommand: encodedCommand.replace("Correction", "Exceeds declared maximum"),
  }), "VALUE_NOT_DECLARED");
});
