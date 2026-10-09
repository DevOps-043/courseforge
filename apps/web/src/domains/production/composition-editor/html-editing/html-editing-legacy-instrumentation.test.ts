import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { HTML_EDITING_LIMITS } from "./html-editing.contract";
import { prepareLegacyHtmlEditingPilot } from "./html-editing-legacy-instrumentation.server";
import { prepareInitialHtmlEditingRevision } from "./html-editing-bootstrap.server";
import { prepareHtmlEditingRevisionCommand, prepareHtmlEditingRevisionRestore } from "./html-editing-revision.server";

const assetId = "11111111-1111-4111-8111-111111111111";
const defaults = {
  templateId: "legacy_intro", templateVersion: 1,
  authoritativeAnchor: { organizationId: assetId, documentId: assetId, revisionId: assetId,
    documentSha256: "a".repeat(64), clipId: "intro" },
  grantedAssetIds: [] as string[], imageSources: new Map<string, string>(),
};
const prepare = (sourceHtml: string) => prepareLegacyHtmlEditingPilot({ ...defaults, sourceHtml });

test("legacy pilot preserves exact rollback source and produces deterministic review-only candidate", () => {
  const source = '<section id="intro"><h1>Hola 🧭</h1><p>Texto</p></section>';
  const result = prepare(source);
  assert.deepEqual(result, prepare(source));
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.deepEqual(result.original, { sourceHtml: source,
    sha256: createHash("sha256").update(source).digest("hex") });
  assert.notEqual(result.original.sha256, result.candidate.sha256);
  assert.equal(result.candidate.targets.length, 2);
  assert.deepEqual(result.requiredReviews, ["VISUAL_COMPARISON", "MANIFEST_AND_ACCESSIBILITY", "AUTHORIZED_INSTALLATION"]);
  const dom = load(result.candidate.sourceHtml);
  for (const target of result.candidate.targets) {
    assert.equal(dom(`#${target.elementId}`).attr("data-courseforge-editable-id"), target.elementId);
    assert.ok(target.semanticPath[0].includes('"intro"'));
  }
});

test("semantic paths survive unrelated siblings and separate equivalent anonymous siblings", () => {
  const before = prepare('<section><h1>Title</h1><p>One</p><p>Two</p></section>');
  const after = prepare('<section><div></div><h1>Title</h1><p>One</p><p>Two</p></section>');
  assert.deepEqual(before.candidate.targets, after.candidate.targets);
  assert.equal(new Set(before.candidate.targets.map(target => target.elementId)).size, 3);
  const otherTemplate = prepareLegacyHtmlEditingPilot({ ...defaults, templateId: "other",
    sourceHtml: '<section><h1>Title</h1><p>One</p><p>Two</p></section>' });
  assert.notEqual(before.candidate.targets[0].elementId, otherTemplate.candidate.targets[0].elementId);
});

test("existing semantic IDs and DOM subtrees are retained, not flattened or renamed", () => {
  const result = prepare('<section id="root"><p id="paragraph">Before <strong id="emphasis">Bold</strong> after</p><h1 id="title">Title</h1></section>');
  assert.deepEqual(result.candidate.targets.map(target => target.elementId), ["emphasis", "title"]);
  assert.ok(result.candidate.targets.every(target => target.retainedId));
  const dom = load(result.candidate.sourceHtml);
  assert.equal(dom("#paragraph").text(), "Before Bold after");
  assert.equal(dom("#paragraph > #emphasis").length, 1);
  assert.equal(dom("#paragraph").attr("data-courseforge-editable-id"), undefined);
  for (const source of ['<p id="bad.id">Text</p>', '<p id="same">A</p><p id="same">B</p>',
    '<p id="title" data-courseforge-editable-id="title">Text</p>']) assert.throws(() => prepare(source), /INVALID_SOURCE/);
});

