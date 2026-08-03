import type { CourseChartSpec } from "../specs/course-deck.schema";

interface ChartRenderOptions {
  accent: string;
  accent2: string;
}

const CHART_WIDTH = 760;
const CHART_HEIGHT = 340;

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function niceDomain(values: number[]) {
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 1);
  return { min, max, span: Math.max(max - min, 1) };
}

function renderLabel(x: number, y: number, label: string, anchor = "middle") {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="chart-label">${escapeXml(label)}</text>`;
}

function renderBarChart(chart: Extract<CourseChartSpec, { type: "bar" }>, options: ChartRenderOptions) {
  const plot = { x: 130, y: 78, width: 560, height: 200 };
  const domain = niceDomain(chart.points.map((point) => point.value));
  const zeroX = plot.x + ((0 - domain.min) / domain.span) * plot.width;
  const rowGap = 18;
  const barHeight = Math.min(28, (plot.height - rowGap * (chart.points.length - 1)) / chart.points.length);

  const marks = chart.points.map((point, index) => {
    const y = plot.y + index * (barHeight + rowGap);
    const valueX = plot.x + ((point.value - domain.min) / domain.span) * plot.width;
    const x = Math.min(zeroX, valueX);
    const width = Math.max(Math.abs(valueX - zeroX), 2);
    const color = point.value >= 0 ? options.accent : options.accent2;

    return [
      renderLabel(112, y + 20, point.label, "end"),
      `<rect x="${plot.x}" y="${y}" width="${plot.width}" height="${barHeight}" rx="${barHeight / 2}" class="chart-track"/>`,
      `<rect x="${x}" y="${y}" width="${width}" height="${barHeight}" rx="${barHeight / 2}" fill="${color}"/>`,
      `<text x="${704}" y="${y + 21}" text-anchor="end" class="chart-value">${escapeXml(String(point.value))}${chart.unit ? ` ${escapeXml(chart.unit)}` : ""}</text>`,
    ].join("");
  }).join("");

  return `<svg class="cf-chart" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="${escapeXml(chart.title)}">
    <text x="30" y="34" class="chart-title">${escapeXml(chart.title)}</text>
    ${chart.subtitle ? `<text x="30" y="58" class="chart-subtitle">${escapeXml(chart.subtitle)}</text>` : ""}
    <line x1="${zeroX}" y1="${plot.y - 10}" x2="${zeroX}" y2="${plot.y + plot.height + 10}" class="chart-axis"/>
    ${marks}
  </svg>`;
}

function pointsToPath(points: { x: number; y: number }[]) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
}

function renderLineLikeChart(chart: Extract<CourseChartSpec, { type: "line" | "area" }>, options: ChartRenderOptions) {
  const plot = { x: 84, y: 78, width: 600, height: 200 };
  const allValues = chart.series.flatMap((series) => series.points.map((point) => point.value));
  const domain = niceDomain(allValues);
  const colors = [options.accent, options.accent2, "#5b8def", "#14b8a6"];
  const grid = [0, 0.5, 1].map((ratio) => {
    const y = plot.y + ratio * plot.height;
    return `<line x1="${plot.x}" y1="${y}" x2="${plot.x + plot.width}" y2="${y}" class="chart-grid"/>`;
  }).join("");

  const paths = chart.series.map((series, seriesIndex) => {
    const points = series.points.map((point, index) => ({
      x: plot.x + (series.points.length === 1 ? 0 : (index / (series.points.length - 1)) * plot.width),
      y: plot.y + plot.height - ((point.value - domain.min) / domain.span) * plot.height,
    }));
    const linePath = pointsToPath(points);
    const color = colors[seriesIndex % colors.length];
    const last = points[points.length - 1];
    const areaPath = chart.type === "area"
      ? `<path d="${linePath} L${last.x.toFixed(1)} ${plot.y + plot.height} L${points[0].x.toFixed(1)} ${plot.y + plot.height} Z" fill="${color}" opacity="0.14"/>`
      : "";
    const dots = points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="5" fill="${color}"/>`).join("");
    return `${areaPath}<path d="${linePath}" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" pathLength="1"/>${dots}<text x="${last.x + 14}" y="${last.y + 6}" class="chart-value" fill="${color}">${escapeXml(series.label)}</text>`;
  }).join("");

  const labels = chart.series[0]?.points.map((point, index, points) => {
    if (index !== 0 && index !== points.length - 1 && index % 2 !== 0) return "";
    const x = plot.x + (points.length === 1 ? 0 : (index / (points.length - 1)) * plot.width);
    return renderLabel(x, plot.y + plot.height + 34, point.label);
  }).join("");

  return `<svg class="cf-chart" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="${escapeXml(chart.title)}">
    <text x="30" y="34" class="chart-title">${escapeXml(chart.title)}</text>
    ${chart.subtitle ? `<text x="30" y="58" class="chart-subtitle">${escapeXml(chart.subtitle)}</text>` : ""}
    ${grid}
    ${paths}
    ${labels}
  </svg>`;
}

function renderProportionChart(chart: Extract<CourseChartSpec, { type: "proportion" }>, options: ChartRenderOptions) {
  const ratio = Math.max(0, Math.min(chart.value / chart.total, 1));
  const circumference = 2 * Math.PI * 84;
  const dash = circumference * ratio;
  const percent = Math.round(ratio * 100);

  return `<svg class="cf-chart" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="${escapeXml(chart.title)}">
    <text x="30" y="34" class="chart-title">${escapeXml(chart.title)}</text>
    ${chart.subtitle ? `<text x="30" y="58" class="chart-subtitle">${escapeXml(chart.subtitle)}</text>` : ""}
    <circle cx="190" cy="188" r="84" fill="none" stroke="rgba(42,36,24,.10)" stroke-width="30"/>
    <circle cx="190" cy="188" r="84" fill="none" stroke="${options.accent}" stroke-width="30" stroke-linecap="round" stroke-dasharray="${dash} ${circumference}" transform="rotate(-90 190 188)"/>
    <text x="190" y="180" text-anchor="middle" class="chart-big">${percent}%</text>
    <text x="190" y="216" text-anchor="middle" class="chart-label">${escapeXml(chart.label)}</text>
    <text x="350" y="176" class="chart-value">${escapeXml(String(chart.value))}${chart.unit ? ` ${escapeXml(chart.unit)}` : ""}</text>
    <text x="350" y="214" class="chart-subtitle">de ${escapeXml(String(chart.total))}${chart.unit ? ` ${escapeXml(chart.unit)}` : ""}</text>
  </svg>`;
}

export function renderCourseChartSvg(chart: CourseChartSpec, options: ChartRenderOptions) {
  if (chart.type === "bar") return renderBarChart(chart, options);
  if (chart.type === "line" || chart.type === "area") return renderLineLikeChart(chart, options);
  return renderProportionChart(chart, options);
}
