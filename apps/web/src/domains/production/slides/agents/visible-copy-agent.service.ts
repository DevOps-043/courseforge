export interface VisibleSlideCopy {
  bodyItems: string[];
  subtitle?: string;
  title: string;
}

interface BuildVisibleCopyParams {
  fallbackBody: string;
  fallbackTitle: string;
  maxBodyItems?: number;
  subtitle?: unknown;
  visibleLines: string[];
}

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function limitText(value: unknown, maxLength: number): string {
  const compact = compactText(value);
  if (compact.length <= maxLength) {
    return compact;
  }

  const sliced = compact.slice(0, maxLength - 1).trimEnd();
  const wordBreak = sliced.lastIndexOf(" ");
  return `${sliced.slice(0, wordBreak > maxLength * 0.5 ? wordBreak : sliced.length).trimEnd()}...`;
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
  const title = limitText(params.visibleLines[0] || params.fallbackTitle, 180);
  const bodyItems = uniqueItems(
    params.visibleLines
      .slice(1)
      .map((line) => limitText(line, 240))
      .filter((line) => line && line !== title),
  ).slice(0, params.maxBodyItems ?? 4);
  const fallbackBody = limitText(params.fallbackBody, 240);

  return {
    bodyItems: bodyItems.length > 0 ? bodyItems : [fallbackBody],
    subtitle: limitText(params.subtitle, 240) || undefined,
    title,
  };
}
