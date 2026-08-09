import {
  copyBudgetForSlideType,
  limitSlideCopy,
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
    const key = item.toLowerCase();
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
  const title = limitSlideCopy(params.visibleLines[0] || params.fallbackTitle, budget.maxTitleCharacters);
  const bodyItems = uniqueItems(
    params.visibleLines
      .slice(1)
      .map((line) => limitSlideCopy(line, budget.maxBodyItemCharacters))
      .filter((line) => line && line !== title),
  ).slice(0, budget.maxBodyItems);
  const fallbackBody = limitSlideCopy(params.fallbackBody, budget.maxBodyItemCharacters);

  return {
    bodyItems: bodyItems.length > 0 ? bodyItems : [fallbackBody],
    subtitle: limitSlideCopy(params.subtitle, budget.maxSubtitleCharacters) || undefined,
    title,
  };
}
