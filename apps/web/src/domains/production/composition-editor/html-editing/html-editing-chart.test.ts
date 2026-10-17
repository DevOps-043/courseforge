import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { htmlEditingChartSpecSchema, mergeHtmlEditingChartDataset, readHtmlEditingChartDataset } from "./html-editing-chart.contract";
import { renderHtmlEditingChart, readHtmlEditingChartDefault } from "./html-editing-chart.server";
import type { HtmlEditableManifest } from "./html-editing.contract";
import { computeHtmlEditableManifestSha256 } from "./html-editing-manifest-digest.server";
import type { HtmlEditingRevision } from "./html-editing-revision.contract";
import { prepareHtmlEditingRevisionCommand, prepareHtmlEditingRevisionRestore, verifyHtmlEditingRevision } from "./html-editing-revision.server";
import { createHtmlEditingInspectorView } from "./html-editing-inspector.server";

const base = { id: "chart-one", title: "Evidence", sourceRefs: [], unit: "%" };
const points = [{ label: "A", value: 10 }, { label: "B", value: -2 }];
function fixture(input: unknown = { ...base, type: "bar", points }) {
  const chart = htmlEditingChartSpecSchema.parse(input);
  const element: Extract<HtmlEditableManifest["elements"][number], { kind: "CHART" }> = {
    kind: "CHART", elementId: "chart", label: "Chart", chart, accent: "#123456", accent2: "#654321" };
  const sourceHtml = `<div id="chart">${renderHtmlEditingChart(element, readHtmlEditingChartDataset(chart))}</div>`;
  const uuid = "11111111-1111-4111-8111-111111111111";
  const binding = { organizationId: uuid, documentId: uuid, revisionId: uuid, documentSha256: "a".repeat(64), clipId: "intro",
    templateId: "chart-template", templateVersion: 1, sourceSha256: createHash("sha256").update(sourceHtml).digest("hex"), manifestSha256: "0".repeat(64) };
  const manifest: HtmlEditableManifest = { format: "courseforge-html-editable-manifest-v1", binding, elements: [element] };
  binding.manifestSha256 = computeHtmlEditableManifestSha256(JSON.stringify(manifest), binding);
  const revision: HtmlEditingRevision = { format: "courseforge-html-editable-revision-v1", version: 1, sourceHtml, manifest,
    state: { format: "courseforge-html-editable-override-state-v1", binding, overrides: [] } };
  const authority = { authoritativeBinding: binding, grantedAssetIds: [] as string[], imageSources: new Map<string, string>() };
  const original = verifyHtmlEditingRevision({ ...authority, encodedRevision: JSON.stringify(revision) });
  const command = (dataset: unknown) => JSON.stringify({ format: "courseforge-html-editable-command-v1", binding,
    overrides: [{ operation: "SET_CHART_DATA", elementId: "chart", dataset }] });
  return { authority, original, element, command };
}

test("chart data uses the existing SVG renderer, immutable source and forward history", () => {
  const f = fixture(); const dataset = { type: "bar", points: [{ label: "Updated & safe", value: 25 }] };
  const changed = prepareHtmlEditingRevisionCommand({ ...f.authority, encodedRevision: JSON.stringify(f.original.revision),
    expected: { version: 1, sha256: f.original.sha256 }, encodedCommand: f.command(dataset) });
  assert.equal(changed.next.revision.sourceHtml, f.original.revision.sourceHtml);
  assert.equal(changed.next.revision.version, 2);
  assert.ok(load(changed.next.compiled.html)("#chart").text().includes("Updated & safe"));
  assert.equal(load(changed.next.compiled.html)("script").length, 0);
  const view = createHtmlEditingInspectorView({ ...f.authority, encodedRevision: JSON.stringify(changed.next.revision), compositionDocumentHash: "a".repeat(64) });
  assert.deepEqual(view.defaults[0], { kind: "CHART", elementId: "chart", dataset: readHtmlEditingChartDataset(f.element.chart) });
  const undo = prepareHtmlEditingRevisionRestore({ ...f.authority, encodedRevision: JSON.stringify(changed.next.revision),
    expected: { version: 2, sha256: changed.next.sha256 }, encodedRestoreRevision: JSON.stringify(f.original.revision) });
  assert.equal(undo.next.compiled.html, f.original.compiled.html); assert.equal(undo.next.revision.version, 3);
  const redo = prepareHtmlEditingRevisionRestore({ ...f.authority, encodedRevision: JSON.stringify(undo.next.revision),
    expected: { version: 3, sha256: undo.next.sha256 }, encodedRestoreRevision: JSON.stringify(changed.next.revision) });
  assert.equal(redo.next.compiled.html, changed.next.compiled.html); assert.equal(redo.next.revision.version, 4);
  const reset = prepareHtmlEditingRevisionCommand({ ...f.authority, encodedRevision: JSON.stringify(changed.next.revision),
    expected: { version: 2, sha256: changed.next.sha256 }, encodedCommand: JSON.stringify({ format: "courseforge-html-editable-command-v1",
      binding: f.authority.authoritativeBinding, overrides: [{ operation: "RESET", elementId: "chart", property: "ALL" }] }) });
  assert.equal(reset.next.compiled.html, f.original.compiled.html); assert.equal(reset.next.revision.version, 3);
  const noOp = prepareHtmlEditingRevisionCommand({ ...f.authority, encodedRevision: JSON.stringify(f.original.revision),
    expected: { version: 1, sha256: f.original.sha256 }, encodedCommand: f.command(readHtmlEditingChartDataset(f.element.chart)) });
  assert.equal(noOp.changed, false); assert.equal(noOp.next.sha256, f.original.sha256);
});

