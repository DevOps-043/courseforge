export type TextModelProvider = "gemini" | "openai";

export const COURSE_TEXT_MODELS = { model: "gpt-6.1-terra", fallbackModel: "gpt-6.2-sol" } as const;

export function isOpenAiReasoningModel(model: string) {
  return /^(?:gpt-[5-9](?:[.\-]|$)|o[13](?:-|$))/i.test(model.trim());
}

export async function withTextModelFallback<T>(model: string, fallback: string, request: (model: string) => Promise<T>) {
  try {
    return await request(model);
  } catch (error) {
    if (!fallback || fallback === model) throw error;
    return request(fallback);
  }
}

export function getTextModelProvider(modelName: string): TextModelProvider | null {
  const normalizedName = modelName.trim().toLowerCase();

  if (normalizedName.startsWith("gemini-")) {
    return "gemini";
  }

  if (
    normalizedName.startsWith("gpt-") ||
    normalizedName.startsWith("o1") ||
    normalizedName.startsWith("o3")
  ) {
    return "openai";
  }

  return null;
}
