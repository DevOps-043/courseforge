import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { htmlEditingStyleRangeSchema, isHtmlEditingStyleRangeValue, HTML_EDITING_STYLE_RANGE_POLICY } from "./html-editing-style-range.contract";
import type { HtmlEditableManifest } from "./html-editing.contract";
import { computeHtmlEditableManifestSha256 } from "./html-editing-manifest-digest.server";
import type { HtmlEditingRevision } from "./html-editing-revision.contract";
import { prepareHtmlEditingRevisionCommand, prepareHtmlEditingRevisionRestore, verifyHtmlEditingRevision } from "./html-editing-revision.server";
import { createHtmlEditingInspectorView } from "./html-editing-inspector.server";

function fixture(sourceHtml = '<p id="title" style="font-size:24px">Original</p>') {
  const uuid = "11111111-1111-4111-8111-111111111111";
  const binding = { organizationId: uuid, documentId: uuid, revisionId: uuid, documentSha256: "a".repeat(64), clipId: "intro",
    templateId: "type-template", templateVersion: 1, sourceSha256: createHash("sha256").update(sourceHtml).digest("hex"), manifestSha256: "0".repeat(64) };
  const manifest: HtmlEditableManifest = { format: "courseforge-html-editable-manifest-v1", binding, elements: [
    { kind: "RANGE_TOKEN", elementId: "title", label: "Font size", tokenId: "title-size",
      range: { property: "FONT_SIZE", minimum: 16, maximum: 48, step: 2, defaultValue: 24 } } ] };
  binding.manifestSha256 = computeHtmlEditableManifestSha256(JSON.stringify(manifest), binding);
  const revision: HtmlEditingRevision = { format: "courseforge-html-editable-revision-v1", version: 1, sourceHtml, manifest,
    state: { format: "courseforge-html-editable-override-state-v1", binding, overrides: [] } };
  const authority = { authoritativeBinding: binding, grantedAssetIds: [] as string[], imageSources: new Map<string, string>() };
  const original = verifyHtmlEditingRevision({ ...authority, encodedRevision: JSON.stringify(revision) });
  const command = (overrides: unknown[]) => JSON.stringify({ format: "courseforge-html-editable-command-v1", binding, overrides });
  const prepare = (value: unknown, tokenId = "title-size") => prepareHtmlEditingRevisionCommand({ ...authority,
    encodedRevision: JSON.stringify(revision), expected: { version: 1, sha256: original.sha256 },
    encodedCommand: command([{ operation: "SET_STYLE_RANGE", elementId: "title", tokenId, value }]) });
  return { authority, original, prepare, command };
}

test("numeric style tokens compile one declared property without changing source", () => {
  const f = fixture(), changed = f.prepare(36);
  const dom = load(changed.next.compiled.html);
  assert.equal(dom("#title").css("font-size"), "36px !important");
  assert.equal(dom("#title").attr("data-courseforge-style-token"), "title-size");
  assert.equal(dom("#title").text(), "Original"); assert.equal(changed.next.revision.sourceHtml, f.original.revision.sourceHtml);
  const view = createHtmlEditingInspectorView({ ...f.authority, encodedRevision: JSON.stringify(changed.next.revision), compositionDocumentHash: "a".repeat(64) });
  assert.deepEqual(view.defaults[0], { kind: "RANGE_TOKEN", elementId: "title", value: 24 });
});

test("range original is no-op; RESET ALL and undo/redo reconstruct exact output at forward versions", () => {
  const f = fixture(), changed = f.prepare(36), noOp = f.prepare(24);
  assert.equal(noOp.changed, false); assert.equal(noOp.next.sha256, f.original.sha256);
  const reset = prepareHtmlEditingRevisionCommand({ ...f.authority, encodedRevision: JSON.stringify(changed.next.revision),
    expected: { version: 2, sha256: changed.next.sha256 }, encodedCommand: f.command([{ operation: "RESET", elementId: "title", property: "ALL" }]) });
  assert.equal(reset.next.compiled.html, f.original.compiled.html); assert.equal(reset.next.revision.version, 3);
  const undo = prepareHtmlEditingRevisionRestore({ ...f.authority, encodedRevision: JSON.stringify(changed.next.revision),
    expected: { version: 2, sha256: changed.next.sha256 }, encodedRestoreRevision: JSON.stringify(f.original.revision) });
  const redo = prepareHtmlEditingRevisionRestore({ ...f.authority, encodedRevision: JSON.stringify(undo.next.revision),
    expected: { version: 3, sha256: undo.next.sha256 }, encodedRestoreRevision: JSON.stringify(changed.next.revision) });
  assert.equal(undo.next.compiled.html, f.original.compiled.html); assert.equal(redo.next.compiled.html, changed.next.compiled.html);
  assert.equal(redo.next.revision.version, 4);
});

test("range commands never coerce, clamp, change token or admit free CSS", () => {
  const f = fixture();
  for (const value of [15, 49, 25, "36", "36px", "url(https://bad)", null, NaN, Infinity]) assert.throws(() => f.prepare(value));
  assert.throws(() => f.prepare(36, "another-token"));
  assert.throws(() => fixture('<p id="title" style="font-size:25px">Original</p>'));
  assert.throws(() => fixture('<p id="title" style="font-size:var(--size)">Original</p>'));
  assert.throws(() => fixture('<p id="title" data-courseforge-style-token="other" style="font-size:24px">Original</p>'));
});

test("range declarations are bounded, aligned and closed across all supported properties", () => {
  for (const [property, limits] of Object.entries(HTML_EDITING_STYLE_RANGE_POLICY)) {
    const range = { property, minimum: limits.minimum, maximum: limits.maximum, step: limits.maximum - limits.minimum, defaultValue: limits.minimum };
    assert.equal(htmlEditingStyleRangeSchema.safeParse(range).success, true);
    assert.equal(htmlEditingStyleRangeSchema.safeParse({ ...range, minimum: limits.minimum - 1 }).success, false);
    assert.equal(htmlEditingStyleRangeSchema.safeParse({ ...range, maximum: limits.maximum + 1 }).success, false);
    assert.equal(htmlEditingStyleRangeSchema.safeParse({ ...range, cssProperty: "background-image" }).success, false);
  }
  for (const step of [0, -1, NaN, Infinity, 1e-12]) assert.equal(htmlEditingStyleRangeSchema.safeParse({ property: "OPACITY", minimum: 0, maximum: 1, step, defaultValue: 0 }).success, false);
  assert.equal(htmlEditingStyleRangeSchema.safeParse({ property: "TRANSFORM", minimum: 0, maximum: 1, step: 0.1, defaultValue: 0 }).success, false);
  assert.equal(isHtmlEditingStyleRangeValue({ minimum: 0, maximum: 1, step: 0.1 }, 0.3), true);
  assert.equal(isHtmlEditingStyleRangeValue({ minimum: 0, maximum: 1, step: 0.1 }, 0.31), false);
});
