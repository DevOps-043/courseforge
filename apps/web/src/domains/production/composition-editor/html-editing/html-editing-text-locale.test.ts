import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { HtmlEditableManifest } from "./html-editing.contract";
import { htmlEditingTextLocaleDeclarationSchema } from "./html-editing-text-locale.contract";
import { computeHtmlEditableManifestSha256 } from "./html-editing-manifest-digest.server";
import type { HtmlEditingRevision } from "./html-editing-revision.contract";
import { prepareHtmlEditingRevisionCommand, prepareHtmlEditingRevisionRestore, verifyHtmlEditingRevision } from "./html-editing-revision.server";
import { createHtmlEditingInspectorView } from "./html-editing-inspector.server";
import { htmlEditingInspectorViewSchema } from "./html-editing-inspector.contract";

const spanish = { language: "es-MX", direction: "ltr" as const }, arabic = { language: "ar", direction: "rtl" as const };
function fixture(localized = true, sourceHtml = '<p id="title" lang="es-MX" dir="ltr">Original</p>') {
  const uuid = "11111111-1111-4111-8111-111111111111";
  const binding = { organizationId: uuid, documentId: uuid, revisionId: uuid, documentSha256: "a".repeat(64), clipId: "intro",
    templateId: "locale-template", templateVersion: 1, sourceSha256: createHash("sha256").update(sourceHtml).digest("hex"), manifestSha256: "0".repeat(64) };
  const manifest: HtmlEditableManifest = { format: "courseforge-html-editable-manifest-v1", binding, elements: [
    { kind: "TEXT", elementId: "title", label: "Title", maxCharacters: 100, multiline: false,
      ...(localized ? { localePolicy: { defaultLocale: spanish, allowedLocales: [spanish, arabic] } } : {}) } ] };
  binding.manifestSha256 = computeHtmlEditableManifestSha256(JSON.stringify(manifest), binding);
  const revision: HtmlEditingRevision = { format: "courseforge-html-editable-revision-v1", version: 1, sourceHtml, manifest,
    state: { format: "courseforge-html-editable-override-state-v1", binding, overrides: [] } };
  const authority = { authoritativeBinding: binding, grantedAssetIds: [] as string[], imageSources: new Map<string, string>() };
  const original = verifyHtmlEditingRevision({ ...authority, encodedRevision: JSON.stringify(revision) });
  const command = (overrides: unknown[]) => JSON.stringify({ format: "courseforge-html-editable-command-v1", binding, overrides });
  const prepare = (locale?: unknown) => prepareHtmlEditingRevisionCommand({ ...authority,
    encodedRevision: JSON.stringify(revision), expected: { version: 1, sha256: original.sha256 },
    encodedCommand: command([{ operation: "SET_TEXT", elementId: "title", value: "العربية 🧭", ...(locale !== undefined ? { locale } : {}) }]) });
  return { authority, original, prepare, command };
}

test("text and declared RTL locale are a single atomic override without rewriting source", () => {
  const f = fixture(), changed = f.prepare(arabic), dom = load(changed.next.compiled.html);
  assert.equal(dom("#title").text(), "العربية 🧭"); assert.equal(dom("#title").attr("lang"), "ar"); assert.equal(dom("#title").attr("dir"), "rtl");
  assert.equal(changed.next.revision.sourceHtml, f.original.revision.sourceHtml); assert.equal(changed.next.revision.version, 2);
  assert.equal(changed.next.revision.state.overrides.length, 1);
  const view = createHtmlEditingInspectorView({ ...f.authority, encodedRevision: JSON.stringify(changed.next.revision), compositionDocumentHash: "a".repeat(64) });
  assert.deepEqual(view.defaults[0], { kind: "TEXT", elementId: "title", value: "Original", locale: spanish });
  assert.equal(htmlEditingInspectorViewSchema.safeParse({ ...view, defaults: [{ ...view.defaults[0], locale: arabic }] }).success, false);
});

test("locale RESET ALL and historical restore recover exact text/attributes at forward versions", () => {
  const f = fixture(), changed = f.prepare(arabic);
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

test("locale is mandatory only on enrolled templates and never broadens declared options", () => {
  const f = fixture();
  for (const locale of [undefined, { language: "en", direction: "ltr" }, { language: "ar", direction: "ltr" },
    { language: "es-mx", direction: "ltr" }, { language: "ar", direction: "rtl", style: "bad" }, { language: "<script>", direction: "auto" }])
    assert.throws(() => f.prepare(locale));
  const legacy = fixture(false);
  assert.equal(legacy.prepare().next.revision.version, 2);
  assert.throws(() => legacy.prepare(arabic));
  assert.equal(load(legacy.prepare().next.compiled.html)("#title").attr("lang"), "es-MX");
});

test("locale enrollment rejects wrong source, duplicate choices and undeclared defaults", () => {
  for (const source of ['<p id="title">Original</p>', '<p id="title" lang="ar" dir="ltr">Original</p>',
    '<p id="title" lang="es-MX" dir="rtl">Original</p>']) assert.throws(() => fixture(true, source));
  assert.equal(htmlEditingTextLocaleDeclarationSchema.safeParse({ defaultLocale: spanish, allowedLocales: [arabic] }).success, false);
  assert.equal(htmlEditingTextLocaleDeclarationSchema.safeParse({ defaultLocale: spanish, allowedLocales: [spanish, spanish] }).success, false);
  assert.equal(htmlEditingTextLocaleDeclarationSchema.safeParse({ defaultLocale: spanish, allowedLocales: [spanish, { language: "not_a_tag", direction: "auto" }] }).success, false);
});
