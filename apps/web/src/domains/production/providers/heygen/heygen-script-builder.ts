import { createHash } from "node:crypto";

export interface HeygenScriptBuildResult {
  durationEstimateSeconds: number;
  scriptHash: string;
  scriptText: string;
  sectionCount: number;
  title: string;
}

interface ScriptSection extends Record<string, unknown> {
  duration_seconds?: unknown;
  narration_text?: unknown;
}

const AVERAGE_NARRATION_WORDS_PER_MINUTE = 145;
const MINIMUM_SCRIPT_LENGTH = 12;

export function buildHeygenScriptFromComponent(params: {
  componentContent: unknown;
  componentType: string;
  fallbackTitle?: string | null;
}): HeygenScriptBuildResult {
  const content = toRecord(params.componentContent);
  const script = firstRecord([
    content?.script,
    content?.video_script,
    content?.videoScript,
  ]);
  const sections = findScriptSections(content, script);
  const narrationSections = sections
    .map((section) => ({
      durationSeconds: readPositiveNumber(section.duration_seconds),
      text: readString(section.narration_text),
    }))
    .filter((section) => section.text.length > 0);

  const scriptText = narrationSections
    .map((section) => section.text)
    .join("\n\n")
    .replace(/[^\S\r\n]+\n/g, "\n")
    .trim();

  if (scriptText.length < MINIMUM_SCRIPT_LENGTH) {
    throw new Error("El componente no tiene un guion narrativo suficiente para generar talking head.");
  }

  const explicitDuration = narrationSections.reduce(
    (total, section) => total + (section.durationSeconds || 0),
    0,
  );
  const durationEstimateSeconds =
    explicitDuration > 0
      ? Math.round(explicitDuration)
      : estimateDurationFromWords(scriptText);
  const title =
    readString(script?.title) ||
    readString(content?.title) ||
    params.fallbackTitle ||
    `Talking head ${params.componentType}`;

  return {
    durationEstimateSeconds,
    scriptHash: createHash("sha256").update(scriptText).digest("hex"),
    scriptText,
    sectionCount: narrationSections.length,
    title,
  };
}

function findScriptSections(
  content: Record<string, unknown> | null,
  script: Record<string, unknown> | null,
): ScriptSection[] {
  const candidates = [
    script?.sections,
    content?.sections,
    content?.storyboard,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.flatMap((entry) => {
        const record = toRecord(entry);
        return record ? [record as ScriptSection] : [];
      });
    }
  }

  return [];
}

function firstRecord(values: unknown[]) {
  for (const value of values) {
    const record = toRecord(value);
    if (record) return record;
  }

  return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function estimateDurationFromWords(scriptText: string) {
  const wordCount = scriptText.split(/\s+/).filter(Boolean).length;
  return Math.max(
    1,
    Math.round((wordCount / AVERAGE_NARRATION_WORDS_PER_MINUTE) * 60),
  );
}
