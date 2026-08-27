import type { CourseDeckSpec, SlideDeckGenerateInput } from "../specs/course-deck.schema";

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
  scriptSectionCount: number;
  sourceMode: DeckBriefSourceMode;
  storyboardItemCount: number;
  totalDurationSeconds: number;
}) {
  if (params.sourceMode === "custom_request") {
    return Math.min(params.customSlideCount, 24);
  }
  if (params.sourceMode === "script") {
    // The cover is included; visual support changes roughly every 30 seconds.
    const durationTarget = params.totalDurationSeconds > 0
      ? Math.ceil(params.totalDurationSeconds / 30) + 1
      : 0;
    return Math.min(Math.max(params.scriptSectionCount + 1, durationTarget), 24);
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
      scriptSectionCount,
      sourceMode,
      storyboardItemCount,
      totalDurationSeconds,
    }),
    template: params.input.template,
    title: params.input.metadata?.title ||
      compactText(content.title) ||
      compactText(script.title) ||
      undefined,
  };
}
