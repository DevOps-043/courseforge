import type { CourseChartSpec } from "../specs/course-deck.schema";

interface InstructionalChartCandidate {
  chart: CourseChartSpec;
  sourceRef: string;
}

const CHART_CONTAINER_KEYS = [
  "chart",
  "charts",
  "data",
  "data_points",
  "dataset",
  "datasets",
  "metric",
  "metrics",
  "statistic",
  "statistics",
  "stats",
];

const NON_INSTRUCTIONAL_KEY_PATTERNS = [
  /duration/i,
  /timecode/i,
  /timestamp/i,
  /frame/i,
  /take_number/i,
  /slide_index/i,
];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function isInstructionalContainerKey(key: string) {
  const normalized = key.toLowerCase();
  return CHART_CONTAINER_KEYS.some((candidate) => normalized.includes(candidate));
}

function isNonInstructionalKey(key: string) {
  return NON_INSTRUCTIONAL_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function readLabel(record: Record<string, unknown>, fallbackIndex: number) {
  return compactText(record.label) ||
    compactText(record.name) ||
    compactText(record.category) ||
    compactText(record.title) ||
    `Dato ${fallbackIndex + 1}`;
}

function readValue(record: Record<string, unknown>) {
  const candidate = record.value ?? record.amount ?? record.score ?? record.percent ?? record.percentage;
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function chartFromArray(value: unknown, sourceRef: string): InstructionalChartCandidate | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const points = value
    .slice(0, 12)
    .map((item, index) => {
      const record = asRecord(item);
      const numericValue = readValue(record);
      if (numericValue === null) {
        return null;
      }

      return {
        label: readLabel(record, index).slice(0, 80),
        value: numericValue,
      };
    })
    .filter(Boolean) as Array<{ label: string; value: number }>;

  if (points.length < 2) {
    return null;
  }

  return {
    chart: {
      id: `instructional-chart-${sourceRef.replace(/[^a-z0-9]+/gi, "-").slice(0, 48)}`,
      points,
      sourceRefs: [sourceRef],
      title: "Datos clave de la leccion",
      type: "bar",
    },
    sourceRef,
  };
}

function collectChartCandidates(
  value: unknown,
  candidates: InstructionalChartCandidate[],
  path = "component.content",
  depth = 0,
) {
  if (depth > 5 || candidates.length >= 3 || typeof value !== "object" || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    const directCandidate = chartFromArray(value, path);
    if (directCandidate && !isNonInstructionalKey(path)) {
      candidates.push(directCandidate);
      return;
    }

    value.slice(0, 40).forEach((item, index) => {
      collectChartCandidates(item, candidates, `${path}[${index}]`, depth + 1);
    });
    return;
  }

  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = `${path}.${key}`;
    if (isNonInstructionalKey(key)) {
      continue;
    }

    if (Array.isArray(childValue) && isInstructionalContainerKey(key)) {
      const directCandidate = chartFromArray(childValue, nextPath);
      if (directCandidate) {
        candidates.push(directCandidate);
        continue;
      }
    }

    collectChartCandidates(childValue, candidates, nextPath, depth + 1);
  }
}

export function buildInstructionalChartsFromContent(content: unknown): CourseChartSpec[] {
  const candidates: InstructionalChartCandidate[] = [];
  collectChartCandidates(content, candidates);

  const seenSources = new Set<string>();
  return candidates
    .filter((candidate) => {
      if (seenSources.has(candidate.sourceRef)) {
        return false;
      }
      seenSources.add(candidate.sourceRef);
      return true;
    })
    .map((candidate) => candidate.chart)
    .slice(0, 2);
}
