import assert from "node:assert/strict";
import { test } from "node:test";
import { HTML_EDITING_LIMITS, type HtmlEditingBinding, type HtmlEditableManifest } from "./html-editing.contract";
import { HtmlEditingValidationError, parseHtmlEditableManifest, validateHtmlEditingCommand } from "./html-editing-validation";

const uuid = "11111111-1111-4111-8111-111111111111";
const otherUuid = "22222222-2222-4222-8222-222222222222";
const binding: HtmlEditingBinding = {
  organizationId: uuid, documentId: uuid, revisionId: uuid, documentSha256: "a".repeat(64),
  clipId: "slide_intro", templateId: "intro", templateVersion: 1,
  sourceSha256: "b".repeat(64), manifestSha256: "c".repeat(64),
};
const manifest: HtmlEditableManifest = {
  format: "courseforge-html-editable-manifest-v1", binding,
  elements: [
    { kind: "TEXT", elementId: "title", label: "Título", maxCharacters: 12, multiline: false },
    { kind: "IMAGE", elementId: "photo", label: "Foto", allowedAssetIds: [uuid], allowedFits: ["COVER"] },
    { kind: "THEME", elementId: "palette", label: "Paleta", tokenId: "palette", allowedChoiceIds: ["light", "dark"] },
  ],
};
function command(overrides: unknown[], identity = binding) {
  return JSON.stringify({ format: "courseforge-html-editable-command-v1", binding: identity, overrides });
}
function validate(encodedCommand: string, grantedAssetIds: string[] = [uuid]) {
  return validateHtmlEditingCommand({ encodedCommand, manifest, verifiedBinding: binding, grantedAssetIds });
}
function rejects(run: () => unknown, code: HtmlEditingValidationError["code"]) {
  assert.throws(run, (error: unknown) => error instanceof HtmlEditingValidationError && error.code === code);
}

test("validates all V1 property operations without mutating source or inputs", () => {
  const before = JSON.stringify(manifest);
  const result = validate(command([
    { operation: "SET_TEXT", elementId: "title", value: "Corrección" },
    { operation: "SET_IMAGE", elementId: "photo", assetId: uuid, fit: "COVER" },
    { operation: "SET_THEME", elementId: "palette", tokenId: "palette", choiceId: "dark" },
  ]));
  assert.equal(result.overrides.length, 3);
  assert.equal(JSON.stringify(manifest), before);
  result.binding.clipId = "different";
  assert.equal(binding.clipId, "slide_intro");
  assert.deepEqual(parseHtmlEditableManifest(JSON.stringify(manifest), binding), manifest);
});

test("rejects every independently stale or foreign identity component", () => {
  for (const key of Object.keys(binding) as (keyof HtmlEditingBinding)[]) {
    const replacement = typeof binding[key] === "number" ? 2
      : key.endsWith("Sha256") ? "d".repeat(64)
      : key.endsWith("Id") && !["clipId", "templateId"].includes(key) ? otherUuid : "different";
    rejects(() => validate(command([{ operation: "SET_TEXT", elementId: "title", value: "Ok" }], { ...binding, [key]: replacement })), "STALE_BINDING");
    rejects(() => parseHtmlEditableManifest(JSON.stringify({ ...manifest, binding: { ...binding, [key]: replacement } }), binding), "STALE_BINDING");
  }
});

test("rejects unknown properties, markup, URLs in resource fields and free styles", () => {
  for (const override of [
    { operation: "SET_TEXT", elementId: "title", value: "Ok", innerHTML: "secret" },
    { operation: "SET_TEXT", elementId: "title", value: "<script>x</script>" },
    { operation: "SET_TEXT", elementId: "title", value: "\u0000" },
    { operation: "SET_IMAGE", elementId: "photo", assetId: "https://evil.invalid/a", fit: "COVER" },
    { operation: "SET_IMAGE", elementId: "photo", assetId: "javascript:alert(1)", fit: "COVER" },
    { operation: "SET_THEME", elementId: "palette", tokenId: "palette", choiceId: "url(https://evil.invalid)" },
    { operation: "SET_STYLE", elementId: "title", value: "position:fixed" },
  ]) rejects(() => validate(command([override])), "INVALID_COMMAND");
  rejects(() => validate(JSON.stringify({ ...JSON.parse(command([{ operation: "RESET", elementId: "title", property: "TEXT" }])), script: "secret" })), "INVALID_COMMAND");
  rejects(() => parseHtmlEditableManifest(JSON.stringify({ ...manifest, selector: "#title" }), binding), "INVALID_MANIFEST");
});

