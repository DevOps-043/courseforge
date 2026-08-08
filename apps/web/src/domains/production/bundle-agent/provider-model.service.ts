function isGeminiModelName(value: string | null | undefined) {
  return typeof value === "string" && /^gemini(?:-|$)/i.test(value.trim());
}

/** Prevents model names from one provider leaking into another provider SDK. */
export function resolveGeminiBundleModel(input: {
  configuredModel?: string | null;
  configuredFallback?: string | null;
  environmentModel?: string | null;
}) {
  return [input.configuredModel, input.configuredFallback, input.environmentModel]
    .find(isGeminiModelName) || "gemini-2.5-flash";
}

function isOpenAIModelName(value: string | null | undefined) {
  return typeof value === "string" && /^(?:gpt-|o\d)/i.test(value.trim());
}

export function getBundleModelProvider(value: string | null | undefined): "gemini" | "openai" | null {
  if (isGeminiModelName(value)) return "gemini";
  if (isOpenAIModelName(value)) return "openai";
  return null;
}

export function resolveOpenAIBundleModel(input: {
  configuredModel?: string | null;
  configuredFallback?: string | null;
  environmentModel?: string | null;
}) {
  return [input.configuredModel, input.configuredFallback, input.environmentModel]
    .find(isOpenAIModelName) || "gpt-4.1-mini";
}
