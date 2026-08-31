import { buildCourseDeckSpecFromComponent } from "../planning/course-deck-from-component.service";
import { renderCourseDeckHtml } from "../render/html-deck-renderer.service";
import { buildDeckBrief } from "../agents/deck-brief-agent.service";
import { buildEvidencePack } from "../agents/lesson-evidence-agent.service";
import {
  SLIDE_AGENT_PROMPT_CODES,
  SLIDE_AGENT_PROMPT_SCOPE,
  type SlideAgentModelConfig,
  type SlideAgentPromptConfig,
  type SlideAgentPromptKey,
} from "../agents/slide-agent-prompt-codes";
import { buildSlidePlan } from "../agents/slide-strategy-agent.service";
import { buildVisualAssignmentMap } from "../agents/visual-template-selection-agent.service";
import { synthesizeDeckVisibleCopy } from "../agents/visible-copy-synthesis-agent.service";
import type {
  CourseChartSpec,
  CourseDeckSpec,
  SlideDeckGenerateInput,
} from "../specs/course-deck.schema";
import type { SlideSourcePack } from "../content/slide-source-pack.service";
import {
  validateCourseDeckQuality,
  type CourseDeckQaReport,
} from "../validation/course-deck-qa.service";

export type CourseDeckGenerationStageId =
  | "deck_brief"
  | "evidence_pack"
  | "slide_plan"
  | "visual_direction"
  | "chart_data"
  | "visible_copy_synthesis"
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
  agentModels?: SlideAgentModelConfig;
  agentPrompts?: SlideAgentPromptConfig;
  artifactId: string;
  component: {
    content?: unknown;
    id: string;
    source_refs?: unknown;
    sourcePack?: SlideSourcePack;
    type?: string | null;
  };
  input: SlideDeckGenerateInput;
}

function promptStageOutput(
  agentPrompts: SlideAgentPromptConfig | undefined,
  key: SlideAgentPromptKey,
) {
  const prompt = agentPrompts?.[key];
  return {
    promptCode: SLIDE_AGENT_PROMPT_CODES[key],
    promptConfigured: Boolean(prompt),
    promptScope: prompt?.scope || SLIDE_AGENT_PROMPT_SCOPE,
    promptSource: prompt?.source || null,
    promptVersion: prompt?.version || null,
  };
}

function modelStageOutput(
  agentModels: SlideAgentModelConfig | undefined,
  key: SlideAgentPromptKey,
) {
  const model = agentModels?.[key];
  return {
    modelConfigured: Boolean(model),
    modelFallback: model?.fallbackModel || null,
    modelName: model?.modelName || null,
    modelSettingType: SLIDE_AGENT_PROMPT_CODES[key],
    modelTemperature: model?.temperature ?? null,
    modelThinkingLevel: model?.thinkingLevel || null,
  };
}

