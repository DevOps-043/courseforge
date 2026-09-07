export type MaterialsModelProvider = "gemini" | "openai";

export function getMaterialsModelProvider(
  modelName: string,
): MaterialsModelProvider | null {
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

export function isSupportedMaterialsModel(modelName: string) {
  return getMaterialsModelProvider(modelName) !== null;
}