test("enforces manifest-specific element kind, text limits and single-line policy", () => {
  rejects(() => validate(command([{ operation: "SET_TEXT", elementId: "missing", value: "Ok" }])), "UNKNOWN_ELEMENT");
  rejects(() => validate(command([{ operation: "SET_TEXT", elementId: "photo", value: "Ok" }])), "PROPERTY_NOT_DECLARED");
  for (const value of ["x".repeat(13), "first\nnext", "first\u2028next"]) {
    rejects(() => validate(command([{ operation: "SET_TEXT", elementId: "title", value }])), "VALUE_NOT_DECLARED");
  }
  assert.equal(validate(command([{ operation: "SET_TEXT", elementId: "title", value: "" }])).overrides.length, 1);
});

test("requires both template allowlist and current authorization for image assets", () => {
  rejects(() => validate(command([{ operation: "SET_IMAGE", elementId: "photo", assetId: otherUuid, fit: "COVER" }])), "VALUE_NOT_DECLARED");
  rejects(() => validate(command([{ operation: "SET_IMAGE", elementId: "photo", assetId: uuid, fit: "CONTAIN" }])), "VALUE_NOT_DECLARED");
  rejects(() => validate(command([{ operation: "SET_IMAGE", elementId: "photo", assetId: uuid, fit: "COVER" }]), []), "ASSET_NOT_AUTHORIZED");
});

test("theme choices are symbolic template declarations, not editable CSS values", () => {
  rejects(() => validate(command([{ operation: "SET_THEME", elementId: "palette", tokenId: "another", choiceId: "light" }])), "VALUE_NOT_DECLARED");
  rejects(() => validate(command([{ operation: "SET_THEME", elementId: "palette", tokenId: "palette", choiceId: "unknown" }])), "VALUE_NOT_DECLARED");
});

test("rejects ambiguous duplicate overrides and resets only declared properties", () => {
  const reset = { operation: "RESET", elementId: "title", property: "TEXT" };
  assert.equal(validate(command([reset])).overrides.length, 1);
  rejects(() => validate(command([reset, { operation: "SET_TEXT", elementId: "title", value: "Ok" }])), "DUPLICATE_OVERRIDE");
  rejects(() => validate(command([{ ...reset, property: "IMAGE" }])), "PROPERTY_NOT_DECLARED");
});

test("manifest rejects duplicated identities and unknown fields inside declarations", () => {
  rejects(() => parseHtmlEditableManifest(JSON.stringify({ ...manifest, elements: [manifest.elements[0], manifest.elements[0]] }), binding), "INVALID_MANIFEST");
  rejects(() => parseHtmlEditableManifest(JSON.stringify({ ...manifest, elements: [{ ...manifest.elements[0], onclick: "secret" }] }), binding), "INVALID_MANIFEST");
  rejects(() => parseHtmlEditableManifest(JSON.stringify({ ...manifest, elements: Array(201).fill(manifest.elements[0]) }), binding), "INVALID_MANIFEST");
});

test("bounds encoded UTF-8 bytes before parsing and rejects malformed JSON", () => {
  rejects(() => validate("not json"), "INVALID_JSON");
  rejects(() => validate("é".repeat(HTML_EDITING_LIMITS.commandBytes / 2 + 1)), "PAYLOAD_LIMIT");
  rejects(() => validate(command(Array(51).fill({ operation: "RESET", elementId: "title", property: "TEXT" }))), "INVALID_COMMAND");
  rejects(() => validate(command([])), "INVALID_COMMAND");
});

test("safe validation errors never echo supplied content", () => {
  const secret = "PRIVATE_PAYLOAD";
  try { validate(command([{ operation: "SET_TEXT", elementId: "title", value: `<${secret}>` }])); }
  catch (error) {
    assert.ok(error instanceof HtmlEditingValidationError);
    assert.equal(error.message, "HTML_EDITING_INVALID_COMMAND");
    assert.ok(!error.stack?.includes(secret));
    return;
  }
  assert.fail("must reject malformed content");
});
