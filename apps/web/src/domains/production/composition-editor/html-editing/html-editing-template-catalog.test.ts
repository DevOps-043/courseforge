import { test } from "node:test";
import assert from "node:assert/strict";
import { HtmlEditingTemplateCatalog, HTML_EDITING_CATALOG_POLICY } from "./html-editing-template-catalog.server";

const organizationId = "11111111-1111-4111-8111-111111111111";
const template = { format: "courseforge-html-editable-template-v1", templateId: "intro", templateVersion: 1,
  sourceSha256: "a".repeat(64), elements: [{ kind: "TEXT", elementId: "title", label: "Title", maxCharacters: 100, multiline: false }] };
const catalog = { format: "courseforge-html-editable-catalog-v1", organizationId, templates: [template] };
const selection = { organizationId, templateId: "intro", templateVersion: 1, sourceSha256: template.sourceSha256 };

test("catalog resolves only the tenant's exact installed template version and source", () => {
  const installed = new HtmlEditingTemplateCatalog(JSON.stringify(catalog));
  assert.deepEqual(JSON.parse(installed.resolve(selection)), template);
  for (const change of [{ organizationId: "22222222-2222-4222-8222-222222222222" },
    { templateVersion: 2 }, { templateId: "unknown" }, { sourceSha256: "b".repeat(64) }, { templateVersion: 1.5 }]) {
    assert.throws(() => installed.resolve({ ...selection, ...change }), /TEMPLATE_UNAVAILABLE/);
  }
});
test("catalog snapshots cannot be altered through parsed lookup results", () => {
  const installed = new HtmlEditingTemplateCatalog(JSON.stringify(catalog));
  const parsed = JSON.parse(installed.resolve(selection)); parsed.elements[0].maxCharacters = 999;
  assert.equal(JSON.parse(installed.resolve(selection)).elements[0].maxCharacters, 100);
});
test("catalog rejects duplicate identities, unknown authority fields and oversized configuration safely", () => {
  for (const value of [{ ...catalog, templates: [template, template] }, { ...catalog, grants: [organizationId] },
    { ...catalog, templates: [{ ...template, binding: selection }] },
    { ...catalog, templates: Array.from({ length: 33 }, (_, index) => ({ ...template, templateVersion: index + 1 })) }]) {
    assert.throws(() => new HtmlEditingTemplateCatalog(JSON.stringify(value)), /^HtmlEditingCatalogError: HTML_EDITING_INVALID_CATALOG$/);
  }
  assert.throws(() => new HtmlEditingTemplateCatalog(" ".repeat(HTML_EDITING_CATALOG_POLICY.maximumBytes + 1)), /INVALID_CATALOG/);
});
test("empty installation never manufactures a fallback declaration", () => {
  assert.throws(() => new HtmlEditingTemplateCatalog(JSON.stringify({ ...catalog, templates: [] })).resolve(selection), /TEMPLATE_UNAVAILABLE/);
});
