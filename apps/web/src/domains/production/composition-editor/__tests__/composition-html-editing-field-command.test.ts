import test from "node:test";
import assert from "node:assert/strict";
import { prepareHtmlEditingFieldCommand } from "../composition-html-editing-field-command.client";
import { createHtmlEditingInspectorView } from "../html-editing/html-editing-inspector.server";
import { computeHtmlEditableManifestSha256 } from "../html-editing/html-editing-manifest-digest.server";
import { createHtmlEditingRevisionFixture as fixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function setup() {
  const f = fixture(`<section id="theme" data-courseforge-theme-token="Palette" data-courseforge-theme-choice="light"><h1 id="title">Original</h1><img id="photo" src="conformance-media/${uuid}"></section>`);
  const revision = structuredClone(f.current.revision);
  revision.manifest.elements.push({ kind: "THEME", elementId: "theme", label: "Theme", tokenId: "Palette", allowedChoiceIds: ["light", "dark"] });
  revision.manifest.binding.manifestSha256 = computeHtmlEditableManifestSha256(JSON.stringify(revision.manifest), revision.manifest.binding);
  revision.state.binding = { ...revision.manifest.binding };
  return createHtmlEditingInspectorView({ ...f.authority, authoritativeBinding: revision.manifest.binding,
    encodedRevision: JSON.stringify(revision), compositionDocumentHash: f.row.compositionDocumentHash });
}

test("field preflight produces only bounded typed override and CAS locators, never authority", () => {
  const view = setup(), override = { operation: "SET_TEXT", elementId: "title", value: "" };
  const body = prepareHtmlEditingFieldCommand(view, override);
  assert.deepEqual(body, { action: "COMMAND", expected: { version: view.revisionVersion, sha256: view.revisionSha256 },
    expectedCompositionDocumentHash: view.compositionDocumentHash, overrides: [override] });
  assert.equal(JSON.stringify(body).includes("binding"), false); assert.equal(JSON.stringify(body).includes("grantedAssetIds"), false);
  assert.equal(view.state.overrides.length, 0);
});

test("field preflight enforces declared text codepoints, single-line behavior and inert text", () => {
  const view = setup();
  assert.doesNotThrow(() => prepareHtmlEditingFieldCommand(view, { operation: "SET_TEXT", elementId: "title", value: "😀".repeat(100) }));
  for (const value of ["x".repeat(101), "first\nsecond", "<script>"]) {
    assert.throws(() => prepareHtmlEditingFieldCommand(view, { operation: "SET_TEXT", elementId: "title", value }));
  }
});

test("image preflight rejects revoked, undeclared IDs and unsupported fit without raw URLs", () => {
  const view = setup(); view.grantedAssetIds = [uuid];
  assert.doesNotThrow(() => prepareHtmlEditingFieldCommand(view, { operation: "SET_IMAGE", elementId: "photo", assetId: uuid, fit: "COVER" }));
  for (const override of [
    { operation: "SET_IMAGE", elementId: "photo", assetId: other, fit: "COVER" },
    { operation: "SET_IMAGE", elementId: "photo", assetId: uuid, fit: "CONTAIN" },
    { operation: "SET_IMAGE", elementId: "photo", assetId: "https://example.invalid/image", fit: "COVER" },
  ]) assert.throws(() => prepareHtmlEditingFieldCommand(view, override));
  view.grantedAssetIds = [other];
  assert.throws(() => prepareHtmlEditingFieldCommand(view, { operation: "RESET", elementId: "photo", property: "IMAGE" }));
  assert.doesNotThrow(() => prepareHtmlEditingFieldCommand(view, { operation: "SET_IMAGE", elementId: "photo", assetId: other, fit: "COVER" }));
});

test("themes require declared token and choice; reset targets exactly the declared property", () => {
  const view = setup();
  assert.doesNotThrow(() => prepareHtmlEditingFieldCommand(view, { operation: "SET_THEME", elementId: "theme", tokenId: "Palette", choiceId: "dark" }));
  for (const override of [
    { operation: "SET_THEME", elementId: "theme", tokenId: "Other", choiceId: "dark" },
    { operation: "SET_THEME", elementId: "theme", tokenId: "Palette", choiceId: "unknown" },
    { operation: "RESET", elementId: "title", property: "IMAGE" },
    { operation: "RESET", elementId: "missing", property: "TEXT" },
  ]) assert.throws(() => prepareHtmlEditingFieldCommand(view, override));
  assert.doesNotThrow(() => prepareHtmlEditingFieldCommand(view, { operation: "RESET", elementId: "theme", property: "THEME" }));
});

test("extra fields, HTML/source or scope claims cannot enter a field command", () => {
  const view = setup();
  for (const extra of [{ actorId: uuid }, { sourceHtml: "private" }, { binding: view.manifest.binding }, { script: "execute" }]) {
    assert.throws(() => prepareHtmlEditingFieldCommand(view, { operation: "SET_TEXT", elementId: "title", value: "Safe", ...extra }));
  }
});
