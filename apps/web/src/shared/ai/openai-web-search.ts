export interface OpenAiSearchOutputItem {
  type: string;
  action?: unknown;
  content?: Array<{ type: string; annotations?: Array<{ type: string; url?: string; title?: string }> }>;
}

export function extractOpenAiSearchQueries(output: OpenAiSearchOutputItem[] = []) {
  const queries = output.flatMap(item => {
    const action = item.action;
    if (item.type !== "web_search_call" || !action || typeof action !== "object"
      || !("type" in action) || action.type !== "search") return [];
    if ("queries" in action && Array.isArray(action.queries)) {
      return action.queries.filter((query): query is string => typeof query === "string");
    }
    return "query" in action && typeof action.query === "string" ? [action.query] : [];
  });
  return [...new Set(queries)];
}

export function extractOpenAiWebSources(output: OpenAiSearchOutputItem[] = []) {
  const sources = new Map<string, { title: string; url: string }>();
  for (const item of output) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      for (const annotation of content.annotations ?? []) {
        if (annotation.type !== "url_citation" || !annotation.url) continue;
        try {
          const url = new URL(annotation.url);
          if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
          sources.set(url.href, { title: annotation.title || url.hostname, url: url.href });
        } catch {
          // Las anotaciones del proveedor también se validan.
        }
      }
    }
  }
  return [...sources.values()];
}
