import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { load } from "cheerio";
import { htmlEditableManifestSchema, type HtmlEditableManifest } from "./html-editing.contract";
import { computeHtmlEditableManifestSha256 } from "./html-editing-manifest-digest.server";
import { prepareHtmlEditingRevisionCommand, prepareHtmlEditingRevisionRestore, verifyHtmlEditingRevision } from "./html-editing-revision.server";
import type { HtmlEditingRevision } from "./html-editing-revision.contract";
import { validateHtmlEditingCommand } from "./html-editing-validation";
import { createHtmlEditingInspectorView } from "./html-editing-inspector.server";
import { htmlEditingInspectorViewSchema } from "./html-editing-inspector.contract";
import { HtmlEditingRevisionGateway, type HtmlEditingRevisionRepository } from "./html-editing-revision-gateway.server";

const uuid = "11111111-1111-4111-8111-111111111111";
function fixture(sourceHtml = '<section id="panel" style="display:flex"><p id="label" aria-label="Original">Content</p></section>', enumerated = true) {
  const binding = { organizationId: uuid, documentId: uuid, revisionId: uuid, documentSha256: "a".repeat(64), clipId: "intro",
    templateId: "accessible", templateVersion: 2, sourceSha256: createHash("sha256").update(sourceHtml).digest("hex"), manifestSha256: "0".repeat(64) };
  const manifest: HtmlEditableManifest = { format: "courseforge-html-editable-manifest-v1", binding, elements: [
    { kind: "VISIBILITY", elementId: "panel", label: "Panel", visibleDisplay: "FLEX" },
    { kind: "ATTRIBUTE", elementId: "label", label: "Accessible name", attributeName: "aria-label",
      maxCharacters: 100, ...(enumerated ? { allowedValues: ["Original", "Updated", "Español 🧭"] } : {}) },
  ] };
  binding.manifestSha256 = computeHtmlEditableManifestSha256(JSON.stringify(manifest), binding);
  const revision: HtmlEditingRevision = { format: "courseforge-html-editable-revision-v1", version: 1, sourceHtml, manifest,
    state: { format: "courseforge-html-editable-override-state-v1", binding, overrides: [] } };
  const authority = { authoritativeBinding: binding, grantedAssetIds: [] as string[], imageSources: new Map<string, string>(),
    encodedRevision: JSON.stringify(revision) };
  const verified = verifyHtmlEditingRevision(authority);
  const command = (overrides: unknown[]) => JSON.stringify({ format: "courseforge-html-editable-command-v1", binding, overrides });
  const prepare = (overrides: unknown[]) => prepareHtmlEditingRevisionCommand({ ...authority,
    expected: { version: 1, sha256: verified.sha256 }, encodedCommand: command(overrides) });
  return { binding, manifest, revision, authority, verified, command, prepare };
}

test("declared attributes and visibility compile in a single forward revision without changing source", () => {
  const f = fixture(), before = f.authority.encodedRevision;
  const changed = f.prepare([{ operation: "SET_ATTRIBUTE", elementId: "label", attributeName: "aria-label", value: "Updated" },
    { operation: "SET_VISIBILITY", elementId: "panel", visible: false }]);
  const dom = load(changed.next.compiled.html);
  assert.equal(dom("#label").attr("aria-label"), "Updated");
  assert.notEqual(dom("#panel").attr("hidden"), undefined); assert.equal(dom("#panel").attr("aria-hidden"), "true");
  assert.equal(dom("#panel").css("display"), "none !important");
  assert.equal(changed.next.revision.version, 2); assert.equal(changed.next.revision.sourceHtml, f.revision.sourceHtml);
  assert.equal(f.authority.encodedRevision, before); assert.deepEqual(changed.next.compiled.usedAssetIds, []);
});

test("visibility shows at declared display and removes hidden; it never deletes child content", () => {
  const f = fixture('<section id="panel" hidden style="display:none"><p id="label" aria-label="Original">Content</p></section>');
  const changed = f.prepare([{ operation: "SET_VISIBILITY", elementId: "panel", visible: true }]);
  const dom = load(changed.next.compiled.html);
  assert.equal(dom("#panel").attr("hidden"), undefined); assert.equal(dom("#panel").attr("aria-hidden"), "false");
  assert.equal(dom("#panel").css("display"), "flex !important"); assert.equal(dom("#label").text(), "Content");
});

