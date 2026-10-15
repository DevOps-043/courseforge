import assert from "node:assert/strict";
import test from "node:test";
import { load } from "cheerio";
import { applyHtmlEditingSlotOrder, readHtmlEditingSlotDefaults } from "./html-editing-slots.server";
import { htmlEditingSlotsElementSchema } from "./html-editing.contract";
import { createHash } from "node:crypto";
import type { HtmlEditableManifest } from "./html-editing.contract";
import type { HtmlEditingRevision } from "./html-editing-revision.contract";
import { computeHtmlEditableManifestSha256 } from "./html-editing-manifest-digest.server";
import { prepareHtmlEditingRevisionCommand, prepareHtmlEditingRevisionRestore, verifyHtmlEditingRevision } from "./html-editing-revision.server";

function revisionFixture() {
  const uuid = "11111111-1111-4111-8111-111111111111";
  const binding = { organizationId: uuid, documentId: uuid, revisionId: uuid, documentSha256: "a".repeat(64), clipId: "intro",
    templateId: "list-template", templateVersion: 1, sourceSha256: createHash("sha256").update(source).digest("hex"), manifestSha256: "0".repeat(64) };
  const manifest: HtmlEditableManifest = { format: "courseforge-html-editable-manifest-v1", binding, elements: [declaration,
    { kind: "TEXT", elementId: "second", label: "Second", maxCharacters: 100, multiline: false }] };
  binding.manifestSha256 = computeHtmlEditableManifestSha256(JSON.stringify(manifest), binding);
  const revision: HtmlEditingRevision = { format: "courseforge-html-editable-revision-v1", version: 1, sourceHtml: source, manifest,
    state: { format: "courseforge-html-editable-override-state-v1", binding, overrides: [] } };
  const authority = { authoritativeBinding: binding, grantedAssetIds: [] as string[], imageSources: new Map<string, string>() };
  const original = verifyHtmlEditingRevision({ ...authority, encodedRevision: JSON.stringify(revision) });
  const command = (overrides: unknown[]) => JSON.stringify({ format: "courseforge-html-editable-command-v1", binding, overrides });
  return { authority, original, command };
}

test("slots and child text compile together; reset and history preserve source at forward versions", () => {
  const fixture = revisionFixture();
  const move = { operation: "SET_SLOT_ORDER", elementId: "list", itemIds: ["second", "first"] };
  const text = { operation: "SET_TEXT", elementId: "second", value: "Updated" };
  const prepare = (overrides: unknown[]) => prepareHtmlEditingRevisionCommand({ ...fixture.authority,
    encodedRevision: JSON.stringify(fixture.original.revision), expected: { version: 1, sha256: fixture.original.sha256 },
    encodedCommand: fixture.command(overrides) });
  const changed = prepare([move, text]);
  assert.equal(changed.next.compiled.html, prepare([text, move]).next.compiled.html);
  const dom = load(changed.next.compiled.html);
  assert.deepEqual(dom("#list").children().toArray().map(node => node.attribs.id), ["second", "first"]);
  assert.equal(dom("#second").text(), "Updated");
  assert.equal(changed.next.revision.sourceHtml, source);
  const noOp = prepare([{ ...move, itemIds: declaration.itemIds }]);
  assert.equal(noOp.changed, false); assert.equal(noOp.next.sha256, fixture.original.sha256);
  const reset = prepareHtmlEditingRevisionCommand({ ...fixture.authority,
    encodedRevision: JSON.stringify(changed.next.revision), expected: { version: 2, sha256: changed.next.sha256 },
    encodedCommand: fixture.command([{ operation: "RESET", elementId: "list", property: "ALL" }, { operation: "RESET", elementId: "second", property: "TEXT" }]) });
  assert.equal(reset.next.revision.version, 3); assert.equal(reset.next.compiled.html, fixture.original.compiled.html);
  const undo = prepareHtmlEditingRevisionRestore({ ...fixture.authority,
    encodedRevision: JSON.stringify(changed.next.revision), expected: { version: 2, sha256: changed.next.sha256 },
    encodedRestoreRevision: JSON.stringify(fixture.original.revision) });
  const redo = prepareHtmlEditingRevisionRestore({ ...fixture.authority,
    encodedRevision: JSON.stringify(undo.next.revision), expected: { version: 3, sha256: undo.next.sha256 },
    encodedRestoreRevision: JSON.stringify(changed.next.revision) });
  assert.equal(undo.next.compiled.html, fixture.original.compiled.html);
  assert.equal(redo.next.compiled.html, changed.next.compiled.html); assert.equal(redo.next.revision.version, 4);
});

const declaration = htmlEditingSlotsElementSchema.parse({ kind: "SLOTS", elementId: "list", label: "List", itemIds: ["first", "second"] });
const source = '<ul id="list">start<!--anchor--><li id="first"><span>One</span></li>between<li id="second">Two</li>end</ul>';

test("slot reordering moves existing subtrees and preserves non-element anchors", () => {
  const dom = load(source), parent = dom("#list");
  const first = dom("#first")[0], second = dom("#second")[0], span = dom("#first span")[0];
  const anchors = parent.contents().toArray().filter(node => node.type === "text" || node.type === "comment");
  assert.deepEqual(readHtmlEditingSlotDefaults(parent, declaration), declaration.itemIds);
  applyHtmlEditingSlotOrder(parent, declaration, ["second", "first"]);
  assert.deepEqual(parent.children().toArray(), [second, first]);
  assert.equal(dom("#first span")[0], span);
  assert.deepEqual(parent.contents().toArray().filter(node => node.type === "text" || node.type === "comment"), anchors);
  assert.equal(parent.html(), 'start<!--anchor--><li id="second">Two</li>between<li id="first"><span>One</span></li>end');
  applyHtmlEditingSlotOrder(parent, declaration, declaration.itemIds);
  assert.equal(dom("#list").prop("outerHTML"), source);
});

test("slot operations reject foreign, duplicate or incomplete membership before mutation", () => {
  for (const order of [["first"], ["first", "first"], ["first", "outside"], ["first", "second", "outside"]]) {
    const dom = load(source), before = dom.html();
    assert.throws(() => applyHtmlEditingSlotOrder(dom("#list"), declaration, order));
    assert.equal(dom.html(), before);
  }
});

test("source membership requires exact immediate children and original order", () => {
  for (const html of [
    '<ul id="list"><li id="second"></li><li id="first"></li></ul>',
    '<ul id="list"><li id="first"><span id="second"></span></li></ul>',
    '<ul id="list"><li id="first"></li><li id="second"></li><li id="extra"></li></ul>',
    '<ul id="list"><li id="first"></li><li></li></ul>',
  ]) assert.throws(() => readHtmlEditingSlotDefaults(load(html)("#list"), declaration));
});

test("nested slot lists retain identity through parent and child reordering", () => {
  const dom = load('<div id="list"><section id="first"><b id="a">A</b><b id="b">B</b></section><section id="second">Two</section></div>');
  const inner = dom("#first"), innerDeclaration = htmlEditingSlotsElementSchema.parse({ kind: "SLOTS", elementId: "first", label: "Inner", itemIds: ["a", "b"] });
  applyHtmlEditingSlotOrder(dom("#list"), declaration, ["second", "first"]);
  applyHtmlEditingSlotOrder(inner, innerDeclaration, ["b", "a"]);
  assert.deepEqual(dom("#list").children().toArray().map(node => node.attribs.id), ["second", "first"]);
  assert.deepEqual(dom("#first").children().toArray().map(node => node.attribs.id), ["b", "a"]);
});