test("images require independently supplied exact local identity and current grants", () => {
  const sourceHtml = `<figure><img src="conformance-media/${assetId}" alt="Original"></figure>`;
  assert.throws(() => prepare(sourceHtml), /ASSET_SOURCE_MISSING/);
  const imageSources = new Map([[assetId, `conformance-media/${assetId}`]]);
  assert.throws(() => prepareLegacyHtmlEditingPilot({ ...defaults, sourceHtml, imageSources }), /INVALID_SOURCE/);
  const result = prepareLegacyHtmlEditingPilot({ ...defaults, sourceHtml, imageSources, grantedAssetIds: [assetId] });
  assert.deepEqual(result.candidate.template.elements[0], { kind: "IMAGE",
    elementId: result.candidate.targets[0].elementId, label: "img 1", allowedAssetIds: [assetId], allowedFits: ["CONTAIN", "COVER"] });
  assert.equal(load(result.candidate.sourceHtml)("img").attr("alt"), "Original");
});

test("instrumentation rejects active content and foreign resources, never laundering it into a template", () => {
  for (const source of ['<p onclick="secret()">Text</p>', '<p>Text</p><script>secret()</script>',
    '<p>Text</p><iframe src="https://foreign.invalid"></iframe>', '<p style="background:url(https://foreign.invalid)">Text</p>',
    '<svg><foreignObject><p>Text</p></foreignObject></svg>', '<p style="animation:spin 1s">Text</p>']) {
    assert.throws(() => prepare(source));
  }
  assert.throws(() => prepare('<section></section>'), /INVALID_MANIFEST/);
  assert.throws(() => prepareLegacyHtmlEditingPilot({ ...defaults, templateId: "../secret", sourceHtml: "<p>Text</p>" }), /INVALID_MANIFEST/);
});

test("inventory complexity and generated source use shared limits without truncating targets", () => {
  assert.throws(() => prepare("<p>Text</p>".repeat(HTML_EDITING_LIMITS.elements + 1)), /PAYLOAD_LIMIT/);
  assert.throws(() => prepare("x".repeat(HTML_EDITING_LIMITS.sourceBytes + 1)), /PAYLOAD_LIMIT/);
  const atLimit = prepare("<p>Text</p>".repeat(HTML_EDITING_LIMITS.elements));
  assert.equal(atLimit.candidate.template.elements.length, HTML_EDITING_LIMITS.elements);
  assert.throws(() => prepare(`<p>${"a".repeat(HTML_EDITING_LIMITS.textCharacters + 1)}</p>`));
});

test("review candidate uses existing bootstrap, command and exact undo output without mutating original", () => {
  const pilot = prepare("<section><h1>Original</h1></section>");
  const authority = { grantedAssetIds: defaults.grantedAssetIds, imageSources: defaults.imageSources };
  const initial = prepareInitialHtmlEditingRevision({ ...authority, authoritativeAnchor: defaults.authoritativeAnchor,
    sourceHtml: pilot.candidate.sourceHtml, encodedTrustedTemplate: JSON.stringify(pilot.candidate.template) });
  const binding = initial.revision.manifest.binding;
  const changed = prepareHtmlEditingRevisionCommand({ ...authority, authoritativeBinding: binding,
    encodedRevision: JSON.stringify(initial.revision), expected: { version: 1, sha256: initial.sha256 },
    encodedCommand: JSON.stringify({ format: "courseforge-html-editable-command-v1", binding,
      overrides: [{ operation: "SET_TEXT", elementId: pilot.candidate.targets[0].elementId, value: "Changed" }] }) });
  assert.equal(load(changed.next.compiled.html)("h1").text(), "Changed");
  const restored = prepareHtmlEditingRevisionRestore({ ...authority, authoritativeBinding: binding,
    encodedRevision: JSON.stringify(changed.next.revision), expected: { version: 2, sha256: changed.next.sha256 },
    encodedRestoreRevision: JSON.stringify(initial.revision) });
  assert.equal(restored.next.compiled.html, initial.compiled.html);
  assert.equal(restored.next.revision.version, 3);
  assert.equal(pilot.original.sourceHtml, "<section><h1>Original</h1></section>");
});