test("reset and historical restore retain exact original attribute/visibility output at forward versions", () => {
  const f = fixture(); const changed = f.prepare([{ operation: "SET_VISIBILITY", elementId: "panel", visible: false },
    { operation: "SET_ATTRIBUTE", elementId: "label", attributeName: "aria-label", value: "Updated" }]);
  const reset = prepareHtmlEditingRevisionCommand({ ...f.authority, encodedRevision: JSON.stringify(changed.next.revision),
    expected: { version: 2, sha256: changed.next.sha256 }, encodedCommand: f.command([
      { operation: "RESET", elementId: "panel", property: "ALL" }, { operation: "RESET", elementId: "label", property: "ALL" }]) });
  assert.equal(reset.next.compiled.html, f.verified.compiled.html); assert.equal(reset.next.revision.version, 3);
  const undo = prepareHtmlEditingRevisionRestore({ ...f.authority, encodedRevision: JSON.stringify(changed.next.revision),
    expected: { version: 2, sha256: changed.next.sha256 }, encodedRestoreRevision: f.authority.encodedRevision });
  assert.equal(undo.next.compiled.html, f.verified.compiled.html); assert.equal(undo.next.revision.version, 3);
  const redo = prepareHtmlEditingRevisionRestore({ ...f.authority, encodedRevision: JSON.stringify(undo.next.revision),
    expected: { version: 3, sha256: undo.next.sha256 }, encodedRestoreRevision: JSON.stringify(changed.next.revision) });
  assert.equal(redo.next.compiled.html, changed.next.compiled.html); assert.equal(redo.next.revision.version, 4);
});

test("attributes cannot target handlers, styles, URLs, identity or undeclared values", () => {
  const f = fixture();
  for (const attributeName of ["onclick", "style", "src", "href", "id", "data-hf-id", "aria-hidden", "title"]) {
    assert.throws(() => f.prepare([{ operation: "SET_ATTRIBUTE", elementId: "label", attributeName, value: "Updated" }]));
  }
  for (const value of ["arbitrary", "<script>", "Updated\n", "x".repeat(101)])
    assert.throws(() => f.prepare([{ operation: "SET_ATTRIBUTE", elementId: "label", attributeName: "aria-label", value }]));
  for (const attributeName of ["style", "src", "href", "onerror", "id", "data-courseforge-editable-id"])
    assert.equal(htmlEditableManifestSchema.safeParse({ ...f.manifest, elements: [{ ...f.manifest.elements[1], attributeName }] }).success, false);
});

test("declared plain-text attributes allow useful free editing but never markup, controls or oversized input", () => {
  const f = fixture(undefined, false);
  const value = 'Nombre accesible & "Unicode 🧭"';
  const changed = f.prepare([{ operation: "SET_ATTRIBUTE", elementId: "label", attributeName: "aria-label", value }]);
  assert.equal(load(changed.next.compiled.html)("#label").attr("aria-label"), value);
  for (const invalid of ["<script>", "line\nbreak", "control\u0000", "x".repeat(101)]) {
    assert.throws(() => f.prepare([{ operation: "SET_ATTRIBUTE", elementId: "label", attributeName: "aria-label", value: invalid }]));
  }
  assert.doesNotThrow(() => f.prepare([{ operation: "SET_ATTRIBUTE", elementId: "label", attributeName: "aria-label", value: "" }]));
});

test("wrong field kind, duplicate updates, malformed boolean and stale bindings cannot partially apply", () => {
  const f = fixture();
  for (const overrides of [
    [{ operation: "SET_VISIBILITY", elementId: "label", visible: false }],
    [{ operation: "SET_VISIBILITY", elementId: "panel", visible: "false" }],
    [{ operation: "SET_VISIBILITY", elementId: "panel", visible: false }, { operation: "SET_VISIBILITY", elementId: "panel", visible: true }],
    [{ operation: "RESET", elementId: "panel", property: "ALL" }, { operation: "SET_VISIBILITY", elementId: "panel", visible: true }],
    [{ operation: "SET_VISIBILITY", elementId: "panel", visible: false }, { operation: "SET_ATTRIBUTE", elementId: "label", attributeName: "title", value: "Updated" }],
  ]) assert.throws(() => f.prepare(overrides));
  assert.throws(() => validateHtmlEditingCommand({ manifest: f.manifest, verifiedBinding: { ...f.binding, sourceSha256: "b".repeat(64) },
    grantedAssetIds: [], encodedCommand: f.command([{ operation: "SET_VISIBILITY", elementId: "panel", visible: false }]) }));
  assert.deepEqual(f.revision.state.overrides, []);
});

