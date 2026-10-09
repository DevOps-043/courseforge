import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { prepareInitialHtmlEditingRevision } from "./html-editing-bootstrap.server";
import { prepareHtmlEditingRevisionCommand, prepareHtmlEditingRevisionRestore } from "./html-editing-revision.server";
import { createHtmlEditingInspectorView } from "./html-editing-inspector.server";
import type { HtmlEditableManifest } from "./html-editing.contract";

const uuid = "11111111-1111-4111-8111-111111111111";
const sourceHtml = '<h1 id="heading" style="font-size:24px;opacity:1;display:block">Original</h1>';
const elements: HtmlEditableManifest["elements"] = [
  { kind: "TEXT", elementId: "title", targetElementId: "heading", label: "Text", maxCharacters: 100, multiline: true },
  { kind: "RANGE_TOKEN", elementId: "size", targetElementId: "heading", label: "Size", tokenId: "FontSize",
    range: { property: "FONT_SIZE", minimum: 8, maximum: 144, step: 1, defaultValue: 24 } },
  { kind: "RANGE_TOKEN", elementId: "alpha", targetElementId: "heading", label: "Opacity", tokenId: "Alpha",
    range: { property: "OPACITY", minimum: 0, maximum: 1, step: .1, defaultValue: 1 } },
  { kind: "ATTRIBUTE", elementId: "tooltip", targetElementId: "heading", label: "Tooltip", attributeName: "title", maxCharacters: 100 },
  { kind: "VISIBILITY", elementId: "shown", targetElementId: "heading", label: "Visibility", visibleDisplay: "BLOCK" },
];
function initial(fields = elements) {
  return prepareInitialHtmlEditingRevision({ sourceHtml,
    authoritativeAnchor: { organizationId: uuid, documentId: uuid, revisionId: uuid, documentSha256: "a".repeat(64), clipId: "slide" },
    encodedTrustedTemplate: JSON.stringify({ format: "courseforge-html-editable-template-v1", templateId: "multi", templateVersion: 1,
      sourceSha256: createHash("sha256").update(sourceHtml).digest("hex"), elements: fields }),
    grantedAssetIds: [], imageSources: new Map(),
  });
}
function edit(revision: ReturnType<typeof initial>, overrides: unknown[]) {
  return prepareHtmlEditingRevisionCommand({ authoritativeBinding: revision.revision.manifest.binding,
    grantedAssetIds: [], imageSources: new Map(), encodedRevision: JSON.stringify(revision.revision),
    expected: { version: revision.revision.version, sha256: revision.sha256 },
    encodedCommand: JSON.stringify({ format: "courseforge-html-editable-command-v1", binding: revision.revision.manifest.binding, overrides }) }).next;
}

test("several declared properties share one DOM target without overwriting independent field state", () => {
  const first = initial();
  const changed = edit(first, [{ operation: "SET_TEXT", elementId: "title", value: "Changed" },
    { operation: "SET_STYLE_RANGE", elementId: "size", tokenId: "FontSize", value: 48 },
    { operation: "SET_STYLE_RANGE", elementId: "alpha", tokenId: "Alpha", value: .5 },
    { operation: "SET_ATTRIBUTE", elementId: "tooltip", attributeName: "title", value: "Hint" }]);
  const dom = load(changed.compiled.html);
  assert.equal(dom("#heading").text(), "Changed");
  assert.equal(dom("#heading").css("font-size"), "48px !important");
  assert.equal(dom("#heading").css("opacity"), "0.5 !important");
  assert.equal(dom("#heading").attr("title"), "Hint");
  assert.equal(dom("#heading").attr("data-courseforge-editable-id"), "heading");
  assert.equal(dom("[data-courseforge-editable-id]").length, 1);
  assert.equal(changed.revision.state.overrides.length, 4);
  assert.equal(changed.revision.sourceHtml, sourceHtml);
  const reset = edit(changed, [{ operation: "RESET", elementId: "size", property: "RANGE_TOKEN" }]);
  assert.equal(load(reset.compiled.html)("#heading").css("font-size"), "24px");
  assert.equal(load(reset.compiled.html)("#heading").text(), "Changed");
  assert.equal(load(reset.compiled.html)("#heading").attr("title"), "Hint");
  const hidden = edit(reset, [{ operation: "SET_VISIBILITY", elementId: "shown", visible: false }]);
  assert.equal(load(hidden.compiled.html)("#heading").css("display"), "none !important");
  assert.equal(load(hidden.compiled.html)("#heading").text(), "Changed");
});

