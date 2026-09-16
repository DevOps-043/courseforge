import {
  getTextModelProvider,
  type TextModelProvider,
} from "./text-model-provider";

export type MaterialsModelProvider = TextModelProvider;

export function getMaterialsModelProvider(
  modelName: string,
): MaterialsModelProvider | null {
  return getTextModelProvider(modelName);
}

export function isSupportedMaterialsModel(modelName: string) {
  return getMaterialsModelProvider(modelName) !== null;
}
