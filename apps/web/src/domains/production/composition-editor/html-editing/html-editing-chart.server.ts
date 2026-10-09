import { load, type Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import { renderCourseChartSvg } from "../../slides/charts/svg-chart-renderer.service";
import type { HtmlEditableManifest } from "./html-editing.contract";
import { mergeHtmlEditingChartDataset, readHtmlEditingChartDataset, type HtmlEditingChartDataset } from "./html-editing-chart.contract";
import { HtmlEditingValidationError } from "./html-editing-validation";

type ChartDeclaration = Extract<HtmlEditableManifest["elements"][number], { kind: "CHART" }>;
export function renderHtmlEditingChart(declaration: ChartDeclaration, dataset: HtmlEditingChartDataset) {
  const chart = mergeHtmlEditingChartDataset(declaration.chart, dataset);
  return renderCourseChartSvg(chart, { accent: declaration.accent, accent2: declaration.accent2 });
}
/** Enrollment binds a dedicated div to the exact installed renderer output.
 * Arbitrary SVG, child editables and imported chart scripts are not templates. */
export function readHtmlEditingChartDefault(node: Cheerio<AnyNode>, declaration: ChartDeclaration) {
  const dataset = readHtmlEditingChartDataset(declaration.chart);
  const expected = load(renderHtmlEditingChart(declaration, dataset), {}, false).html();
  if (!node.is("div") || node.html() !== expected) throw new HtmlEditingValidationError("INVALID_SOURCE");
  return dataset;
}
