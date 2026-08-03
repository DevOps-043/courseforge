import { buildCourseDeckSpecFromComponent } from "../planning/course-deck-from-component.service";
import { renderCourseDeckHtml } from "../render/html-deck-renderer.service";
import type {
  CourseChartSpec,
  CourseDeckSpec,
  SlideDeckGenerateInput,
} from "../specs/course-deck.schema";
import {
  validateCourseDeckQuality,
  type CourseDeckQaReport,
} from "../validation/course-deck-qa.service";

export type CourseDeckGenerationStageId =
  | "deck_brief"
  | "slide_plan"
  | "chart_data"
  | "visual_direction"
  | "html_render"
  | "quality_gate";

export interface CourseDeckGenerationStage {
  durationMs: number;
  id: CourseDeckGenerationStageId;
  output: Record<string, unknown>;
  status: "SUCCEEDED";
}

export interface CourseDeckGenerationResult {
  deckSpec: CourseDeckSpec;
  html: string;
  qaReport: CourseDeckQaReport;
  stages: CourseDeckGenerationStage[];
}

interface GenerateCourseDeckParams {
  artifactId: string;
  component: {
    content?: unknown;
    id: string;
    type?: string | null;
  };
  input: SlideDeckGenerateInput;
}

interface ComponentContentSummary {
  hasCustomSlides: boolean;
  scriptSectionCount: number;
  sourceMode: "custom_request" | "script" | "storyboard" | "fallback";
  storyboardItemCount: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
}

function summarizeComponentContent(params: GenerateCourseDeckParams): ComponentContentSummary {
  const content = asRecord(params.component.content);
  const script = asRecord(content.script);
  const scriptSectionCount = Array.isArray(script.sections)
    ? script.sections.length
    : 0;
  const storyboardItemCount = Array.isArray(content.storyboard)
    ? content.storyboard.length
    : 0;
  const hasCustomSlides = Boolean(params.input.customSlides?.length);

  return {
    hasCustomSlides,
    scriptSectionCount,
    sourceMode: hasCustomSlides
      ? "custom_request"
      : scriptSectionCount > 0
        ? "script"
        : storyboardItemCount > 0
          ? "storyboard"
          : "fallback",
    storyboardItemCount,
  };
}

function summarizeCharts(deckSpec: CourseDeckSpec) {
  const charts = deckSpec.slides
    .map((slide) => slide.chart)
    .filter(Boolean) as CourseChartSpec[];
  const byType = charts.reduce<Record<CourseChartSpec["type"], number>>(
    (totals, chart) => {
      totals[chart.type] += 1;
      return totals;
    },
    {
      area: 0,
      bar: 0,
      line: 0,
      proportion: 0,
    },
  );

  return {
    byType,
    chartCount: charts.length,
    sourcedChartCount: charts.filter((chart) => chart.sourceRefs.length > 0).length,
  };
}

function runStage<T>(
  stages: CourseDeckGenerationStage[],
  id: CourseDeckGenerationStageId,
  work: () => { output: Record<string, unknown>; value: T },
) {
  const startedAt = Date.now();
  const result = work();

  stages.push({
    durationMs: Date.now() - startedAt,
    id,
    output: result.output,
    status: "SUCCEEDED",
  });

  return result.value;
}

export function generateCourseDeckWithQualityGate(
  params: GenerateCourseDeckParams,
): CourseDeckGenerationResult {
  const stages: CourseDeckGenerationStage[] = [];

  const contentSummary = runStage(stages, "deck_brief", () => {
    const summary = summarizeComponentContent(params);

    return {
      output: {
        componentType: params.component.type || "UNKNOWN",
        ...summary,
      },
      value: summary,
    };
  });

  const deckSpec = runStage(stages, "slide_plan", () => {
    const plannedDeck = buildCourseDeckSpecFromComponent(params);

    return {
      output: {
        slideCount: plannedDeck.slides.length,
        source: plannedDeck.sourceSnapshot.source,
        sourceMode: contentSummary.sourceMode,
        template: plannedDeck.template,
      },
      value: plannedDeck,
    };
  });

  runStage(stages, "chart_data", () => {
    const chartSummary = summarizeCharts(deckSpec);

    return {
      output: chartSummary,
      value: chartSummary,
    };
  });

  runStage(stages, "visual_direction", () => ({
    output: {
      brandLabel: deckSpec.designSystem.brandLabel,
      canvas: `${deckSpec.width}x${deckSpec.height}`,
      format: deckSpec.format,
      tone: deckSpec.designSystem.tone,
    },
    value: deckSpec.designSystem,
  }));

  const html = runStage(stages, "html_render", () => {
    const renderedHtml = renderCourseDeckHtml(deckSpec);

    return {
      output: {
        htmlBytes: new TextEncoder().encode(renderedHtml).length,
        renderer: "soflia-engine-slides-v1",
      },
      value: renderedHtml,
    };
  });

  const qaReport = runStage(stages, "quality_gate", () => {
    const report = validateCourseDeckQuality({ deckSpec, html });

    return {
      output: {
        findingCount: report.findings.length,
        status: report.status,
      },
      value: report,
    };
  });

  return {
    deckSpec,
    html,
    qaReport,
    stages,
  };
}