test("inspector defaults remain keyed by field and exact undo restores the complete multi-property output", () => {
  const first = initial();
  const changed = edit(first, [{ operation: "SET_TEXT", elementId: "title", value: "Changed" }]);
  const authority = { authoritativeBinding: first.revision.manifest.binding, grantedAssetIds: [], imageSources: new Map<string, string>() };
  const view = createHtmlEditingInspectorView({ ...authority, encodedRevision: JSON.stringify(changed.revision), compositionDocumentHash: "a".repeat(64) });
  assert.deepEqual(view.defaults.map(field => field.elementId), elements.map(field => field.elementId));
  const textDefault = view.defaults.find(field => field.kind === "TEXT");
  assert.ok(textDefault?.kind === "TEXT");
  assert.equal(textDefault.value, "Original");
  const restored = prepareHtmlEditingRevisionRestore({ ...authority, encodedRevision: JSON.stringify(changed.revision),
    expected: { version: changed.revision.version, sha256: changed.sha256 }, encodedRestoreRevision: JSON.stringify(first.revision) }).next;
  assert.equal(restored.compiled.html, first.compiled.html);
  assert.equal(restored.revision.version, 3);
});

test("ambiguous writes to the same physical property reject at manifest admission", () => {
  for (const duplicate of [elements[0], elements[1], elements[3]]) {
    assert.throws(() => initial([...elements, { ...duplicate, elementId: "otherField" }]), /INVALID_MANIFEST/);
  }
  const locale = { allowedLocales: [{ language: "es-MX", direction: "ltr" as const }], defaultLocale: { language: "es-MX", direction: "ltr" as const } };
  assert.throws(() => initial([{ kind: "TEXT", elementId: "title", targetElementId: "heading", label: "Text",
    maxCharacters: 100, multiline: true, localePolicy: locale },
    { kind: "ATTRIBUTE", elementId: "language", targetElementId: "heading", label: "Language", attributeName: "lang", maxCharacters: 10 }]), /INVALID_MANIFEST/);
});

test("undeclared field, missing target and client-provided target never become arbitrary DOM access", () => {
  const first = initial();
  assert.throws(() => edit(first, [{ operation: "SET_TEXT", elementId: "heading", value: "Changed" }]), /UNKNOWN_ELEMENT/);
  assert.throws(() => edit(first, [{ operation: "SET_TEXT", elementId: "title", targetElementId: "foreign", value: "Changed" }]), /INVALID_COMMAND/);
  assert.throws(() => initial([{ ...elements[0], targetElementId: "missing" }]), /UNKNOWN_ELEMENT/);
});

test("one ordinary reset batch restores every declared property of a multi-field node atomically", () => {
  const first = initial();
  const changed = edit(first, [{ operation: "SET_TEXT", elementId: "title", value: "Changed" },
    { operation: "SET_STYLE_RANGE", elementId: "size", tokenId: "FontSize", value: 48 },
    { operation: "SET_ATTRIBUTE", elementId: "tooltip", attributeName: "title", value: "Hint" },
    { operation: "SET_VISIBILITY", elementId: "shown", visible: false }]);
  const reset = edit(changed, elements.map(field => ({ operation: "RESET", elementId: field.elementId, property: field.kind })));
  assert.deepEqual(reset.revision.state.overrides, []);
  assert.equal(reset.compiled.html, first.compiled.html);
  assert.equal(reset.revision.sourceHtml, sourceHtml);
  assert.equal(reset.revision.version, 3);
  assert.throws(() => edit(changed, [...elements.map(field => ({ operation: "RESET", elementId: field.elementId, property: field.kind })),
    { operation: "RESET", elementId: "foreign", property: "ALL" }]), /UNKNOWN_ELEMENT/);
  assert.equal(load(changed.compiled.html)("#heading").text(), "Changed");
});
