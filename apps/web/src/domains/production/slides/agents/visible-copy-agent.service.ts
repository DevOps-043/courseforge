import {
  copyBudgetForSlideType,
  limitSlideCopy,
  normalizedVisibleText,
} from "../content/slide-copy-policy.service";

export interface VisibleSlideCopy {
  bodyItems: string[];
  subtitle?: string;
  title: string;
}

interface BuildVisibleCopyParams {
  fallbackBody: string;
  fallbackTitle: string;
  slideType?: string;
  subtitle?: unknown;
  visibleLines: string[];
}

function uniqueItems(items: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of items) {
    const key = normalizedVisibleText(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }

  return out;
}

export function buildVisibleSlideCopy(params: BuildVisibleCopyParams): VisibleSlideCopy {
  const budget = copyBudgetForSlideType(params.slideType);
  const hasStandaloneVisibleLine = params.visibleLines.length === 1;
  // A single approved visible line is evidence, not a reason to emit an
  // internal "pending" fallback. Preserve it as the body and use the planned
  // slide title to avoid duplicating the same string in title and body.
  const title = limitSlideCopy(
    hasStandaloneVisibleLine ? params.fallbackTitle : params.visibleLines[0] || params.fallbackTitle,
    budget.maxTitleCharacters,
  );
  const bodyItems = uniqueItems(
    (hasStandaloneVisibleLine ? params.visibleLines : params.visibleLines.slice(1))
      .map((line) => limitSlideCopy(line, budget.maxBodyItemCharacters))
      .filter((line) => line && normalizedVisibleText(line) !== normalizedVisibleText(title)),
  ).slice(0, budget.maxBodyItems);
  const fallbackBody = limitSlideCopy(params.fallbackBody, budget.maxBodyItemCharacters);

  return {
    bodyItems: bodyItems.length > 0 ? bodyItems : [fallbackBody],
    subtitle: limitSlideCopy(params.subtitle, budget.maxSubtitleCharacters) || undefined,
    title,
  };
}
