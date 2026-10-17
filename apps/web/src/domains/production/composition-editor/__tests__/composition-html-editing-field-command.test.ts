import test from "node:test";
import assert from "node:assert/strict";
import { prepareHtmlEditingFieldCommand, prepareHtmlEditingBatchCommand, stageHtmlEditingFieldOverride, stageHtmlEditingTargetReset } from "../composition-html-editing-field-command.client";
import { createHtmlEditingInspectorView } from "../html-editing/html-editing-inspector.server";
import { computeHtmlEditableManifestSha256 } from "../html-editing/html-editing-manifest-digest.server";
import { createHtmlEditingRevisionFixture as fixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function setup(extended = false) {
  const f = fixture(`<section id="theme" data-courseforge-theme-token="Palette" data-courseforge-theme-choice="light"><h1 id="title">Original</h1><img id="photo" src="conformance-media/${uuid}">${extended ? '<div id="panel" style="display:flex"><p id="label" aria-label="Original">Content</p></div>' : ""}</section>`);
  const revision = structuredClone(f.current.revision);
  revision.manifest.elements.push({ kind: "THEME", elementId: "theme", label: "Theme", tokenId: "Palette", allowedChoiceIds: ["light", "dark"] });
  if (extended) revision.manifest.elements.push(
    { kind: "VISIBILITY", elementId: "panel", label: "Panel", visibleDisplay: "FLEX" },
    { kind: "ATTRIBUTE", elementId: "label", label: "Accessible name", attributeName: "aria-label", maxCharacters: 100,
      allowedValues: ["Original", "Updated"] });
  revision.manifest.binding.manifestSha256 = computeHtmlEditableManifestSha256(JSON.stringify(revision.manifest), revision.manifest.binding);
  revision.state.binding = { ...revision.manifest.binding };
  return createHtmlEditingInspectorView({ ...f.authority, authoritativeBinding: revision.manifest.binding,
    encodedRevision: JSON.stringify(revision), compositionDocumentHash: f.row.compositionDocumentHash });
}

test("target reset replaces all staged fields of one node and retains unrelated intent in one typed batch", () => {
  const view = setup();
  view.manifest.elements.push({ kind: "ATTRIBUTE", elementId: "tooltip", targetElementId: "title",
    label: "Tooltip", attributeName: "title", maxCharacters: 100 });
  view.defaults.push({ kind: "ATTRIBUTE", elementId: "tooltip", attributeName: "title", value: null });
  const prior = [{ operation: "SET_TEXT", elementId: "title", value: "Changed" },
    { operation: "SET_ATTRIBUTE", elementId: "tooltip", attributeName: "title", value: "Hint" },
    { operation: "SET_THEME", elementId: "theme", tokenId: "Palette", choiceId: "dark" }];
  const before = JSON.stringify({ view, prior });
  const staged = stageHtmlEditingTargetReset(view, prior, "title");
  assert.deepEqual(staged.filter(override => override.operation === "RESET"), [
    { operation: "RESET", elementId: "title", property: "TEXT" },
    { operation: "RESET", elementId: "tooltip", property: "ATTRIBUTE" }]);
  assert.ok(staged.some(override => override.operation === "SET_THEME"));
  assert.equal(JSON.stringify({ view, prior }), before);
  const body = prepareHtmlEditingBatchCommand(view, staged);
  assert.ok(body.action === "COMMAND");
  assert.deepEqual(body.overrides, staged);
  assert.equal(JSON.stringify(body).includes("targetElementId"), false);
  assert.deepEqual(stageHtmlEditingTargetReset(view, staged, "title"), staged);
});

test("full node reset cannot resurrect a revoked image default or publish partial staging", () => {
  const view = setup();
  view.manifest.elements.push({ kind: "ATTRIBUTE", elementId: "imageTitle", targetElementId: "photo",
    label: "Image title", attributeName: "title", maxCharacters: 100 });
  view.defaults.push({ kind: "ATTRIBUTE", elementId: "imageTitle", attributeName: "title", value: null });
  view.grantedAssetIds = [other];
  const prior = [{ operation: "SET_IMAGE", elementId: "photo", assetId: other, fit: "COVER" }];
  const unchanged = JSON.stringify(prior);
  assert.throws(() => stageHtmlEditingTargetReset(view, prior, "photo"), /ASSET_NOT_AUTHORIZED/);
  assert.equal(JSON.stringify(prior), unchanged);
  assert.throws(() => stageHtmlEditingTargetReset(view, [], "foreign"), /UNKNOWN_ELEMENT/);
});

test("target reset rejects oversized batches instead of truncating fields or dropping unrelated drafts", () => {
  const view = setup();
  for (let index = 0; index < 51; index++) {
    const elementId = `field${index}`;
    view.manifest.elements.push({ kind: "TEXT", elementId, label: elementId, maxCharacters: 10, multiline: true });
    view.defaults.push({ kind: "TEXT", elementId, value: "Text" });
  }
  const prior = Array.from({ length: 50 }, (_, index) => ({ operation: "SET_TEXT", elementId: `field${index}`, value: "Next" }));
  const before = JSON.stringify(prior);
  assert.throws(() => stageHtmlEditingTargetReset(view, prior, "title"));
  assert.equal(JSON.stringify(prior), before);
});

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
  assert.throws(() => prepareHtmlEditingFieldCommand(view, { operation: "RESET", elementId: "photo", property: "ALL" }));
  assert.doesNotThrow(() => prepareHtmlEditingFieldCommand(view, { operation: "SET_IMAGE", elementId: "photo", assetId: other, fit: "COVER" }));
});

test("attribute and visibility field staging reaches one typed CAS batch and cannot smuggle other attributes", () => {
  const view = setup(true);
  const attribute = { operation: "SET_ATTRIBUTE", elementId: "label", attributeName: "aria-label", value: "Updated" };
  const visibility = { operation: "SET_VISIBILITY", elementId: "panel", visible: false };
  let draft = stageHtmlEditingFieldOverride(view, [], attribute);
  draft = stageHtmlEditingFieldOverride(view, draft, visibility);
  const body = prepareHtmlEditingBatchCommand(view, draft);
  assert.ok(body.action === "COMMAND"); assert.deepEqual(body.overrides, [visibility, attribute]);
  assert.equal(body.expectedCompositionDocumentHash, view.compositionDocumentHash); assert.equal(view.state.overrides.length, 0);
  for (const attributeName of ["onclick", "style", "src", "title"])
    assert.throws(() => prepareHtmlEditingFieldCommand(view, { ...attribute, attributeName }));
  assert.throws(() => prepareHtmlEditingFieldCommand(view, { ...visibility, visible: "false" }));
  assert.doesNotThrow(() => prepareHtmlEditingFieldCommand(view, { operation: "RESET", elementId: "panel", property: "ALL" }));
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