test("chart commands reject type changes, client metadata, markup, numeric coercion and renderer overflow", () => {
  const f = fixture();
  const invalid = [ { type: "line", series: [{ label: "S", points }] },
    { type: "bar", points, title: "Changed" }, { type: "bar", points, accent: "url(https://bad)" },
    { type: "bar", points: [{ label: "<svg>", value: 1 }] },
    { type: "bar", points: [{ label: "A", value: "1" }] },
    { type: "bar", points: [{ label: "A", value: 1e10 }] },
    { type: "bar", points: Array.from({ length: 13 }, () => points[0]) } ];
  for (const dataset of invalid) assert.throws(() => prepareHtmlEditingRevisionCommand({ ...f.authority,
    encodedRevision: JSON.stringify(f.original.revision), expected: { version: 1, sha256: f.original.sha256 }, encodedCommand: f.command(dataset) }));
});

test("all existing chart types validate; series require aligned labels and proportions never clamp silently", () => {
  for (const type of ["line", "area"] as const) {
    const chart = htmlEditingChartSpecSchema.parse({ ...base, type, series: [{ label: "S", points }] });
    assert.equal(mergeHtmlEditingChartDataset(chart, readHtmlEditingChartDataset(chart)).type, type);
    assert.throws(() => mergeHtmlEditingChartDataset(chart, { type, series: [{ label: "S", points }, { label: "T", points: [{ label: "Other", value: 1 }] }] }));
  }
  const chart = htmlEditingChartSpecSchema.parse({ ...base, type: "proportion", label: "Done", value: 1, total: 2 });
  for (const value of [-1, 3, NaN, Infinity]) assert.throws(() => mergeHtmlEditingChartDataset(chart, { type: "proportion", label: "Done", value, total: 2 }));
  assert.throws(() => mergeHtmlEditingChartDataset(chart, { type: "proportion", label: "Done", value: 1, total: 0 }));
});

test("every installed chart type produces deterministic admitted source and output", () => {
  for (const chart of [ { ...base, type: "bar", points },
    { ...base, type: "line", series: [{ label: "Series", points }] },
    { ...base, type: "area", series: [{ label: "Series", points }] },
    { ...base, type: "proportion", label: "Progress", value: 1, total: 2 } ]) {
    const first = fixture(chart), second = fixture(chart);
    assert.equal(first.original.compiled.html, second.original.compiled.html);
    assert.equal(first.original.sha256, second.original.sha256);
    assert.deepEqual(first.original.compiled.usedAssetIds, []);
  }
});

test("chart enrollment cannot substitute arbitrary SVG or imported active behavior", () => {
  const f = fixture();
  for (const source of ['<div id="chart"><svg><text>Fake</text></svg></div>',
    '<svg id="chart"></svg>', '<div id="chart"><script>bad()</script></div>']) {
    assert.throws(() => readHtmlEditingChartDefault(load(source)("#chart"), f.element));
  }
});
