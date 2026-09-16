export type TextModelProvider = "gemini" | "openai";

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
