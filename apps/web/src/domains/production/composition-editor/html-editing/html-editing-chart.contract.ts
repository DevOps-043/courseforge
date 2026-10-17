import { z } from "zod";
import { barChartSpecSchema, lineChartSpecSchema, areaChartSpecSchema, proportionChartSpecSchema,
  chartPointSchema, chartSeriesSchema } from "../../slides/specs/course-deck.schema";

export const HTML_EDITING_CHART_POLICY = Object.freeze({ cells: 2000, absoluteValue: 1_000_000_000 });
const text = (maximum: number) => z.string().max(maximum)
  .refine(value => !/[<>\u0000-\u001f\u007f\u2028\u2029]/u.test(value));
const numeric = z.number().finite().min(-HTML_EDITING_CHART_POLICY.absoluteValue).max(HTML_EDITING_CHART_POLICY.absoluteValue);
const point = chartPointSchema.extend({ label: text(80).min(1), value: numeric }).strict();
const series = chartSeriesSchema.extend({ label: text(80).min(1), points: z.array(point).min(1).max(24) }).strict();
const metadata = { id: z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/), title: text(140).min(1),
  subtitle: text(180).optional(), unit: text(32).optional(), sourceRefs: z.array(text(120).min(1)).max(32) };

/** Preserve the installed renderer's supported shape/limits. No schema stripping,
 * numeric coercion, executable labels, free colors or changes of chart identity. */
export const htmlEditingChartSpecSchema = z.discriminatedUnion("type", [
  barChartSpecSchema.extend({ ...metadata, points: z.array(point).min(1).max(12) }).strict(),
  lineChartSpecSchema.extend({ ...metadata, series: z.array(series).min(1).max(4) }).strict(),
  areaChartSpecSchema.extend({ ...metadata, series: z.array(series).min(1).max(2) }).strict(),
  proportionChartSpecSchema.extend({ ...metadata, label: text(100).min(1), value: numeric,
    total: numeric.positive() }).strict(),
]).superRefine((chart, context) => {
  const cells = chart.type === "bar" ? chart.points.length * 2 : chart.type === "proportion" ? 3
    : chart.series.reduce((sum, item) => sum + item.points.length * 2 + 1, 0);
  if (cells > HTML_EDITING_CHART_POLICY.cells) context.addIssue({ code: z.ZodIssueCode.custom, message: "Chart cell budget exceeded" });
  if ((chart.type === "line" || chart.type === "area") && chart.series.some(item =>
    item.points.length !== chart.series[0].points.length || item.points.some((entry, index) => entry.label !== chart.series[0].points[index].label)))
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Series require aligned row labels" });
  if (chart.type === "proportion" && (chart.value < 0 || chart.value > chart.total))
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid proportion" });
});
export type HtmlEditingChartSpec = z.infer<typeof htmlEditingChartSpecSchema>;
export const htmlEditingChartDatasetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bar"), points: z.array(point).min(1).max(12) }).strict(),
  z.object({ type: z.literal("line"), series: z.array(series).min(1).max(4) }).strict(),
  z.object({ type: z.literal("area"), series: z.array(series).min(1).max(2) }).strict(),
  z.object({ type: z.literal("proportion"), value: numeric, total: numeric.positive(), label: text(100).min(1) }).strict(),
]);
export type HtmlEditingChartDataset = z.infer<typeof htmlEditingChartDatasetSchema>;
export function readHtmlEditingChartDataset(chart: HtmlEditingChartSpec): HtmlEditingChartDataset {
  if (chart.type === "bar") return { type: chart.type, points: chart.points };
  if (chart.type === "proportion") return { type: chart.type, value: chart.value, total: chart.total, label: chart.label };
  return { type: chart.type, series: chart.series };
}
export function mergeHtmlEditingChartDataset(chart: HtmlEditingChartSpec, input: unknown): HtmlEditingChartSpec {
  const dataset = htmlEditingChartDatasetSchema.parse(input);
  if (dataset.type !== chart.type) throw new Error("HTML_EDITING_CHART_TYPE_MISMATCH");
  return htmlEditingChartSpecSchema.parse({ ...chart, ...dataset });
}
