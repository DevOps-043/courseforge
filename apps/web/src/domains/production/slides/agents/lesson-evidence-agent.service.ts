import {
  buildSourceInsights,
  type SlideSourceInsight,
  type SlideSourcePack,
} from "../content/slide-source-pack.service";

type SourceInsightType = SlideSourceInsight["type"];

export interface EvidencePack {
  claimCount: number;
  hasSourceRefs: boolean;
  sourceInsightCounts: Record<SourceInsightType, number>;
  sourceRefs: string[];
}

interface BuildEvidencePackParams {
  component: {
    content?: unknown;
    source_refs?: unknown;
    sourcePack?: SlideSourcePack;
  };
}

const SOURCE_REF_KEYS = new Set([
  "source_ref",
  "source_refs",
  "sourceRef",
  "sourceRefs",
  "source_refs_used",
  "sourceRefsUsed",
]);

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function pushSourceRef(target: Set<string>, value: unknown) {
  if (Array.isArray(value)) {
    value.forEach((item) => pushSourceRef(target, item));
    return;
  }

  const compact = compactText(value);
  if (compact) {
    target.add(compact.slice(0, 180));
  }
}

function collectSourceRefsFromValue(value: unknown, target: Set<string>, depth = 0) {
  if (depth > 5 || typeof value !== "object" || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    value.slice(0, 80).forEach((item) => collectSourceRefsFromValue(item, target, depth + 1));
    return;
  }

  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    if (SOURCE_REF_KEYS.has(key)) {
      pushSourceRef(target, childValue);
      continue;
    }

    collectSourceRefsFromValue(childValue, target, depth + 1);
  }
}

function countClaims(value: unknown, depth = 0): number {
  if (depth > 5 || typeof value !== "object" || value === null) {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 80).reduce((total, item) => total + countClaims(item, depth + 1), 0);
  }

  return Object.entries(value as Record<string, unknown>).reduce((total, [key, childValue]) => {
    const lowerKey = key.toLowerCase();
    const isClaimLike = [
      "key_points",
      "best_practices",
      "common_errors",
      "success_criteria",
      "measurable_criteria",
    ].some((pattern) => lowerKey.includes(pattern));

    if (isClaimLike && Array.isArray(childValue)) {
      return total + childValue.length;
    }

    return total + countClaims(childValue, depth + 1);
  }, 0);
}

function emptySourceInsightCounts(): Record<SourceInsightType, number> {
  return {
    concept: 0,
    practice: 0,
    question: 0,
    summary: 0,
  };
}

function countSourceInsights(sourcePack?: SlideSourcePack) {
  const counts = emptySourceInsightCounts();
  const insights = sourcePack?.insights?.length
    ? sourcePack.insights
    : buildSourceInsights(sourcePack?.items || []);

  for (const insight of insights) {
    counts[insight.type] += 1;
  }

  return counts;
}

export function buildEvidencePack(params: BuildEvidencePackParams): EvidencePack {
  const sourceRefs = new Set<string>();
  pushSourceRef(sourceRefs, params.component.source_refs);
  pushSourceRef(sourceRefs, params.component.sourcePack?.sourceRefs);
  collectSourceRefsFromValue(params.component.content, sourceRefs);

  return {
    claimCount: countClaims(params.component.content),
    hasSourceRefs: sourceRefs.size > 0,
    sourceInsightCounts: countSourceInsights(params.component.sourcePack),
    sourceRefs: Array.from(sourceRefs).slice(0, 20),
  };
}
