export type TextModelProvider = "openai";

export const COURSE_TEXT_MODELS = { model: "gpt-6.1-terra", fallbackModel: "gpt-6.2-sol" } as const;

export function isOpenAiReasoningModel(model: string) {
  return /^(?:gpt-[5-9](?:[.\-]|$)|o[134](?:-|$))/i.test(model.trim());
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
  if (/^gpt-(?:image|live|realtime|audio|transcribe)(?:-|$)/.test(normalizedName)) return null;
  return /^(?:gpt-|o[134](?:-|$))/.test(normalizedName) ? "openai" : null;
}

export function resolveOpenAiTextModel(model?: string | null, fallback: string = COURSE_TEXT_MODELS.model) {
  const requested = model?.trim();
  if (requested && getTextModelProvider(requested)) return requested;
  return getTextModelProvider(fallback) ? fallback : COURSE_TEXT_MODELS.model;
}

export function resolveOpenAiTextModels(model?: string | null, fallback?: string | null, defaults: { model: string; fallbackModel: string } = COURSE_TEXT_MODELS) {
  const primary = resolveOpenAiTextModel(model, defaults.model);
  const secondary = resolveOpenAiTextModel(fallback, defaults.fallbackModel);
  return {
    model: primary,
    fallbackModel: primary !== secondary ? secondary : primary === COURSE_TEXT_MODELS.fallbackModel ? COURSE_TEXT_MODELS.model : COURSE_TEXT_MODELS.fallbackModel,
  };
}
