import type { CourseDeckSpec, SlideDeckGenerateInput } from "../specs/course-deck.schema";
import { targetSlideCountForScript } from "../planning/slide-coverage-policy.service";

export type DeckBriefSourceMode = "custom_request" | "script" | "storyboard" | "fallback";

export interface DeckBrief {
  componentId: string;
  componentType: string;
  hasCustomSlides: boolean;
  locale: SlideDeckGenerateInput["locale"];
  scriptSectionCount: number;
  sourceMode: DeckBriefSourceMode;
  storyboardItemCount: number;
  targetSlideCount: number;
  totalDurationSeconds: number;
  template: CourseDeckSpec["template"];
  title?: string;
}

interface BuildDeckBriefParams {
  component: {
    content?: unknown;
    id: string;
    type?: string | null;
  };
  input: SlideDeckGenerateInput;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
}

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function countScriptSections(content: Record<string, unknown>) {
  const script = asRecord(content.script);
  return Array.isArray(script.sections) ? script.sections.length : 0;
}

function countStoryboardItems(content: Record<string, unknown>) {
  return Array.isArray(content.storyboard) ? content.storyboard.length : 0;
}

function visibleBeatCount(section: Record<string, unknown>) {
  const visibleLines = (typeof section.on_screen_text === "string" ? section.on_screen_text : "")
    .split(/\n|\u2022|- /)
    .map((line) => line.trim())
    .filter(Boolean).length;
  const hasSuccessCriterion = Boolean(compactText(section.success_criteria));
  return Math.min(Math.max(visibleLines + Number(hasSuccessCriterion), 1), 3);
}

function totalScriptDurationSeconds(content: Record<string, unknown>) {
  const script = asRecord(content.script);
  const sections = Array.isArray(script.sections) ? script.sections : [];
  return sections.reduce((total, section) => {
    const duration = asRecord(section).duration_seconds;
    return total + (typeof duration === "number" && Number.isFinite(duration) && duration > 0
      ? duration
      : 0);
  }, 0);
}

function resolveSourceMode(params: {
  hasCustomSlides: boolean;
  scriptSectionCount: number;
  storyboardItemCount: number;
}): DeckBriefSourceMode {
  if (params.hasCustomSlides) {
    return "custom_request";
  }
  if (params.scriptSectionCount > 0) {
    return "script";
  }
  if (params.storyboardItemCount > 0) {
    return "storyboard";
  }
  return "fallback";
}

function resolveTargetSlideCount(params: {
  customSlideCount: number;
  scriptVisualBeats: Array<{ visibleBeatCount: number }>;
  sourceMode: DeckBriefSourceMode;
  storyboardItemCount: number;
}) {
  if (params.sourceMode === "custom_request") {
    return Math.min(params.customSlideCount, 24);
  }
  if (params.sourceMode === "script") {
    return targetSlideCountForScript(params.scriptVisualBeats);
  }
  if (params.sourceMode === "storyboard") {
    return Math.min(params.storyboardItemCount + 1, 11);
  }
  return 1;
}

export function buildDeckBrief(params: BuildDeckBriefParams): DeckBrief {
  const content = asRecord(params.component.content);
  const script = asRecord(content.script);
  const scriptSectionCount = countScriptSections(content);
  const scriptVisualBeats = Array.isArray(script.sections)
    ? script.sections.map((section) => ({ visibleBeatCount: visibleBeatCount(asRecord(section)) }))
    : [];
  const storyboardItemCount = countStoryboardItems(content);
  const totalDurationSeconds = totalScriptDurationSeconds(content);
  const customSlideCount = params.input.customSlides?.length || 0;
  const hasCustomSlides = customSlideCount > 0;
  const sourceMode = resolveSourceMode({
    hasCustomSlides,
    scriptSectionCount,
    storyboardItemCount,
  });

  return {
    componentId: params.component.id,
    componentType: params.component.type || "UNKNOWN",
    hasCustomSlides,
    locale: params.input.locale,
    scriptSectionCount,
    sourceMode,
    storyboardItemCount,
    totalDurationSeconds,
    targetSlideCount: resolveTargetSlideCount({
      customSlideCount,
      scriptVisualBeats,
      sourceMode,
      storyboardItemCount,
    }),
    template: params.input.template,
    title: params.input.metadata?.title ||
      compactText(content.title) ||
      compactText(script.title) ||
      undefined,
  };
}