test("visibility defaults require explicit compatible display and refuse ambiguous or variable layout", () => {
  for (const style of ["", "display:block", "display:var(--display)", "visibility:hidden"]) {
    assert.throws(() => fixture(`<section id="panel" style="${style}"><p id="label" aria-label="Original">Content</p></section>`));
  }
  assert.throws(() => fixture('<section id="panel" hidden style="display:flex"><p id="label" aria-label="Original">Content</p></section>'));
});

test("inspector returns inert typed attribute and visibility defaults and rejects forged metadata", () => {
  const f = fixture(); const view = createHtmlEditingInspectorView({ ...f.authority, compositionDocumentHash: "c".repeat(64) });
  assert.deepEqual(view.defaults, [{ kind: "VISIBILITY", elementId: "panel", visible: true },
    { kind: "ATTRIBUTE", elementId: "label", attributeName: "aria-label", value: "Original" }]);
  assert.equal(htmlEditingInspectorViewSchema.safeParse({ ...view, defaults: [view.defaults[0], {
    kind: "ATTRIBUTE", elementId: "label", attributeName: "title", value: "Original" }] }).success, false);
  assert.equal(htmlEditingInspectorViewSchema.safeParse({ ...view, defaults: [view.defaults[0], {
    kind: "ATTRIBUTE", elementId: "label", attributeName: "aria-label", value: "undeclared" }] }).success, false);
  assert.doesNotMatch(JSON.stringify(view), /<section|sourceHtml|imageSources/);
});

test("declared direction and language values are validated at manifest admission, not just at dispatch", () => {
  const f = fixture();
  const declaration = { ...f.manifest.elements[1], kind: "ATTRIBUTE", attributeName: "dir", allowedValues: ["ltr", "rtl", "auto"] };
  assert.equal(htmlEditableManifestSchema.safeParse({ ...f.manifest, elements: [declaration] }).success, true);
  for (const [attributeName, allowedValues] of [["dir", ["RTL"]], ["lang", ["javascript:alert(1)"]], ["title", ["Line\nBreak"]],
    ["title", ["x".repeat(101)]]] as const) {
    assert.equal(htmlEditableManifestSchema.safeParse({ ...f.manifest, elements: [{ ...declaration, attributeName, allowedValues }] }).success, false);
  }
  assert.equal(htmlEditableManifestSchema.safeParse({ ...f.manifest, elements: [{ ...declaration,
    attributeName: "lang", allowedValues: ["es-MX", "en", "zh-Hant"] }] }).success, true);
});

test("attribute/visibility batch shares one authorized gateway CAS and uncertain ACK never retries", async () => {
  for (const loseAck of [false, true]) {
    const f = fixture(); let reads = 0, writes = 0;
    const request = { actorId: uuid, scope: { organizationId: uuid, documentId: uuid, clipId: "intro" },
      expectedCompositionDocumentHash: "c".repeat(64), expected: { version: 1, sha256: f.verified.sha256 },
      encodedCommand: f.command([{ operation: "SET_VISIBILITY", elementId: "panel", visible: false },
        { operation: "SET_ATTRIBUTE", elementId: "label", attributeName: "aria-label", value: "Updated" }]) };
    const repository: HtmlEditingRevisionRepository = {
      readAuthorized: async input => { reads++; assert.equal(input.actorId, uuid); assert.deepEqual(input.scope, request.scope);
        return { ...f.authority, compositionDocumentHash: request.expectedCompositionDocumentHash }; },
      appendCompareAndSwap: async input => { writes++; assert.deepEqual(input.expected, request.expected);
        assert.equal(input.expectedCompositionDocumentHash, request.expectedCompositionDocumentHash);
        assert.equal(input.revision.state.overrides.length, 2); assert.equal(input.revision.sourceHtml, f.revision.sourceHtml);
        if (loseAck) throw new Error("private token");
        return { status: "COMMITTED", version: input.revision.version, sha256: input.sha256 }; },
    };
    const gateway = new HtmlEditingRevisionGateway(repository);
    if (loseAck) await assert.rejects(gateway.apply(request), /COMMIT_UNCONFIRMED/);
    else assert.equal((await gateway.apply(request)).next.revision.version, 2);
    assert.equal(reads, 1); assert.equal(writes, 1);
  }
});