function agentStageOutput(
  params: GenerateCourseDeckParams,
  key: SlideAgentPromptKey,
) {
  const canExecuteConfiguredModel = key === "visibleCopy";
  return {
    ...promptStageOutput(params.agentPrompts, key),
    ...modelStageOutput(params.agentModels, key),
    executionMode: canExecuteConfiguredModel ? "MODEL_OR_FALLBACK" : "DETERMINISTIC",
    modelExecuted: false,
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

  const brief = runStage(stages, "deck_brief", () => {
    const deckBrief = buildDeckBrief({
      component: params.component,
      input: params.input,
    });

    return {
      output: {
        componentId: deckBrief.componentId,
        componentType: deckBrief.componentType,
        hasCustomSlides: deckBrief.hasCustomSlides,
        ...agentStageOutput(params, "deckBrief"),
        scriptSectionCount: deckBrief.scriptSectionCount,
        sourceMode: deckBrief.sourceMode,
        sourcePackCount: params.component.sourcePack?.items.length || 0,
        storyboardItemCount: deckBrief.storyboardItemCount,
        targetSlideCount: deckBrief.targetSlideCount,
      },
      value: deckBrief,
    };
  });

  const evidence = runStage(stages, "evidence_pack", () => {
    const evidencePack = buildEvidencePack({
      component: params.component,
    });

    return {
      output: {
        claimCount: evidencePack.claimCount,
        hasSourceRefs: evidencePack.hasSourceRefs,
        ...agentStageOutput(params, "evidence"),
        sourceInsightCounts: evidencePack.sourceInsightCounts,
        sourceRefCount: evidencePack.sourceRefs.length,
      },
      value: evidencePack,
    };
  });

  const slidePlan = runStage(stages, "slide_plan", () => {
    const plannedSlides = buildSlidePlan({
      brief,
      component: params.component,
      evidence,
      input: params.input,
    });

    return {
      output: {
        evidenceSourceCount: plannedSlides.evidenceSourceCount,
        plannedSlideCount: plannedSlides.slides.length,
        ...agentStageOutput(params, "slideStrategy"),
        slideTypes: plannedSlides.slides.reduce<Record<string, number>>((totals, slide) => {
          totals[slide.type] = (totals[slide.type] || 0) + 1;
          return totals;
        }, {}),
        sourceMode: plannedSlides.sourceMode,
        template: plannedSlides.template,
      },
      value: plannedSlides,
    };
  });

  const visualAssignments = runStage(stages, "visual_direction", () => {
    const assignments = buildVisualAssignmentMap(slidePlan);

    return {
      output: {
        assignmentCount: assignments.assignments.length,
        layoutCounts: assignments.layoutCounts,
        ...agentStageOutput(params, "visualTemplate"),
      },
      value: assignments,
    };
  });

  const deckSpec = runStage(stages, "chart_data", () => {
    const plannedDeck = buildCourseDeckSpecFromComponent({
      ...params,
      planning: {
        evidence,
        slidePlan,
        visualAssignments,
      },
    });
    const chartSummary = summarizeCharts(plannedDeck);

    return {
      output: {
        ...chartSummary,
        slideCount: plannedDeck.slides.length,
        source: plannedDeck.sourceSnapshot.source,
        sourceMode: brief.sourceMode,
        template: plannedDeck.template,
        visibleCopyAgent: agentStageOutput(params, "visibleCopy"),
      },
      value: plannedDeck,
    };
  });

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
        ...agentStageOutput(params, "qa"),
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

/**
 * Production path: build the auditable deterministic draft first, then let the
 * configured visible-copy agent synthesize compact, source-backed copy.
 */
export async function generateCourseDeckWithCopySynthesisQualityGate(
  params: GenerateCourseDeckParams,
): Promise<CourseDeckGenerationResult> {
  const draft = generateCourseDeckWithQualityGate(params);
  const startedAt = Date.now();
  const synthesis = params.input.customSlides?.length
    ? {
        deckSpec: draft.deckSpec,
        trace: {
          appliedSlideCount: 0,
          model: "manual-input",
          provider: "deterministic_fallback" as const,
          warning: "El copy manual se conserva sin reescritura automatica.",
        },
      }
    : await synthesizeDeckVisibleCopy({
        deckSpec: draft.deckSpec,
        model: params.agentModels?.visibleCopy,
        prompt: params.agentPrompts?.visibleCopy,
        sourcePack: params.component.sourcePack,
      });
  const manualCopy = synthesis.trace.model === "manual-input";
  const deterministicFallback = synthesis.trace.provider === "deterministic_fallback" && !manualCopy;
  console.info("[SlideGenerator] Visible copy synthesis completed", {
    appliedSlideCount: synthesis.trace.appliedSlideCount,
    componentId: params.component.id,
    event: "slide_visible_copy_synthesized",
    model: synthesis.trace.model,
    modelExecuted: synthesis.trace.provider !== "deterministic_fallback",
    provider: synthesis.trace.provider,
    usedFallback: deterministicFallback,
    warningPresent: Boolean(synthesis.trace.warning),
  });
  const html = renderCourseDeckHtml(synthesis.deckSpec);
  const qaReport = validateCourseDeckQuality({ deckSpec: synthesis.deckSpec, html });
  const retainedStages = draft.stages.filter((stage) =>
    stage.id !== "html_render" && stage.id !== "quality_gate",
  );

  return {
    deckSpec: synthesis.deckSpec,
    html,
    qaReport,
    stages: [
      ...retainedStages,
      {
        durationMs: Date.now() - startedAt,
        id: "visible_copy_synthesis",
        output: {
          ...agentStageOutput(params, "visibleCopy"),
          appliedSlideCount: synthesis.trace.appliedSlideCount,
          executionMode: manualCopy ? "MANUAL" : deterministicFallback ? "DETERMINISTIC_FALLBACK" : "MODEL",
          model: synthesis.trace.model,
          modelExecuted: synthesis.trace.provider !== "deterministic_fallback",
          provider: synthesis.trace.provider,
          warning: synthesis.trace.warning,
        },
        status: "SUCCEEDED",
      },
      {
        durationMs: 0,
        id: "html_render",
        output: {
          htmlBytes: new TextEncoder().encode(html).length,
          renderer: "soflia-engine-slides-v1",
        },
        status: "SUCCEEDED",
      },
      {
        durationMs: 0,
        id: "quality_gate",
        output: {
          findingCount: qaReport.findings.length,
          ...agentStageOutput(params, "qa"),
          status: qaReport.status,
        },
        status: "SUCCEEDED",
      },
    ],
  };
}
