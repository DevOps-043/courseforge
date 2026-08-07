import type { CourseChartSpec } from "../specs/course-deck.schema";

const NON_INSTRUCTIONAL_SOURCE_PATTERNS = [
  /duration_seconds/i,
  /timecode/i,
  /video[_\s-]?rhythm/i,
  /script\.sections/i,
];

const NON_INSTRUCTIONAL_TEXT_PATTERNS = [
  /ritmo\s+del\s+video/i,
  /duracion\s+estimada/i,
  /distribucion\s+de\s+tiempo/i,
  /duration\s+distribution/i,
];

function normalizeForSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function isInstructionalChart(chart: CourseChartSpec): boolean {
  const sourceText = normalizeForSearch(chart.sourceRefs.join(" "));
  const chartText = normalizeForSearch([
    chart.id,
    chart.title,
    chart.subtitle || "",
  ].join(" "));

  return !(
    NON_INSTRUCTIONAL_SOURCE_PATTERNS.some((pattern) => pattern.test(sourceText)) ||
    NON_INSTRUCTIONAL_TEXT_PATTERNS.some((pattern) => pattern.test(chartText))
  );
}
